import { describe, it, expect, vi } from "vitest";
import { FakeDb, type Row } from "../quotes/fake-db";
import type { QueueItem } from "@/lib/queue/api";
import type { QueueLoad } from "@/lib/queue/load";
import type { StopDb } from "@/lib/campaigns/stop-db";

/**
 * Pending approvals by lead (intake view badges + lead-page panel). The point
 * of the suite: every outcome other than "we read the queue and mapped it" is
 * a named state, never an empty map; and the linking rules are the stale
 * check's, run batched.
 */

vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => new FakeDb({})) }));
vi.mock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => "firm-key") }));

const { loadPendingApprovalsByLead, groupPendingByLead } = await import("@/lib/queue/lead-pending");

function item(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "q-1",
    org_id: "firm-key",
    matter_id: null,
    agent: "campaign",
    type: "CLIENT_EMAIL",
    headline: "Following up with Dana",
    summary: null,
    draft_body: "Hi",
    final_body: null,
    status: "pending",
    created_at: "2026-10-19T14:00:00Z",
    client_name: null,
    recipient: null,
    subject: null,
    proposed_send_at: null,
    attachments: null,
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
    ...over,
  };
}

/** A queue_drafted row; the fake keys JSON-path filters by the literal column name. */
function drafted(leadId: string, key: "queueItemId" | "queue_id", id: string, kind?: string): Row {
  return { lead_id: leadId, type: "queue_drafted", payload: { [key]: id, ...(kind ? { kind } : {}) }, [`payload->>${key}`]: id };
}

/** FakeDb is the PostgREST fake the stop/stale tests already cast the same way. */
const asDb = (db: FakeDb) => db as unknown as StopDb;

const ok = (items: QueueItem[]): (() => Promise<QueueLoad>) => async () => ({ status: "ok", items });

describe("loadPendingApprovalsByLead", () => {
  it("passes unconfigured and unavailable queues through without touching the db", async () => {
    const db = new FakeDb({});
    expect(await loadPendingApprovalsByLead({ load: async () => ({ status: "unconfigured", items: [], reason: "org-key" }), db: asDb(db) })).toEqual({ status: "unconfigured" });
    expect(await loadPendingApprovalsByLead({ load: async () => ({ status: "unavailable", items: [] }), db: asDb(db) })).toEqual({ status: "unavailable" });
    expect(db.queryCount.value).toBe(0);
  });

  it("is ok with an empty map when the queue was reached and nothing is pending", async () => {
    const db = new FakeDb({});
    expect(await loadPendingApprovalsByLead({ load: ok([]), db: asDb(db) })).toEqual({ status: "ok", byLead: {} });
    expect(db.queryCount.value).toBe(0);
  });

  it("fails closed to unavailable when mapping hits a db error, never an empty ok", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = new FakeDb({ crm_activity: [] });
    db.failTable = "crm_activity";
    expect(await loadPendingApprovalsByLead({ load: ok([item()]), db: asDb(db) })).toEqual({ status: "unavailable" });
    spy.mockRestore();
  });

  it("fails closed when a later rule's read errors (matter lookup)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = new FakeDb({ crm_activity: [] });
    db.failTable = "crm_matter";
    const m = "11111111-1111-4111-8111-111111111111";
    expect(await loadPendingApprovalsByLead({ load: ok([item({ matter_id: m, recipient: null })]), db: asDb(db) })).toEqual({ status: "unavailable" });
    spy.mockRestore();
  });

  it("returns unavailable when the scoped client itself cannot be built", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getScopedClient } = await import("@/lib/db/scoped-client");
    vi.mocked(getScopedClient).mockRejectedValueOnce(new Error("no session"));
    expect(await loadPendingApprovalsByLead({ load: ok([item()]) })).toEqual({ status: "unavailable" });
    spy.mockRestore();
  });
});

describe("groupPendingByLead linking rules", () => {
  it("links by the drafter's queue_drafted row (queueItemId, then queue_id)", async () => {
    const db = new FakeDb({
      crm_activity: [drafted("lead-1", "queueItemId", "q-1"), drafted("lead-2", "queue_id", "q-2")],
    });
    const out = await groupPendingByLead(asDb(db), [item({ id: "q-1" }), item({ id: "q-2", headline: "Meeting follow-up" })]);
    expect(Object.keys(out).sort()).toEqual(["lead-1", "lead-2"]);
    expect(out["lead-1"][0]).toMatchObject({ queueId: "q-1", headline: "Following up with Dana", kind: "client_draft" });
    expect(out["lead-2"][0].queueId).toBe("q-2");
  });

  it("is batched: one query per rule regardless of how many items", async () => {
    const db = new FakeDb({ crm_activity: [], crm_matter: [], crm_lead: [] });
    const m = "11111111-1111-4111-8111-111111111111";
    const items = Array.from({ length: 20 }, (_, i) => item({ id: `q-${i}`, matter_id: m, recipient: `p${i}@x.example` }));
    await groupPendingByLead(asDb(db), items);
    // queueItemId + queue_id + matter + recipient = 4, not 20+.
    expect(db.queryCount.value).toBe(4);
  });

  it("prefers the draft link over matter and recipient, like the stale check", async () => {
    const m = "11111111-1111-4111-8111-111111111111";
    const db = new FakeDb({
      crm_activity: [drafted("lead-draft", "queueItemId", "q-1")],
      crm_matter: [{ id: m, lead_id: "lead-matter" }],
      crm_lead: [{ id: "lead-recipient", email: "dana@acme.example" }],
    });
    const out = await groupPendingByLead(asDb(db), [item({ matter_id: m, recipient: "dana@acme.example" })]);
    expect(Object.keys(out)).toEqual(["lead-draft"]);
  });

  it("falls to the matter's lead, then to an exact recipient address", async () => {
    const m = "11111111-1111-4111-8111-111111111111";
    const db = new FakeDb({
      crm_activity: [],
      crm_matter: [{ id: m, lead_id: "lead-matter" }],
      crm_lead: [
        { id: "lead-a", email: "dana@acme.example" },
        { id: "lead-b", email: "dana@acme.example" },
        { id: "lead-other", email: "someone@else.example" },
      ],
    });
    const out = await groupPendingByLead(asDb(db), [
      item({ id: "q-m", matter_id: m }),
      item({ id: "q-r", recipient: "Dana@Acme.example" }),
    ]);
    expect(out["lead-matter"].map((a) => a.queueId)).toEqual(["q-m"]);
    // The same person on two lead rows: both are listed.
    expect(out["lead-a"].map((a) => a.queueId)).toEqual(["q-r"]);
    expect(out["lead-b"].map((a) => a.queueId)).toEqual(["q-r"]);
    expect(out["lead-other"]).toBeUndefined();
  });

  it("falls through to the recipient when the matter has no lead", async () => {
    const m = "11111111-1111-4111-8111-111111111111";
    const db = new FakeDb({
      crm_activity: [],
      crm_matter: [{ id: m, lead_id: null }],
      crm_lead: [{ id: "lead-a", email: "dana@acme.example" }],
    });
    const out = await groupPendingByLead(asDb(db), [item({ matter_id: m, recipient: "dana@acme.example" })]);
    expect(Object.keys(out)).toEqual(["lead-a"]);
  });

  it("leaves an item no rule resolves unlisted rather than guessing", async () => {
    const db = new FakeDb({ crm_activity: [], crm_matter: [], crm_lead: [] });
    expect(await groupPendingByLead(asDb(db), [item({ recipient: "nobody@x.example" })])).toEqual({});
  });

  it("never puts a malformed id in a filter", async () => {
    const db = new FakeDb({ crm_activity: [], crm_matter: [], crm_lead: [] });
    const out = await groupPendingByLead(asDb(db), [item({ id: "bad id),or(1=1", matter_id: "not-a-uuid", recipient: null })]);
    expect(out).toEqual({});
    expect(db.queryCount.value).toBe(0);
  });
});

describe("kind and ordering", () => {
  it("maps payload.kind heads_up to a brief for Rebecca, even though it has no recipient", async () => {
    const db = new FakeDb({ crm_activity: [drafted("lead-1", "queueItemId", "q-b", "heads_up"), drafted("lead-1", "queueItemId", "q-c", "client_prep")] });
    const out = await groupPendingByLead(asDb(db), [
      item({ id: "q-b", type: "BRIEFING", recipient: null, headline: "Heads-up: Dana consult" }),
      item({ id: "q-c", type: "CLIENT_EMAIL", recipient: "dana@acme.example" }),
    ]);
    const kinds = Object.fromEntries(out["lead-1"].map((a) => [a.queueId, a.kind]));
    expect(kinds).toEqual({ "q-b": "rebecca_brief", "q-c": "client_draft" });
  });

  it("treats an addressed non-CLIENT_EMAIL draft as a client draft and an internal one as other", async () => {
    const db = new FakeDb({ crm_activity: [drafted("lead-1", "queueItemId", "q-1"), drafted("lead-1", "queueItemId", "q-2")] });
    const out = await groupPendingByLead(asDb(db), [
      item({ id: "q-1", type: "DOC", recipient: "a@b.example" }),
      item({ id: "q-2", type: "NOTE", recipient: null }),
    ]);
    const kinds = Object.fromEntries(out["lead-1"].map((a) => [a.queueId, a.kind]));
    expect(kinds).toEqual({ "q-1": "client_draft", "q-2": "other" });
  });

  it("orders a lead's approvals newest first and falls back when the headline is blank", async () => {
    const db = new FakeDb({ crm_activity: [drafted("lead-1", "queueItemId", "q-old"), drafted("lead-1", "queueItemId", "q-new")] });
    const out = await groupPendingByLead(asDb(db), [
      item({ id: "q-old", created_at: "2026-10-01T10:00:00Z" }),
      item({ id: "q-new", created_at: "2026-10-18T10:00:00Z", headline: "  ", subject: "Re: your filing" }),
    ]);
    expect(out["lead-1"].map((a) => a.queueId)).toEqual(["q-new", "q-old"]);
    expect(out["lead-1"][0].headline).toBe("Re: your filing");
  });
});
