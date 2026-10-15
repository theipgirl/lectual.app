import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb, type Row } from "../quotes/fake-db";
import type { QueueItem } from "@/lib/queue/api";

/**
 * The approval-time warning (intake SOP §2.5): a client email queued before the
 * client signed or paid needs an explicit confirm to approve — never an
 * automatic reject — and the server action refuses without it.
 */

const state = vi.hoisted(() => ({ db: null as unknown, item: null as unknown, resolve: vi.fn() }));

vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => state.db) }));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
vi.mock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => "firm-key") }));
vi.mock("@/lib/queue/roles", () => ({
  QUEUE_APPROVE_ROLES: ["owner"],
  QUEUE_EDIT_ROLES: ["owner"],
  resolveQueueRole: vi.fn(async () => "owner"),
}));
vi.mock("@/lib/queue/api", () => ({
  getQueueItem: vi.fn(async () => state.item),
  saveQueueEdit: vi.fn(async () => undefined),
  resolveQueueItem: (...args: unknown[]) => state.resolve(...args),
}));
vi.mock("@/lib/documents/approve-hook", () => ({ generateApprovedDocument: vi.fn(async () => undefined) }));
vi.mock("@/lib/mailbox/my-mailbox", () => ({ draftInMyMailbox: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

const { checkDraftStaleness, stalenessRequiresConfirm, isClientFacing } = await import("@/lib/queue/stale");
const { staleWarning } = await import("@/components/queue/stale-warning");
const { reviewQueueAction } = await import("@/app/dashboard/queue/actions");

const ORG = "org-1";
const QUEUED = "2026-10-03T14:00:00Z";

function item(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "q-item-1",
    org_id: "firm-key",
    matter_id: null,
    agent: "campaign",
    type: "CLIENT_EMAIL",
    headline: "Following up",
    summary: null,
    draft_body: "Hi Dana",
    final_body: null,
    status: "pending",
    created_at: QUEUED,
    client_name: "Dana Reyes",
    recipient: "dana@acme.example",
    subject: "Following up",
    proposed_send_at: null,
    attachments: null,
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
    ...over,
  };
}

function tables(): Record<string, Row[]> {
  return {
    crm_activity: [{ id: "a-1", org_id: ORG, lead_id: "lead-1", type: "queue_drafted", "payload->>queueItemId": "q-item-1" }],
    crm_lead: [
      { id: "lead-1", org_id: ORG, first_name: "Dana", last_name: "Reyes", business_name: null, email: "dana@acme.example", current_stage_id: "st-open", stage_entered_at: "2026-09-01T00:00:00Z", last_inbound_at: null },
    ],
    crm_stage: [{ id: "st-open", org_id: ORG, category: "open" }],
    crm_quote: [{ id: "q-1", org_id: ORG, lead_id: "lead-1", status: "accepted", accepted_at: "2026-10-03T21:10:00Z" }],
    crm_payment: [],
    crm_matter: [],
    crm_meeting: [],
  };
}

let db: FakeDb;
beforeEach(() => {
  db = new FakeDb(tables());
  state.db = { from: (t: string) => db.from(t), auth: { getUser: async () => ({ data: { user: { id: "u-1", email: "rebecca@example.com" } } }) }, rpc: async () => ({ data: "owner", error: null }) };
  state.item = item();
  state.resolve.mockReset();
  state.resolve.mockResolvedValue({ status: "approved", send: "drafted" });
});

describe("checkDraftStaleness", () => {
  it("links the draft to its lead through the queue_drafted row, and flags a signature since it was queued", async () => {
    const check = await checkDraftStaleness(item());
    expect(check).toMatchObject({ status: "stale", leadIds: ["lead-1"], leadName: "Dana Reyes", linkedBy: "draft" });
    expect(stalenessRequiresConfirm(check)).toBe(true);
    const warning = staleWarning(check, "America/New_York");
    expect(warning?.headline).toBe("Signed Oct 3 — this follow-up may be stale");
    expect(warning?.detail).toContain("Dana Reyes signed the quote after this draft was queued");
  });

  it("a signature from before the draft was queued is not stale", async () => {
    db.tables.crm_quote[0].accepted_at = "2026-10-02T00:00:00Z";
    const check = await checkDraftStaleness(item());
    expect(check.status).toBe("clear");
    expect(stalenessRequiresConfirm(check)).toBe(false);
    expect(staleWarning(check)).toBeNull();
  });

  it("a signature between the drafter's check and the draft reaching the queue is still 'since' (the race)", async () => {
    // The campaign step read the facts at 13:59:58, the client signed at
    // 13:59:59, and the queue stamped the draft 14:00:00.
    db.tables.crm_activity[0].payload = { queueItemId: "q-item-1", facts_checked_at: "2026-10-03T13:59:58Z" };
    db.tables.crm_quote[0].accepted_at = "2026-10-03T13:59:59Z";
    const check = await checkDraftStaleness(item());
    expect(check.status).toBe("stale");
    expect(stalenessRequiresConfirm(check)).toBe(true);
  });

  it("a SECOND signature after the draft is stale even though the first came before it", async () => {
    db.tables.crm_quote[0].accepted_at = "2026-09-20T00:00:00Z";
    db.tables.crm_quote.push({ id: "q-2", org_id: ORG, lead_id: "lead-1", status: "accepted", accepted_at: "2026-10-04T09:00:00Z" });
    const check = await checkDraftStaleness(item());
    expect(check).toMatchObject({ status: "stale", facts: [{ reason: "signed", at: "2026-10-04T09:00:00Z" }] });
  });

  it("checks the person: a payment on a same-address duplicate lead row makes the draft stale", async () => {
    db.tables.crm_quote = [{ id: "q-9", org_id: ORG, lead_id: "lead-9", status: "accepted", accepted_at: "2026-09-01T00:00:00Z" }];
    db.tables.crm_lead.push({ id: "lead-9", org_id: ORG, email: "dana@acme.example", current_stage_id: "st-open", stage_entered_at: "2026-09-01T00:00:00Z", last_inbound_at: null });
    db.tables.crm_payment = [{ id: "p-9", org_id: ORG, quote_id: "q-9", matter_id: null, status: "succeeded", occurred_at: "2026-10-04T02:00:00Z" }];
    const check = await checkDraftStaleness(item());
    expect(check).toMatchObject({ status: "stale", linkedBy: "draft", facts: [{ reason: "paid" }] });
  });

  it("falls back to the recipient's exact address when no drafter linked the item", async () => {
    db.tables.crm_activity = [];
    const check = await checkDraftStaleness(item());
    expect(check).toMatchObject({ status: "stale", linkedBy: "recipient" });
  });

  it("says so when it can't link the draft to any lead — no warning, no false all-clear", async () => {
    db.tables.crm_activity = [];
    const check = await checkDraftStaleness(item({ recipient: "nobody@nowhere.example" }));
    expect(check.status).toBe("unlinked");
    expect(stalenessRequiresConfirm(check)).toBe(false);
  });

  it("fails closed: a lead whose payment state can't be read needs a confirm", async () => {
    db.failTable = "crm_payment";
    const check = await checkDraftStaleness(item());
    expect(check.status).toBe("unavailable");
    expect(stalenessRequiresConfirm(check)).toBe(true);
  });

  it("only pending client-facing drafts are checked", async () => {
    expect((await checkDraftStaleness(item({ status: "approved" }))).status).toBe("not_applicable");
    expect(isClientFacing({ type: "BRIEFING", recipient: null })).toBe(false);
    expect((await checkDraftStaleness(item({ type: "BRIEFING", recipient: null }))).status).toBe("not_applicable");
  });
});

describe("approving a stale draft", () => {
  function form(fields: Record<string, string>): FormData {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  }

  it("is refused without the explicit confirm — and nothing is rejected on anyone's behalf", async () => {
    const result = await reviewQueueAction({}, form({ id: "q-item-1", intent: "approve" }));
    expect(result.error).toMatch(/^Signed Oct 3 — this follow-up may be stale\. Tick the confirmation box/);
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it("goes through with the confirm, resolved by the session, with the warning on the record", async () => {
    await expect(reviewQueueAction({}, form({ id: "q-item-1", intent: "approve", confirm_stale: "yes" }))).rejects.toMatchObject({
      message: "NEXT_REDIRECT",
    });
    expect(state.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "approve",
        resolvedBy: "rebecca@example.com",
        note: "Approved after a stale-draft warning: Signed Oct 3 — this follow-up may be stale.",
      }),
    );
  });

  it("a current draft approves with no confirm", async () => {
    db.tables.crm_quote = [];
    await expect(reviewQueueAction({}, form({ id: "q-item-1", intent: "approve" }))).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
    expect(state.resolve).toHaveBeenCalledWith(expect.not.objectContaining({ note: expect.anything() }));
  });
});
