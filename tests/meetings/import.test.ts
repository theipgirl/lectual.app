import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sealToken, openToken } from "@/lib/mailbox/crypto";
import {
  CURSOR_OVERLAP_MS,
  importConnection,
  importSince,
  nextCursor,
  upsertMeetings,
  type ConnectionSecrets,
  type ExistingMeeting,
  type MeetingStore,
} from "@/lib/meetings/import";
import type { MatchContext } from "@/lib/meetings/match";
import type { NormalizedMeeting } from "@/lib/meetings/types";
import { fakeAdmin, filterValue } from "../mailbox/fake-db";

const fx = (f: string) => JSON.parse(readFileSync(path.join(__dirname, "../fixtures/meetings", f), "utf8"));

/** crm_meeting as a Map, keyed like the real unique index: (org_id, provider, external_id). */
function memoryStore(ctx: MatchContext = { leads: [], contacts: [], matterContacts: [], matters: [] }) {
  const rows = new Map<string, Record<string, unknown>>();
  const key = (o: unknown, p: unknown, e: unknown) => `${o}|${p}|${e}`;
  let n = 0;
  const store: MeetingStore = {
    async existing(orgId, provider, ids) {
      const out = new Map<string, ExistingMeeting>();
      for (const id of ids) {
        const r = rows.get(key(orgId, provider, id));
        if (r) out.set(id, { id: String(r.id), linked: Boolean(r.lead_id || r.matter_id) });
      }
      return out;
    },
    async insert(list) {
      for (const r of list) {
        const k = key(r.org_id, r.provider, r.external_id);
        if (rows.has(k)) throw Object.assign(new Error("duplicate"), { code: "23505" });
        rows.set(k, { ...r, id: `m${++n}` });
      }
    },
    async update(orgId, id, patch) {
      for (const r of rows.values()) if (r.id === id && r.org_id === orgId) Object.assign(r, patch);
    },
    async matchContext() {
      return ctx;
    },
  };
  return { store, rows };
}

const meeting = (over: Partial<NormalizedMeeting> = {}): NormalizedMeeting => ({
  externalId: "rec-1",
  title: "Consult",
  startedAt: "2025-03-01T10:00:00Z",
  durationSeconds: 1800,
  attendees: [{ name: "Dana", email: "dana@markright.example" }],
  summary: "Summary one",
  transcript: [{ speaker: "Dana", text: "Hello" }],
  shareUrl: "https://fathom.video/share/1",
  cursorAt: "2025-03-01T10:31:00Z",
  hostEmails: [],
  ...over,
});

describe("import upsert", () => {
  const args = { orgId: "org-a", provider: "fathom" as const, importedBy: null, now: Date.parse("2025-03-02T00:00:00Z") };

  it("is idempotent: the same meeting twice is one row", async () => {
    const { store, rows } = memoryStore();
    const first = await upsertMeetings(store, args, [meeting()]);
    const second = await upsertMeetings(store, args, [meeting()]);
    expect(first.inserted).toBe(1);
    expect(second).toMatchObject({ inserted: 0, updated: 1 });
    expect(rows.size).toBe(1);
  });

  it("a repeat inside one batch is written once", async () => {
    const { store, rows } = memoryStore();
    await upsertMeetings(store, args, [meeting(), meeting({ title: "Consult (renamed)" })]);
    expect(rows.size).toBe(1);
    expect([...rows.values()][0].title).toBe("Consult (renamed)");
  });

  it("a re-read keeps staff's link and never loses a transcript or summary to an empty re-read", async () => {
    const { store, rows } = memoryStore();
    await upsertMeetings(store, args, [meeting()]);
    const row = [...rows.values()][0];
    row.lead_id = "lead-staff";
    await upsertMeetings(store, args, [meeting({ transcript: null, summary: null, title: "New title" })]);
    expect(row.lead_id).toBe("lead-staff");
    expect(row.transcript).toEqual([{ speaker: "Dana", text: "Hello" }]);
    expect(row.summary).toBe("Summary one");
    expect(row.title).toBe("New title");
  });

  it("a late transcript fills in on the next run", async () => {
    const { store, rows } = memoryStore();
    await upsertMeetings(store, args, [meeting({ transcript: null })]);
    await upsertMeetings(store, args, [meeting()]);
    expect([...rows.values()][0].transcript).toEqual([{ speaker: "Dana", text: "Hello" }]);
  });

  it("the same external id in two firms is two meetings", async () => {
    const { store, rows } = memoryStore();
    await upsertMeetings(store, args, [meeting()]);
    await upsertMeetings(store, { ...args, orgId: "org-b" }, [meeting()]);
    expect(rows.size).toBe(2);
    expect([...rows.values()].map((r) => r.org_id).sort()).toEqual(["org-a", "org-b"]);
  });

  it("a new meeting is auto-linked on an exact single email match, and only suggested on an ambiguous one", async () => {
    const { store, rows } = memoryStore({
      leads: [
        { id: "lead-dana", email: "dana@markright.example" },
        { id: "lead-x", email: "x@dup.example" },
        { id: "lead-y", email: "x@dup.example" },
      ],
      contacts: [],
      matterContacts: [],
      matters: [],
    });
    const counts = await upsertMeetings(store, args, [
      meeting(),
      meeting({ externalId: "rec-2", attendees: [{ name: "X", email: "x@dup.example" }] }),
    ]);
    expect(counts).toMatchObject({ inserted: 2, linked: 1, suggested: 1 });
    const byExt = new Map([...rows.values()].map((r) => [r.external_id, r]));
    expect(byExt.get("rec-1")).toMatchObject({ lead_id: "lead-dana", link_source: "auto" });
    expect(byExt.get("rec-2")).toMatchObject({ lead_id: null, suggested_lead_id: "lead-x", link_source: null });
  });
});

describe("cursor", () => {
  it("first run looks back 30 days; later runs re-read an overlap before the cursor", () => {
    const now = Date.parse("2025-03-31T00:00:00Z");
    expect(importSince(null, now)).toBe("2025-03-01T00:00:00.000Z");
    expect(Date.parse(importSince("2025-03-20T00:00:00Z", now))).toBe(Date.parse("2025-03-20T00:00:00Z") - CURSOR_OVERLAP_MS);
  });
  it("only ever moves forward", () => {
    expect(nextCursor("2025-03-05T00:00:00.000Z", [meeting({ cursorAt: "2025-03-01T00:00:00Z" })])).toBe("2025-03-05T00:00:00.000Z");
    expect(nextCursor(null, [meeting({ cursorAt: "2025-03-01T00:00:00Z" })])).toBe("2025-03-01T00:00:00.000Z");
  });
});

describe("importConnection (Fathom, recorded fixtures, fake fetch)", () => {
  const root = randomBytes(32);
  const conn = (over: Partial<ConnectionSecrets> = {}): ConnectionSecrets => ({
    id: "conn-1",
    org_id: "org-a",
    provider: "fathom",
    status: "active",
    api_key_enc: sealToken(root, "firm-fathom-key", "lectual-meetings"),
    access_token_enc: null,
    refresh_token_enc: null,
    token_expires_at: null,
    import_cursor: null,
    ...over,
  });

  it("imports with the firm's own key, stamps the connection's org, and advances the cursor on that row only", async () => {
    const page1 = fx("fathom-meetings-page1.json");
    const page2 = fx("fathom-meetings-page2.json");
    const seenKeys: string[] = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      seenKeys.push((init?.headers as Record<string, string>)["X-Api-Key"]);
      return new Response(JSON.stringify(url.includes("cursor=") ? page2 : page1));
    };
    const { store, rows } = memoryStore();
    const { client, log } = fakeAdmin(() => ({ data: null, error: null }));
    const out = await importConnection(
      { admin: client as unknown as SupabaseClient, root, zoomCreds: null, store, fetchImpl, now: () => Date.parse("2025-03-03T00:00:00Z") },
      conn(),
      { importedBy: "user-1" },
    );
    expect(out.ok).toBe(true);
    expect(seenKeys.every((k) => k === "firm-fathom-key")).toBe(true);
    expect([...rows.values()].every((r) => r.org_id === "org-a" && r.imported_by === "user-1")).toBe(true);
    expect(rows.size).toBe(2);
    const upd = log.find((q) => q.table === "meeting_source_connection" && q.action === "update")!;
    expect(filterValue(upd, "id")).toBe("conn-1");
    expect(filterValue(upd, "org_id")).toBe("org-a");
    expect((upd.values as Record<string, unknown>).import_cursor).toBe("2025-03-02T10:31:00.000Z");
  });

  it("a 401 from Fathom marks the connection reauth; nothing is written to meetings", async () => {
    const { store, rows } = memoryStore();
    const { client, log } = fakeAdmin(() => ({ data: null, error: null }));
    const out = await importConnection(
      { admin: client as unknown as SupabaseClient, root, zoomCreds: null, store, fetchImpl: async () => new Response("{}", { status: 401 }) },
      conn(),
    );
    expect(out).toMatchObject({ ok: false, status: "reauth" });
    expect(rows.size).toBe(0);
    const upd = log.find((q) => q.table === "meeting_source_connection" && q.action === "update")!;
    expect((upd.values as Record<string, unknown>).status).toBe("reauth");
  });

  it("Zoom: an expiring token is refreshed and BOTH rotated tokens are re-sealed on the same (id, org_id)", async () => {
    const zoomConn = conn({
      provider: "zoom",
      api_key_enc: null,
      access_token_enc: sealToken(root, "old-at", "lectual-meetings"),
      refresh_token_enc: sealToken(root, "old-rt", "lectual-meetings"),
      token_expires_at: new Date(Date.parse("2025-03-03T00:00:00Z") + 30_000).toISOString(),
    });
    const fetchImpl = async (url: string) =>
      url.includes("/oauth/token")
        ? new Response(JSON.stringify({ access_token: "new-at", refresh_token: "new-rt", expires_in: 3600 }))
        : new Response(JSON.stringify({ meetings: [], next_page_token: "" }));
    const { store } = memoryStore();
    const { client, log } = fakeAdmin(() => ({ data: null, error: null }));
    const out = await importConnection(
      { admin: client as unknown as SupabaseClient, root, zoomCreds: { clientId: "c", clientSecret: "s" }, store, fetchImpl, now: () => Date.parse("2025-03-03T00:00:00Z") },
      zoomConn,
    );
    expect(out.ok).toBe(true);
    const tokenWrite = log.find((q) => q.action === "update" && (q.values as Record<string, unknown>).refresh_token_enc)!;
    expect(filterValue(tokenWrite, "org_id")).toBe("org-a");
    const v = tokenWrite.values as Record<string, string>;
    expect(openToken(root, v.access_token_enc, "lectual-meetings")).toBe("new-at");
    expect(openToken(root, v.refresh_token_enc, "lectual-meetings")).toBe("new-rt");
  });
});
