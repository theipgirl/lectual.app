import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sealToken } from "@/lib/mailbox/crypto";
import { loadOrgContext, runMailboxSync } from "@/lib/mailbox/sync";
import { fakeAdmin, type Recorded } from "./fake-db";

/** RPB's shape: one info@ mailbox, no contacts, no matter-contact links; matters carry mark, serial and lead. */
const root = randomBytes(32);
const ORG = "11111111-1111-1111-1111-111111111111";
const CONN = "33333333-3333-3333-3333-333333333333";
const NOW = Date.parse("2026-11-17T12:00:00Z");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function gmail(id: string, from: string, to: string, subject: string, labels = ["INBOX"]) {
  return {
    id,
    threadId: `t-${id}`,
    labelIds: labels,
    internalDate: String(Date.parse("2026-11-16T09:00:00Z")),
    snippet: "",
    payload: { headers: [{ name: "From", value: from }, { name: "To", value: to }, { name: "Subject", value: subject }] },
  };
}

const MESSAGES: Record<string, ReturnType<typeof gmail>> = {
  // Rayn from trademarks@, cc'd into info@: firm-sent, filed by mark.
  rayn: gmail("rayn", "Rayn Lamothe <trademarks@firm.example>", "dana@highway.example", "Re: Opinion on Trademark Availability: Highway Homes"),
  // USPTO notice: inbound, filed by serial, party uspto, never the lead's reply.
  uspto: gmail("uspto", "TMOfficialNotices@uspto.gov", "info@firm.example", "Office Action Received – U.S. Trademark Application No. 99302700"),
  // A closed matter's serial: not filed.
  closed: gmail("closed", "TEAS@uspto.gov", "info@firm.example", "Serial Number 99111111: Received"),
  // Owner name only: not filed.
  owner: gmail("owner", "news@x.example", "info@firm.example", "Dana Reed in the news"),
};

function providerFetch() {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token")) return json({ access_token: "fresh", expires_in: 3600 });
    if (url.endsWith("/profile")) return json({ historyId: "9" });
    if (url.includes("/messages?q=")) return json({ messages: Object.keys(MESSAGES).map((id) => ({ id })) });
    for (const [id, body] of Object.entries(MESSAGES)) if (url.includes(`/messages/${id}?`)) return json(body);
    throw new Error(`unrouted ${url}`);
  }) as typeof fetch;
}

function db() {
  return fakeAdmin((q: Recorded) => {
    if (q.table === "crm_org" && q.action === "select") return { data: [{ id: ORG }], error: null };
    if (q.table === "mailbox_connection" && q.action === "select") {
      if (q.columns === "email") return { data: [{ email: "info@firm.example" }], error: null };
      return {
        data: [{
          id: CONN, org_id: ORG, provider: "google", email: "info@firm.example", status: "active",
          access_token_enc: sealToken(root, "a"), refresh_token_enc: sealToken(root, "r"), token_expires_at: "2026-11-17T11:00:00Z",
          sync_cursor: null, matched_count: 0,
        }],
        error: null,
      };
    }
    if (q.table === "crm_lead" && q.action === "select") {
      return { data: [{ id: "lead-1", first_name: "Dana", last_name: "Reed", business_name: null, email: "dana@highway.example", mark_text: "Highway Homes", assigned_to: null, last_outbound_at: null, last_inbound_at: null }], error: null };
    }
    if (q.table === "crm_contact" || q.table === "crm_matter_contact") return { data: [], error: null };
    if (q.table === "crm_matter") {
      return {
        data: [
          { id: "matter-hw", mark_text: "Highway Homes", serial_number: "99302700", lead_id: "lead-1", owner_name: "Dana Reed", status: "open" },
          { id: "matter-closed", mark_text: "Old Mark", serial_number: "99111111", lead_id: null, owner_name: null, status: "closed" },
        ],
        error: null,
      };
    }
    if (q.table === "crm_org_member") return { data: [], error: null };
    if (q.table === "agent_run" && q.action === "insert") return { data: [{ id: "run-1" }], error: null };
    if (q.table === "crm_activity" && q.action === "insert") {
      const rows = q.values as Array<{ payload: unknown }>;
      return { data: rows.map((r, i) => ({ id: `act-${i}`, payload: r.payload })), error: null };
    }
    return undefined;
  });
}

describe("mailbox sync files trademark mail on matters by their own facts", () => {
  it("loads only open matters for the new routes, with the lead's email, and never notes or goods", async () => {
    const { client, log } = db();
    const ctx = await loadOrgContext(client as unknown as SupabaseClient, ORG);
    expect(ctx.matters).toEqual([{ matterId: "matter-hw", markText: "Highway Homes", serialNumber: "99302700", leadEmails: ["dana@highway.example"], ownerName: "Dana Reed" }]);
    const matterRead = log.find((q) => q.table === "crm_matter")!;
    expect(matterRead.columns).not.toMatch(/notes|goods/);
  });

  it("files Rayn's cc as outbound on the matter and lead, the USPTO notice as uspto on the matter only, and nothing else", async () => {
    const { client, log } = db();
    const summary = await runMailboxSync({ admin: client as unknown as SupabaseClient, root, credentials: () => ({ clientId: "c", clientSecret: "s" }), fetchImpl: providerFetch(), now: () => NOW });
    expect(summary).toMatchObject({ ok: 1, failed: 0 });
    const rows = log.filter((q) => q.table === "crm_activity" && q.action === "insert").flatMap((q) => q.values as Array<Record<string, unknown>>);
    const byMessage = new Map(rows.map((r) => [(r.payload as { message_id: string }).message_id.replace(/^gmail:/, ""), r]));
    expect([...byMessage.keys()].sort()).toEqual(["rayn", "uspto"]);

    expect(byMessage.get("rayn")).toMatchObject({ type: "email_sent", matter_id: "matter-hw", lead_id: "lead-1" });
    expect((byMessage.get("rayn")!.payload as Record<string, unknown>).party).toBeUndefined();

    expect(byMessage.get("uspto")).toMatchObject({ type: "email_received", matter_id: "matter-hw", lead_id: null });
    expect(byMessage.get("uspto")!.payload).toMatchObject({ party: "uspto", matter_basis: "serial" });

    // The USPTO notice never moved the lead's inbound time (it is not the client's reply).
    const leadUpdates = log.filter((q) => q.table === "crm_lead" && q.action === "update");
    for (const u of leadUpdates) expect(u.values).not.toHaveProperty("last_inbound_at");
    expect(log.some((q) => q.table === "crm_notification" && q.action === "insert")).toBe(false);
  });
});
