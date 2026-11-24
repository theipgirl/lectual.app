import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/admin", () => ({ getAdminClient: () => ({}) }));
vi.mock("@/lib/intake-forms/lawmatics-sync", () => ({ firmToken: async () => "tok" }));

import { fakeAdmin, type Recorded } from "../mailbox/fake-db";
import { resetLeadMergeSupport } from "@/lib/leads/live";
import { LawmaticsApiError, createLawmaticsClient, type FetchLike, type LawmaticsClient, type ListResult } from "@/lib/lawmatics/client";
import { LAWMATICS_SYNC_KEY_REFUSED } from "@/lib/ui/words";

const { runLawmaticsDailySync, DAILY_SYNC_SOURCE } = await import("@/lib/lawmatics/daily-sync");

/** Invented people only. Tests never call Lawmatics: the client is a fake, or the real client over a fake fetch. */
type Row = Record<string, unknown>;
const ORG = "org-from-connection";
const OTHER = "org-other";
const NOW = new Date("2026-11-23T14:00:00Z");
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

const STAGES: Row[] = [
  { id: "s-new", org_id: ORG, name: "Potential New Client", category: "open", order_index: 1 },
  { id: "s-won", org_id: ORG, name: "Signed LOE / Deposit Received", category: "won", order_index: 9 },
  { id: "s-lost", org_id: ORG, name: "Lost", category: "lost", order_index: 10 },
  { id: "o-new", org_id: OTHER, name: "New Lead", category: "open", order_index: 1 },
];

// ── a small in-memory database behind the recorded query builder ────────────────

function valueAt(row: Row, column: string): unknown {
  const [col, key] = column.split("->>");
  if (key === undefined) return row[col];
  const inner = row[col] as Row | undefined;
  return inner && typeof inner === "object" ? inner[key] : undefined;
}
function matches(row: Row, q: Recorded): boolean {
  return q.filters.every((f) => {
    const v = valueAt(row, f.column);
    switch (f.op) {
      case "eq":
        return v === f.value;
      case "in":
        return (f.value as unknown[]).includes(v);
      case "not":
        return v !== null && v !== undefined;
      case "is":
        return v === null || v === undefined;
      case "gte":
        return typeof v === "string" && v >= (f.value as string);
      case "like":
        return typeof v === "string" && v.startsWith(String(f.value).replace(/%$/, ""));
      default:
        throw new Error(`fake: ${f.op}`);
    }
  });
}

type Db = { tables: Record<string, Row[]>; refuse?: (q: Recorded) => { code?: string; message?: string } | undefined };

function handler(db: Db) {
  let seq = 0;
  return (q: Recorded) => {
    const refusal = db.refuse?.(q);
    if (refusal) return { data: null, error: refusal };
    const rows = (db.tables[q.table] ??= []);
    if (q.action === "select") return { data: rows.filter((r) => matches(r, q)).map((r) => ({ ...r })), error: null };
    if (q.action === "insert") {
      const incoming = ([] as Row[]).concat(q.values as Row | Row[]);
      const out: Row[] = [];
      for (const v of incoming) {
        if (q.upsert && q.table === "crm_calendar_event") {
          const hit = rows.find((r) => r.org_id === v.org_id && r.source === v.source && r.external_id === v.external_id);
          const clash = rows.find((r) => r !== hit && r.org_id === v.org_id && r.lawmatics_id === v.lawmatics_id);
          if (clash) return { data: null, error: { code: "23505" } };
          if (hit) Object.assign(hit, v);
          else rows.push({ id: `cal-${++seq}`, ...v });
          continue;
        }
        if (q.table === "crm_lead" && rows.some((r) => r.org_id === v.org_id && v.lawmatics_id && r.lawmatics_id === v.lawmatics_id)) return { data: null, error: { code: "23505" } };
        const row = { id: `${q.table}-${++seq}`, ...v };
        rows.push(row);
        out.push(row);
      }
      return { data: out, error: null };
    }
    if (q.action === "update") {
      const hit = rows.filter((r) => matches(r, q));
      for (const r of hit) Object.assign(r, q.values as Row);
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    if (q.action === "delete") {
      const hit = rows.filter((r) => matches(r, q));
      db.tables[q.table] = rows.filter((r) => !hit.includes(r));
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    return { data: null, error: null };
  };
}

function world(tables: Record<string, Row[]> = {}, refuse?: Db["refuse"]) {
  const db: Db = {
    tables: {
      lawmatics_connection: [{ id: "c1", org_id: ORG, status: "active", last_sync_at: null }],
      crm_stage: STAGES,
      crm_lead: [],
      crm_matter: [],
      crm_matter_stage: [],
      crm_activity: [],
      crm_calendar_event: [],
      ...tables,
    },
    refuse,
  };
  const { client, log } = fakeAdmin(handler(db) as Parameters<typeof fakeAdmin>[0]);
  return { db, log, admin: client as never };
}

// ── a fake Lawmatics ────────────────────────────────────────────────────────────

const list = (records: Row[], over: Partial<ListResult> = {}): ListResult => ({ records, included: new Map(), pagesFetched: 1, truncated: false, includeDropped: false, ...over });
const prospect = (id: string, attrs: Row = {}): Row => ({
  id,
  type: "prospect",
  attributes: { first_name: "Wren", last_name: `Tester${id}`, email: `wren${id}@example.test`, created_at: "2026-11-20T15:00:00Z", ...attrs },
});
const consult = (id: string, attrs: Row = {}, rel: Row = {}): Row => ({
  id,
  type: "event",
  attributes: { name: `30 Minute Consultation - Wren Tester${id}`, start_time: day(2), end_time: day(2.02), description: "Private notes https://us02web.zoom.us/j/81234567890", ...attrs },
  relationships: rel,
});

type Lm = { prospects?: ListResult | Error; contacts?: ListResult | Error; events?: ListResult | Error; one?: (id: string) => unknown };
function lawmatics(o: Lm = {}) {
  const calls: Array<{ method: string; path: string; opts?: unknown }> = [];
  const pick = (v: ListResult | Error | undefined, fallback: ListResult) => {
    if (v instanceof Error) throw v;
    return v ?? fallback;
  };
  const client: LawmaticsClient = {
    async listAll(path, opts) {
      calls.push({ method: "listAll", path, opts });
      if (path === "/prospects") return pick(o.prospects, list([]));
      if (path === "/contacts") return pick(o.contacts, list([]));
      if (path === "/events") return pick(o.events, list([]));
      return list([]);
    },
    async get(path, params) {
      calls.push({ method: "get", path, opts: params });
      const id = decodeURIComponent(path.split("/").pop() ?? "");
      return o.one ? o.one(id) : {};
    },
  };
  return { client, calls };
}

const run = (w: ReturnType<typeof world>, lm: ReturnType<typeof lawmatics>, over: Record<string, unknown> = {}) =>
  runLawmaticsDailySync({ admin: w.admin, client: () => lm.client, getToken: async () => "tok", now: () => NOW, mode: "daytime", ...over });

beforeEach(() => resetLeadMergeSupport());

describe("tenant fence (22)", () => {
  it("every write carries the connection row's org_id; a second firm writes only its own rows", async () => {
    const w = world({
      lawmatics_connection: [
        { id: "c1", org_id: ORG, status: "active" },
        { id: "c2", org_id: OTHER, status: "active" },
      ],
    });
    const lm = lawmatics({ prospects: list([prospect("1")]), events: list([consult("e1")]) });
    const s = await run(w, lm);
    expect(s.connections).toBe(2);
    const writes = w.log.filter((q) => q.action !== "select");
    expect(writes.length).toBeGreaterThan(0);
    for (const q of writes.filter((x) => x.action === "insert")) {
      for (const v of ([] as Row[]).concat(q.values as Row)) expect([ORG, OTHER]).toContain(v.org_id);
    }
    // Each firm's lead landed in its own new-enquiry stage, stamped with its own org.
    const leads = w.db.tables.crm_lead;
    expect(leads.map((l) => [l.org_id, l.current_stage_id]).sort()).toEqual([[ORG, "s-new"], [OTHER, "o-new"]].sort());
    // Every read and every update/delete is fenced on an org.
    for (const q of w.log.filter((x) => x.table !== "lawmatics_connection" && x.action !== "insert")) {
      expect(q.filters.some((f) => f.column === "org_id"), `${q.table} ${q.action}`).toBe(true);
    }
  });
});

describe("the reads (23, 24)", () => {
  it("one /prospects request carries include=stage,practice_area,contact AND fields=all; /contacts is swept (real client, fake fetch)", async () => {
    const urls: URL[] = [];
    const fetchImpl: FetchLike = async (input) => {
      urls.push(new URL(input));
      return { ok: true, status: 200, statusText: "OK", text: async () => "{}", json: async () => ({ data: [] }) };
    };
    const w = world();
    await runLawmaticsDailySync({ admin: w.admin, fetchImpl, getToken: async () => "tok", now: () => NOW, mode: "daytime" });
    const prospects = urls.filter((u) => u.pathname.endsWith("/prospects"));
    expect(prospects).toHaveLength(1);
    expect(prospects[0].searchParams.get("include")).toBe("stage,practice_area,contact");
    expect(prospects[0].searchParams.get("fields")).toBe("all");
    expect(urls.some((u) => u.pathname.endsWith("/contacts"))).toBe(true);
    expect(urls.some((u) => u.pathname.endsWith("/events"))).toBe(true);
  });

  it("truncated /prospects: no lead, and the consult step still runs", async () => {
    const w = world();
    const s = await run(w, lawmatics({ prospects: list([prospect("1")], { truncated: true }), events: list([consult("e1")]) }));
    expect(w.db.tables.crm_lead).toHaveLength(0);
    expect(s.prospects.failed).toBe(1);
    expect(w.db.tables.crm_calendar_event).toHaveLength(1);
  });

  it("includes dropped, or a truncated or failed /contacts: no leads for that firm", async () => {
    for (const o of [
      { prospects: list([prospect("1")], { includeDropped: true }) },
      { prospects: list([prospect("1")]), contacts: list([], { truncated: true }) },
      { prospects: list([prospect("1")]), contacts: new LawmaticsApiError(500, "/contacts", "x") },
    ]) {
      const w = world();
      await run(w, lawmatics(o));
      expect(w.db.tables.crm_lead).toHaveLength(0);
    }
  });

  it("(4) a truncated /events read still upserts the in-window consults it has, and holds only the removals (counted)", async () => {
    const w = world({ crm_calendar_event: [{ id: "r1", org_id: ORG, source: "lawmatics", external_id: "lmsync:gone", lawmatics_id: "gone", starts_at: day(1), is_consult: true }] });
    const s = await run(w, lawmatics({ events: list([consult("e1")], { truncated: true }) }));
    expect(s.consults.failed).toBe(0);
    expect(s.consults.eventsTruncated).toBe(1);
    expect(s.consults.removalsHeld).toBe(1);
    expect(w.db.tables.crm_calendar_event.map((r) => r.external_id).sort()).toEqual(["lmsync:e1", "lmsync:gone"]);
  });
});

describe("the writes (8, 32, 26)", () => {
  it("a new lead: new-enquiry stage, stage age rule, no lawmatics_synced_at, one lead_created row with no stage flags", async () => {
    const w = world();
    const s = await run(w, lawmatics({ prospects: list([prospect("1", { stage_name: "Proposal Sent" })]) }));
    expect(s.prospects.created).toBe(1);
    const l = w.db.tables.crm_lead[0];
    expect(l).toMatchObject({ org_id: ORG, current_stage_id: "s-new", lawmatics_id: "1", created_at: "2026-11-20T15:00:00.000Z", last_activity_at: "2026-11-20T15:00:00.000Z", stage_entered_at: NOW.toISOString() });
    expect(l).not.toHaveProperty("lawmatics_synced_at");
    const act = w.db.tables.crm_activity.find((a) => a.type === "lead_created")!;
    expect(act).toMatchObject({ org_id: ORG, actor_type: "system", payload: { source: DAILY_SYNC_SOURCE, lawmatics_id: "1" } });
    expect(JSON.stringify(act.payload)).not.toMatch(/lawmatics_stage_unmapped|hired_in_lawmatics/);
  });

  it("idempotent: a second run with the same data writes nothing; a 23505 is counted and the run goes on", async () => {
    const w = world();
    const lm = lawmatics({ prospects: list([prospect("1"), prospect("2")]), events: list([consult("e1")]) });
    await run(w, lm);
    const before = w.log.filter((q) => q.action !== "select").length;
    await run(w, lm);
    expect(w.log.filter((q) => q.action !== "select").length - before).toBe(1); // only "last complete run" is stamped again
    const dup = world({ crm_lead: [] });
    const lm2 = lawmatics({ prospects: list([prospect("1"), prospect("2")]) });
    // Someone else wrote lead "1" with that Lawmatics id between our read and our insert.
    let once = false;
    dup.db.refuse = (q) => (q.table === "crm_lead" && q.action === "insert" && !once ? ((once = true), { code: "23505" }) : undefined);
    const s = await run(dup, lm2);
    expect(s.prospects.failedWrites).toBe(1);
    expect(s.prospects.created).toBe(1);
  });

  it("the link write sets lawmatics_id ONLY, fenced on it being null and on a live lead", async () => {
    const w = world({ crm_lead: [{ id: "L1", org_id: ORG, email: "wren1@example.test", first_name: "Wren", last_name: "Tester1", current_stage_id: "s-new", lawmatics_id: null, phone: "555" }] });
    const s = await run(w, lawmatics({ prospects: list([prospect("1", { phone: "999" })]) }));
    expect(s.prospects.linked).toBe(1);
    const upd = w.log.find((q) => q.table === "crm_lead" && q.action === "update")!;
    expect(upd.values).toEqual({ lawmatics_id: "1" });
    expect(upd.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "is", column: "lawmatics_id" }),
      expect.objectContaining({ op: "is", column: "merged_into_id" }),
      expect.objectContaining({ op: "eq", column: "org_id", value: ORG }),
    ]));
    expect(w.db.tables.crm_lead[0].phone).toBe("555");
  });

  it("came back: flagged once (a second run writes no second row); the stage is untouched; an unreadable check writes nothing", async () => {
    const lost = { id: "L1", org_id: ORG, email: "wren1@example.test", first_name: "Wren", last_name: "Tester1", current_stage_id: "s-lost", lawmatics_id: null };
    const w = world({ crm_lead: [{ ...lost }] });
    const lm = lawmatics({ prospects: list([prospect("1")]) });
    const s = await run(w, lm);
    expect(s.prospects.cameBack).toBe(1);
    await run(w, lm);
    const flags = w.db.tables.crm_activity.filter((a) => (a.payload as Row)?.kind === "came_back");
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ type: "ai_insight", actor_type: "system", lead_id: "L1", payload: { source: DAILY_SYNC_SOURCE, kind: "came_back", lawmatics_id: "1", stage_category: "lost" } });
    expect(w.db.tables.crm_lead[0].current_stage_id).toBe("s-lost");
    expect(w.log.some((q) => q.table === "crm_lead" && q.action === "update" && "current_stage_id" in (q.values as Row))).toBe(false);

    const broken = world({ crm_lead: [{ ...lost }] }, (q) => (q.table === "crm_activity" && q.action === "select" ? { code: "XX" } : undefined));
    const s2 = await run(broken, lm);
    expect(s2.prospects.flagsNotWritten).toBe(1);
    expect(broken.db.tables.crm_activity.filter((a) => (a.payload as Row)?.kind === "came_back")).toHaveLength(0);
  });
});

describe("consults through the runner (19, 20, 15)", () => {
  it("stores the consult with no description, location or attendees; a reschedule updates it; a cancel removes it", async () => {
    const w = world({ crm_lead: [{ id: "L1", org_id: ORG, email: "ola@example.test", first_name: "Ola", last_name: "Placeholder", current_stage_id: "s-new", lawmatics_id: "p1" }] });
    await run(w, lawmatics({ events: list([consult("e1", { location: "1 Hidden Way", invitees: [{ email: "ola@example.test" }] }, { prospect: { data: { type: "prospect", id: "p1" } } })]) }));
    const row = w.db.tables.crm_calendar_event[0];
    expect(row).toMatchObject({ org_id: ORG, source: "lawmatics", external_id: "lmsync:e1", lead_id: "L1", is_consult: true, location: null, attendee_emails: null, join_url: "https://us02web.zoom.us/j/81234567890" });
    expect(JSON.stringify(row)).not.toMatch(/Private notes|Hidden Way|ola@example/);
    await run(w, lawmatics({ events: list([consult("e1", { start_time: day(3), end_time: day(3.02) }, { prospect: { data: { type: "prospect", id: "p1" } } })]) }));
    expect(w.db.tables.crm_calendar_event).toHaveLength(1);
    expect(w.db.tables.crm_calendar_event[0].starts_at).toBe(day(3));
    await run(w, lawmatics({ events: list([consult("e1", { status: "cancelled", start_time: day(3), end_time: day(3.02) })]) }));
    expect(w.db.tables.crm_calendar_event).toHaveLength(0);
  });

  it("a legacy Lawmatics row and an Outlook row are never touched", async () => {
    const w = world({
      crm_calendar_event: [
        { id: "legacy", org_id: ORG, source: "lawmatics", external_id: null, lawmatics_id: "777", starts_at: day(1), is_consult: true },
        { id: "outlook", org_id: ORG, source: "outlook", external_id: "AAMk", starts_at: day(1), is_consult: true },
      ],
    });
    await run(w, lawmatics({ events: list([]) }));
    expect(w.db.tables.crm_calendar_event.map((r) => r.id).sort()).toEqual(["legacy", "outlook"]);
    for (const q of w.log.filter((x) => x.table === "crm_calendar_event" && x.action === "delete")) {
      expect(q.filters).toEqual(expect.arrayContaining([expect.objectContaining({ op: "like", column: "external_id", value: "lmsync:%" })]));
    }
  });

  it("an older row holding the event's Lawmatics id: 23505 counted, the other row untouched", async () => {
    const w = world({ crm_calendar_event: [{ id: "legacy", org_id: ORG, source: "lawmatics", external_id: null, lawmatics_id: "e1", starts_at: day(9), title: "kept" }] });
    const s = await run(w, lawmatics({ events: list([consult("e1")]) }));
    expect(s.consults.heldByOlderRow).toBe(1);
    expect(w.db.tables.crm_calendar_event).toEqual([expect.objectContaining({ id: "legacy", title: "kept" })]);
  });

  it("a consult whose prospect is before the cutoff: one targeted read, then a lead (the cutoff ignored), linked", async () => {
    const w = world();
    const lm = lawmatics({
      events: list([consult("e1", {}, { prospect: { data: { type: "prospect", id: "p9" } } })]),
      one: (id) => ({ data: prospect(id, { created_at: "2025-01-01T00:00:00Z", status: "open" }) }),
    });
    const s = await run(w, lm);
    const gets = lm.calls.filter((c) => c.method === "get");
    expect(gets.map((c) => c.path)).toEqual(["/prospects/p9"]);
    // (Q2) fields=all with the same include, so status and converted_date are there.
    expect(gets[0].opts).toEqual({ include: "stage,practice_area,contact", fields: "all" });
    expect(s.prospects.created).toBe(1);
    expect(w.db.tables.crm_calendar_event[0].lead_id).toBe(w.db.tables.crm_lead[0].id);
  });

  it("a targeted read that names another id is discarded: the consult stays unlinked and is counted", async () => {
    const w = world();
    const s = await run(w, lawmatics({ events: list([consult("e1", {}, { prospect: { data: { type: "prospect", id: "p9" } } })]), one: () => ({ data: prospect("someone-else", { status: "open" }) }) }));
    expect(s.consults.prospectReadsFailed).toBe(1);
    expect(w.db.tables.crm_lead).toHaveLength(0);
    expect(w.db.tables.crm_calendar_event[0].lead_id).toBeNull();
  });
});

describe("order (25)", () => {
  it("a daytime tick runs no hired step; the full run runs hired, prospects, consults in that order", async () => {
    const w = world();
    const lm = lawmatics();
    const day1 = await run(w, lm);
    expect(day1.hired.ran).toBe(0);
    expect(lm.calls.some((c) => c.path === "/practice_areas")).toBe(false);
    const lm2 = lawmatics();
    const full = await run(world(), lm2, { mode: "full" });
    expect(full.hired.ran).toBe(1);
    const order = lm2.calls.map((c) => c.path);
    expect(order.indexOf("/practice_areas")).toBeLessThan(order.indexOf("/events"));
    expect(order.filter((p) => p === "/prospects")).toHaveLength(1); // one shared read
  });

  it("a prospect made a lead in the daytime and hired before the next 4 AM: one lead and one matter", async () => {
    const w = world({ crm_matter_stage: [{ id: "ms1", org_id: ORG, label: "Signed LOE / Deposit Received" }] });
    await run(w, lawmatics({ prospects: list([prospect("1")]) }));
    expect(w.db.tables.crm_lead).toHaveLength(1);
    await run(
      w,
      lawmatics({ prospects: list([prospect("1", { status: "hired", converted_date: "2026-11-22", case_title: "WRENWORKS", custom_fields: [{ name: "Practice Area", value: "Trademark" }] })]) }),
      { mode: "full" },
    );
    expect(w.db.tables.crm_lead).toHaveLength(1);
    expect(w.db.tables.crm_matter).toHaveLength(1);
    expect(w.db.tables.crm_matter[0]).toMatchObject({ org_id: ORG, lawmatics_id: "1", lead_id: w.db.tables.crm_lead[0].id });
  });
});

describe("Lawmatics is only read (27) and logs carry counts only (28)", () => {
  it("only listAll and get are called on the client; the new files name no write", () => {
    for (const f of ["src/lib/lawmatics/daily-sync.ts", "src/lib/lawmatics/prospect-sync-plan.ts", "src/lib/lawmatics/consult-sync-plan.ts", "src/lib/lawmatics/events-normalize.ts"]) {
      const src = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/\bclient\.(post|put|patch|delete)\b|ctx\.client\.(post|put|patch|delete)|createProspect|createNote|createAddress|updateAddress|from "\.\/writes"|runRules|sendMail|createDraft|moveLeadStage/);
      const calls = [...src.matchAll(/client\.(\w+)\(/g)].map((m) => m[1]);
      for (const c of calls) expect(["listAll", "get"], `${f}: client.${c}`).toContain(c);
    }
  });

  it("nothing logged or returned carries a fixture name, email, title, link, description or a LawmaticsApiError body", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const SECRET = "SENTINEL-BODY-Wren";
    const w = world({ crm_lead: [{ id: "L1", org_id: ORG, email: "wren2@example.test", first_name: "Wren", last_name: "Tester2", current_stage_id: "s-lost" }] });
    const s = await run(w, lawmatics({ prospects: list([prospect("1"), prospect("2")]), events: new LawmaticsApiError(500, "/events", SECRET) }), { mode: "full" });
    const out = JSON.stringify(s) + JSON.stringify(spies.map((x) => x.mock.calls));
    for (const needle of [SECRET, "wren1@example.test", "Tester1", "Consultation", "zoom.us", "Private notes"]) expect(out).not.toContain(needle);
    for (const spy of spies) spy.mockRestore();
  });
});

describe("a refused key (29), rate limits (30), budget (31)", () => {
  it("401: the connection is set invalid (fenced on id, org and active) with a fixed last_error; reauthNeeded; the next run skips the firm", async () => {
    const w = world();
    const s = await run(w, lawmatics({ prospects: new LawmaticsApiError(401, "/prospects", "token SENTINEL") }));
    expect(s.reauthNeeded).toBe(1);
    const upd = w.log.find((q) => q.table === "lawmatics_connection" && q.action === "update")!;
    expect(upd.values).toMatchObject({ status: "invalid", last_error: LAWMATICS_SYNC_KEY_REFUSED });
    expect(upd.filters).toEqual(expect.arrayContaining([
      expect.objectContaining({ column: "id", value: "c1" }),
      expect.objectContaining({ column: "org_id", value: ORG }),
      expect.objectContaining({ column: "status", value: "active" }),
    ]));
    expect(JSON.stringify(upd.values)).not.toContain("SENTINEL");
    const lm = lawmatics();
    const next = await run(w, lm);
    expect(next.connections).toBe(0);
    expect(lm.calls).toHaveLength(0);
  });

  it("429: waits for Retry-After (capped at 10 s) and retries at most twice inside the budget; still refused = a failed read", async () => {
    const waits: number[] = [];
    let n = 0;
    const fetchImpl: FetchLike = async () => {
      n++;
      return { ok: false, status: 429, statusText: "Too Many", text: async () => "", json: async () => ({}), headers: { get: () => "30" } };
    };
    const c = createLawmaticsClient({ token: "t", fetchImpl, sleep: async (ms) => void waits.push(ms), timeLeftMs: () => 60_000 });
    await expect(c.get("/prospects")).rejects.toMatchObject({ status: 429 });
    expect(n).toBe(3);
    expect(waits).toEqual([10_000, 10_000]);

    const fallback: number[] = [];
    const c2 = createLawmaticsClient({ token: "t", fetchImpl: async () => ({ ok: false, status: 429, statusText: "x", text: async () => "", json: async () => ({}) }), sleep: async (ms) => void fallback.push(ms) });
    await expect(c2.get("/x")).rejects.toBeInstanceOf(LawmaticsApiError);
    expect(fallback).toEqual([2_000, 5_000]);

    const none: number[] = [];
    const c3 = createLawmaticsClient({ token: "t", fetchImpl, sleep: async (ms) => void none.push(ms), timeLeftMs: () => 5_000 });
    await expect(c3.get("/x")).rejects.toMatchObject({ status: 429 });
    expect(none).toEqual([]); // the wait doesn't fit the step's budget: no retry
  });

  it("a hung request is aborted at its deadline", async () => {
    const fetchImpl: FetchLike = (_input, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason ?? new DOMException("t", "TimeoutError"))));
    const c = createLawmaticsClient({ token: "t", fetchImpl, timeoutMs: 20 });
    await expect(c.get("/prospects")).rejects.toMatchObject({ name: "TimeoutError" });
  });

  it("a step that cannot fit is skipped and nothing is planned past the wall budget; a cut-short step does not set the last run", async () => {
    let t = 0;
    const clock = () => t;
    const w = world();
    const lm = lawmatics({ prospects: list([prospect("1")]) });
    // 50 s of wall budget: under the 60 s needed to start a firm.
    const s = await runLawmaticsDailySync({ admin: w.admin, client: () => lm.client, getToken: async () => "tok", now: () => NOW, clock, budgetMs: 50_000, mode: "daytime" });
    expect(s.outOfTime).toBe(1);
    expect(lm.calls).toHaveLength(0);

    // The clock jumps past the prospect step's slice while it reads: it writes nothing and leaves the last run alone.
    const w2 = world();
    const slow: LawmaticsClient = {
      async listAll(path) {
        if (path === "/prospects") t += 50_000;
        return list(path === "/prospects" ? [prospect("1")] : []);
      },
      async get() {
        return {};
      },
    };
    t = 0;
    const s2 = await runLawmaticsDailySync({ admin: w2.admin, client: () => slow, getToken: async () => "tok", now: () => NOW, clock, mode: "daytime" });
    expect(w2.db.tables.crm_lead).toHaveLength(0);
    expect(s2.outOfTime).toBeGreaterThan(0);
    expect(w2.db.tables.lawmatics_connection[0].last_sync_at).toBeNull();
  });
});

describe("last successful run", () => {
  it("a complete prospect step stamps last_sync_at with the run's start time; before 0118 (42703) the run still works", async () => {
    const w = world();
    const s = await run(w, lawmatics({ prospects: list([prospect("1")]) }));
    expect(s.prospects.lastSyncSet).toBe(1);
    expect(w.db.tables.lawmatics_connection[0].last_sync_at).toBe(NOW.toISOString());

    const old = world({}, (q) => (q.table === "lawmatics_connection" && (q.columns === "last_sync_at" || (q.action === "update" && "last_sync_at" in (q.values as Row))) ? { code: "42703" } : undefined));
    const s2 = await run(old, lawmatics({ prospects: list([prospect("1")]) }));
    expect(s2.prospects.created).toBe(1);
    expect(s2.prospects.lastSyncNotReady).toBeGreaterThan(0);
    expect(s2.prospects.lastSyncSet).toBe(0);
  });

  it("over the cap: the last run is not moved, so the next run picks up the rest", async () => {
    const w = world();
    const s = await run(w, lawmatics({ prospects: list(Array.from({ length: 55 }, (_, i) => prospect(String(i)))) }));
    expect(s.prospects.created).toBe(50);
    expect(s.prospects.overCap).toBe(5);
    expect(w.db.tables.lawmatics_connection[0].last_sync_at).toBeNull();
  });
});

describe("evaluation fixes", () => {
  const withProspect = (id: string, attrs: Row = {}) => consult(id, attrs, { prospect: { data: { type: "prospect", id: `p-${id}` } } });

  it("(1) an unreadable event with an id holds its own stored row only", async () => {
    const w = world({ crm_calendar_event: [{ id: "keep-me", org_id: ORG, source: "lawmatics", external_id: "lmsync:e2", lawmatics_id: "e2", starts_at: day(1), is_consult: true, title: "Consultation" }] });
    const s = await run(w, lawmatics({ events: list([consult("e1"), consult("e2", { start_time: "2026-11-25T14:00:00" })]) }));
    expect(s.consults.unusable).toBe(1);
    expect(w.db.tables.crm_calendar_event.map((r) => r.id)).toContain("keep-me");
    expect(w.db.tables.crm_calendar_event.some((r) => r.external_id === "lmsync:e1")).toBe(true);
  });

  it("(R2-1) an old malformed event no longer stops a cancelled consult from being removed", async () => {
    const w = world({
      crm_calendar_event: [
        { id: "cancel-me", org_id: ORG, source: "lawmatics", external_id: "lmsync:c1", lawmatics_id: "c1", starts_at: day(2), is_consult: true },
        { id: "old-bad", org_id: ORG, source: "lawmatics", external_id: "lmsync:bad", lawmatics_id: "bad", starts_at: day(1), is_consult: true },
      ],
    });
    const s = await run(w, lawmatics({ events: list([consult("c1", { status: "cancelled" }), consult("bad", { start_time: "2026-11-24T10:00:00" })]) }));
    expect(s.consults.removed).toBe(1);
    expect(w.db.tables.crm_calendar_event.map((r) => r.id)).toEqual(["old-bad"]);
  });

  it("(R2-1) a record with NO id holds every vanished row (it could be any of them)", async () => {
    const w = world({ crm_calendar_event: [{ id: "maybe", org_id: ORG, source: "lawmatics", external_id: "lmsync:m", lawmatics_id: "m", starts_at: day(1), is_consult: true }] });
    const s = await run(w, lawmatics({ events: list([consult("e1"), { type: "event", attributes: { name: "Consult", start_time: day(1) } }]) }));
    expect(s.consults.removalsHeld).toBe(1);
    expect(w.db.tables.crm_calendar_event.map((r) => r.id)).toContain("maybe");
  });

  it("(R2-2) the lookups stop with a margin left and the consult writes still happen; a hired id is never looked up", async () => {
    let t = 0;
    const w = world({ crm_matter: [{ id: "m1", org_id: ORG, lawmatics_id: "p-hired" }] });
    const lm: LawmaticsClient = {
      async listAll(path) {
        return path === "/events" ? list(["a", "b", "c"].map((x) => consult(x, {}, { prospect: { data: { type: "prospect", id: `p-${x}` } } })).concat([consult("h", {}, { prospect: { data: { type: "prospect", id: "p-hired" } } })])) : list([]);
      },
      async get(path) {
        gets.push(path);
        t += 20_000; // each lookup is slow
        return { data: prospect(path.split("/").pop()!, { status: "open", created_at: "2025-01-01T00:00:00Z", email: `${path.split("/").pop()}@example.test` }) };
      },
    };
    const gets: string[] = [];
    const s = await runLawmaticsDailySync({ admin: w.admin, client: () => lm, getToken: async () => "tok", now: () => NOW, clock: () => t, mode: "daytime" });
    expect(gets).not.toContain("/prospects/p-hired");
    expect(s.consults.hiredSkipped).toBe(1);
    expect(gets.length).toBeLessThan(3);
    expect(s.consults.lookupsDeferred).toBeGreaterThan(0);
    expect(s.consults.written).toBe(4); // the plan made before the lookups is written
  });

  it("(R2-4) the reads ask for 100 a page with a deliberate cap, and /events carries a window filter (a hint only)", async () => {
    const lm = lawmatics();
    await run(world(), lm);
    const opts = (p: string) => lm.calls.find((c) => c.path === p)!.opts as { pageSize: number; maxRecords: number; params?: Record<string, string> };
    for (const p of ["/prospects", "/contacts", "/events"]) {
      expect(opts(p).pageSize).toBe(100);
      expect(opts(p).maxRecords).toBeGreaterThan(0);
    }
    expect(Object.keys(opts("/events").params ?? {}).some((k) => k.startsWith("filter["))).toBe(true);
  });

  it("(R2-4) a 400 for the /events filter is retried once without it", async () => {
    const calls: unknown[] = [];
    const lm: LawmaticsClient = {
      async listAll(path, o) {
        if (path === "/events") {
          calls.push(o?.params);
          if (o?.params) throw new LawmaticsApiError(400, "/events", "bad filter");
          return list([consult("e1")]);
        }
        return list([]);
      },
      async get() {
        return {};
      },
    };
    const w = world();
    const s = await runLawmaticsDailySync({ admin: w.admin, client: () => lm, getToken: async () => "tok", now: () => NOW, mode: "daytime" });
    expect(calls).toHaveLength(2);
    expect(s.consults.written).toBe(1);
  });

  it("(nit) a 403 outside /prospects fails that step only; a 403 on /prospects marks the key refused", async () => {
    const w = world();
    const s = await run(w, lawmatics({ events: new LawmaticsApiError(403, "/events", "no") }));
    expect(s.reauthNeeded).toBe(0);
    expect(s.consults.failed).toBe(1);
    expect(s.failures.forbidden).toBe(1);
    const w2 = world();
    const s2 = await run(w2, lawmatics({ prospects: new LawmaticsApiError(403, "/prospects", "no") }));
    expect(s2.reauthNeeded).toBe(1);
  });

  it("(nit) a step that times out is counted as out of time, not as a failed step", async () => {
    const w = world();
    const s = await run(w, lawmatics({ events: new DOMException("t", "TimeoutError") as unknown as Error }));
    expect(s.consults.failed).toBe(0);
    expect(s.failedFirms).toBe(0);
    expect(s.outOfTime).toBeGreaterThan(0);
  });

  it("(nit) prospects with no created date are counted", async () => {
    const s = await run(world(), lawmatics({ prospects: list([prospect("1", { created_at: null })]) }));
    expect(s.prospects.noCreatedDate).toBe(1);
  });

  it("(2) two targeted prospects with the same email make ONE lead", async () => {
    const w = world();
    const lm = lawmatics({
      events: list([withProspect("a"), withProspect("b")]),
      one: (id) => ({ data: prospect(id, { email: "same@example.test", first_name: "Wren", last_name: "Tester", created_at: "2025-01-01T00:00:00Z", status: "open" }) }),
    });
    const s = await run(w, lm);
    expect(w.db.tables.crm_lead).toHaveLength(1);
    expect(s.prospects.created).toBe(1);
  });

  it("(3) the hired step reads what it read before: /contacts is read after it, by the prospect step", async () => {
    const lm = lawmatics();
    await run(world(), lm, { mode: "full" });
    const paths = lm.calls.map((c) => c.path);
    expect(paths.indexOf("/contacts")).toBeGreaterThan(paths.lastIndexOf("/practice_areas"));
  });

  it("(4) every firm's hired step runs before any prospect step; the prospect order rotates by the hour", async () => {
    let t = 0;
    const firms = ["f1", "f2", "f3"].map((o, i) => ({ id: `c${i}`, org_id: o, status: "active" }));
    const w = world({ lawmatics_connection: firms });
    const order: string[] = [];
    const slow = (org: string): LawmaticsClient => ({
      async listAll(path) {
        order.push(`${org}${path}`);
        if (path === "/contacts") t += 100_000; // a slow prospect step
        return list([]);
      },
      async get() {
        return {};
      },
    });
    let current = "";
    const s = await runLawmaticsDailySync({
      admin: w.admin,
      client: () => slow(current),
      getToken: async (_a, org) => ((current = org), "tok"),
      now: () => NOW,
      clock: () => t,
      mode: "full",
    });
    expect(s.hired.ran).toBe(3);
    const firstContacts = order.findIndex((x) => x.endsWith("/contacts"));
    expect(order.filter((x) => x.endsWith("/practice_areas"))).toHaveLength(3);
    expect(order.slice(0, firstContacts).filter((x) => x.endsWith("/practice_areas"))).toHaveLength(3);
    expect(s.outOfTime).toBeGreaterThan(0); // the slow firms used up the wall budget, said so
    const { fairOrder } = await import("@/lib/lawmatics/daily-sync");
    expect(fairOrder(["a", "b", "c"], 0)).toEqual(["a", "b", "c"]);
    expect(fairOrder(["a", "b", "c"], 3_600_000)).toEqual(["b", "c", "a"]);
    expect(fairOrder(["a", "b", "c"], 2 * 3_600_000)).toEqual(["c", "a", "b"]);
  });

  it("(5) a key that can't be opened is counted (tokenUnreadable), and nothing runs for that firm", async () => {
    const lm = lawmatics();
    const s = await runLawmaticsDailySync({ admin: world().admin, client: () => lm.client, getToken: async () => null, now: () => NOW, mode: "full" });
    expect(s.tokenUnreadable).toBe(1);
    expect(s.failedFirms).toBe(1);
    expect(lm.calls).toHaveLength(0);
  });

  it("(7) a came-back link that fails writes no flag, so the next run retries both", async () => {
    const lost = { id: "L1", org_id: ORG, email: "wren1@example.test", first_name: "Wren", last_name: "Tester1", current_stage_id: "s-lost", lawmatics_id: null };
    const w = world({ crm_lead: [{ ...lost }] }, (q) => (q.table === "crm_lead" && q.action === "update" ? { code: "XX" } : undefined));
    const lm = lawmatics({ prospects: list([prospect("1")]) });
    const s = await run(w, lm);
    expect(s.prospects.failedWrites).toBe(1);
    expect(w.db.tables.crm_activity.filter((a) => (a.payload as Row)?.kind === "came_back")).toHaveLength(0);
    w.db.refuse = undefined;
    const s2 = await run(w, lm);
    expect(s2.prospects.cameBack).toBe(1);
    expect(w.db.tables.crm_lead[0].lawmatics_id).toBe("1");
  });

  it("(8) a failed lead_created row is counted; the lead stands", async () => {
    const w = world({}, (q) => (q.table === "crm_activity" && q.action === "insert" ? { code: "XX" } : undefined));
    const s = await run(w, lawmatics({ prospects: list([prospect("1")]) }));
    expect(s.prospects.created).toBe(1);
    expect(s.prospects.timelineNotWritten).toBe(1);
  });

  it("(10) no targeted read once the create cap is used; they are counted as waiting", async () => {
    const w = world();
    const lm = lawmatics({
      prospects: list(Array.from({ length: 50 }, (_, i) => prospect(String(i)))),
      events: list([withProspect("x")]),
      one: () => ({ data: prospect("p-x", { status: "open" }) }),
    });
    const s = await run(w, lm);
    expect(s.prospects.created).toBe(50);
    expect(lm.calls.filter((c) => c.method === "get")).toHaveLength(0);
    expect(s.prospects.overCap).toBeGreaterThanOrEqual(1);
  });

  it("(13) a targeted read with no status is unusable: no lead, counted", async () => {
    const w = world();
    const s = await run(w, lawmatics({ events: list([withProspect("y")]), one: (id) => ({ data: prospect(id) }) }));
    expect(w.db.tables.crm_lead).toHaveLength(0);
    expect(s.consults.prospectReadsFailed).toBe(1);
  });

  it("(13) a targeted read of a hired prospect never becomes a new-enquiry lead", async () => {
    const w = world();
    const s = await run(w, lawmatics({ events: list([withProspect("z")]), one: (id) => ({ data: prospect(id, { status: "Hired" }) }) }));
    expect(w.db.tables.crm_lead).toHaveLength(0);
    expect(s.prospects.leftForHired).toBe(1);
  });

  it("(12) the runner's own admin client has a deadline", () => {
    expect(fs.readFileSync("src/lib/lawmatics/daily-sync.ts", "utf8")).toMatch(/getAdminClient\(\{ timeoutMs: DB_FETCH_TIMEOUT_MS \}\)/);
  });
});
