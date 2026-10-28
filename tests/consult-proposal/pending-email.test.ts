import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * pendingProposalEmail: reads every marker for a proposal version and the queue status of each;
 * and the marker `manualMarker` writes is found by the existing approve gate reader.
 */

const PROPOSAL_ID = "11111111-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;
const state = { markers: [] as Row[], markerError: false, orgKey: "rpb-law" as string | null, statuses: {} as Record<string, string>, itemFails: false };
const filters: Array<[string, unknown]> = [];

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => {
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push([c, v]), q),
      order: () => q,
      limit: () => q,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: state.markerError ? null : state.markers, error: state.markerError ? { message: "boom" } : null }).then(res, rej),
    };
    return { from: () => q };
  },
}));
vi.mock("@/lib/queue/org", () => ({ activeQueueOrgKey: async () => state.orgKey }));
vi.mock("@/lib/queue/api", () => ({
  getQueueItem: vi.fn(async (_k: string, id: string) => {
    if (state.itemFails) throw new Error("Queue API 500");
    return { id, status: state.statuses[id] ?? "pending" };
  }),
}));
vi.mock("@/lib/proposals/store", () => ({}));

import { findProposalMarker, pendingProposalEmail } from "@/lib/consult-proposal/link";
import { manualMarker } from "@/lib/consult-proposal/manual-email";

const marker = (queue_id: unknown) => ({ payload: { source: "consult-proposal", proposal_id: PROPOSAL_ID, queue_id } });

beforeEach(() => {
  filters.length = 0;
  state.markers = [];
  state.markerError = false;
  state.orgKey = "rpb-law";
  state.statuses = {};
  state.itemFails = false;
});

describe("pendingProposalEmail", () => {
  it("none when no marker exists (the queue is not asked)", async () => {
    expect(await pendingProposalEmail(PROPOSAL_ID)).toEqual({ status: "none" });
    expect(filters).toContainEqual(["payload->>proposal_id", PROPOSAL_ID]);
  });
  it("pending when an older rejected email is followed by a newer pending one", async () => {
    state.markers = [marker("q-new"), marker("q-old")];
    state.statuses = { "q-new": "pending", "q-old": "rejected" };
    expect(await pendingProposalEmail(PROPOSAL_ID)).toEqual({ status: "pending", queueId: "q-new" });
  });
  it("none when every earlier email was resolved", async () => {
    state.markers = [marker("q-1"), marker("q-2")];
    state.statuses = { "q-1": "rejected", "q-2": "approved" };
    expect(await pendingProposalEmail(PROPOSAL_ID)).toEqual({ status: "none" });
  });
  it("fails closed: unreadable markers, bad queue id, no queue key, queue error, bad proposal id", async () => {
    state.markerError = true;
    expect(await pendingProposalEmail(PROPOSAL_ID)).toEqual({ status: "unreadable" });
    state.markerError = false;
    state.markers = [marker(42)];
    expect(await pendingProposalEmail(PROPOSAL_ID)).toEqual({ status: "unreadable" });
    state.markers = [marker("q-1")];
    state.orgKey = null;
    expect(await pendingProposalEmail(PROPOSAL_ID)).toEqual({ status: "unreadable" });
    state.orgKey = "rpb-law";
    state.itemFails = true;
    expect(await pendingProposalEmail(PROPOSAL_ID)).toEqual({ status: "unreadable" });
    expect(await pendingProposalEmail("not-a-uuid")).toEqual({ status: "unreadable" });
  });
});

describe("the approve gate finds an email made by the button", () => {
  it("findProposalMarker returns the proposal for the queue id the button wrote", async () => {
    const row = manualMarker({ orgId: "o", userId: "u", leadId: "lead-1", matterId: null, proposalId: PROPOSAL_ID, queueId: "q-9", subject: "s" });
    state.markers = [{ lead_id: row.lead_id, payload: row.payload }];
    expect(await findProposalMarker("q-9")).toEqual({ status: "found", marker: { proposalId: PROPOSAL_ID, leadId: "lead-1" } });
    expect(filters).toContainEqual(["payload->>source", "consult-proposal"]);
    expect(filters).toContainEqual(["payload->>queue_id", "q-9"]);
  });
});
