import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItem } from "@/lib/queue/api";

/**
 * The approvals read: briefings out and oldest first BEFORE the enrichment cap, `total` over all of them, and the
 * hand-off state folded with the deck's trust rule (unreadable = unknown, every card shown).
 */
const LEAD = "11111111-1111-4111-8111-111111111111";
let items: QueueItem[] = [];
let cardState: unknown = { status: "ok", events: [] };

vi.mock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn(async () => ({ status: "ok", items })) }));
vi.mock("@/lib/queue/lead-pending", () => ({
  groupPendingByLead: vi.fn(async (_db: unknown, list: QueueItem[]) => ({ [LEAD]: list.map((i) => ({ queueId: i.id, headline: i.headline, kind: "client_draft", createdAt: i.created_at })) })),
}));
vi.mock("@/lib/queue/audit-context", () => ({ loadAuditContext: vi.fn(async () => ({ signOff: null, teamSignOff: null, memberNames: null })) }));
vi.mock("@/lib/consult-proposal/link", () => ({
  gateLinkedProposal: vi.fn(async () => ({ ok: true, proposal: null })),
  loadLinkedPanel: vi.fn(async () => ({ status: "none" })),
}));
vi.mock("@/lib/queue/stale", () => ({ checkDraftStaleness: vi.fn(async () => ({ status: "fresh" })), stalenessRequiresConfirm: () => false }));
vi.mock("@/lib/queue/card-state", () => ({ loadCardState: vi.fn(async () => cardState) }));

function item(i: number, over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: `q-${String(i).padStart(2, "0")}`,
    org_id: "k",
    matter_id: null,
    agent: "morning-brief",
    type: "CLIENT_EMAIL",
    headline: "Follow-up for a stalled lead: Maya",
    summary: null,
    draft_body: "Hi",
    final_body: null,
    status: "pending",
    // Newest first in the queue's own order, so the cap would keep the wrong ones without sorting.
    created_at: new Date(Date.UTC(2026, 10, 30 - i)).toISOString(),
    client_name: null,
    recipient: "maya@example.com",
    subject: "Hi",
    proposed_send_at: null,
    attachments: null,
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
    ...over,
  };
}

describe("readLeadApprovals", () => {
  beforeEach(() => {
    cardState = { status: "ok", events: [] };
  });

  it("drops briefings and sorts oldest first before the cap of 10; total counts every draft", async () => {
    items = [...Array.from({ length: 14 }, (_, i) => item(i)), item(99, { type: "BRIEFING", agent: "consult-prep", headline: "Consult heads-up", created_at: "2026-01-01T00:00:00.000Z" })];
    const { readLeadApprovals } = await import("@/lib/lead-step/load");
    const read = await readLeadApprovals({} as never, [LEAD], { status: "ok", routing: {}, members: [] });
    expect(read.status).toBe("ok");
    if (read.status !== "ok") return;
    expect(read.value.total).toBe(14);
    expect(read.value.items).toHaveLength(10);
    expect(read.value.items[0].id).toBe("q-13");
    expect(read.value.items.some((d) => d.kind === "internal_briefing")).toBe(false);
  });

  it("a card-state read that isn't there (or failed) is unknown for every card; a trusted hand-off names the holder", async () => {
    items = [item(1)];
    const { readLeadApprovals } = await import("@/lib/lead-step/load");
    cardState = { status: "not-set-up" };
    let read = await readLeadApprovals({} as never, [LEAD], { status: "ok", routing: {}, members: [] });
    expect(read.status === "ok" && read.value.items[0].handoff).toEqual({ status: "unknown" });
    const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const R = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    cardState = { status: "ok", events: [{ queueItemId: "q-01", kind: "handoff", actorId: A, targetUserId: R, until: null, note: "yours", createdAt: "2026-11-17T12:00:00.000Z" }] };
    read = await readLeadApprovals({} as never, [LEAD], { status: "ok", routing: {}, members: [{ userId: A, role: "attorney" }, { userId: R, role: "law_clerk" }] });
    expect(read.status === "ok" && read.value.items[0].handoff).toEqual({ status: "ok", holder: { userId: R, by: A, note: "yours", at: "2026-11-17T12:00:00.000Z" } });
    // A forged hand-off (by someone who may not approve and doesn't hold it) is dropped by the deck's trust rule.
    cardState = { status: "ok", events: [{ queueItemId: "q-01", kind: "handoff", actorId: R, targetUserId: R, until: null, note: null, createdAt: "2026-11-17T12:00:00.000Z" }] };
    read = await readLeadApprovals({} as never, [LEAD], { status: "ok", routing: {}, members: [{ userId: A, role: "attorney" }, { userId: R, role: "law_clerk" }] });
    expect(read.status === "ok" && read.value.items[0].handoff).toEqual({ status: "ok", holder: null });
  });
});
