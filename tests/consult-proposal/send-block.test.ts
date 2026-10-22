import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Mark as sent" for a proposal the consult agent drafted: refused while its
 * email is pending in the approval queue (or the queue can't be read), allowed
 * once that email was rejected. Ordinary proposals are untouched.
 */

const PROPOSAL_ID = "11111111-1111-4111-8111-111111111111";
const QUEUE_ID = "q-42";
const REFUSAL = "This proposal goes live when an attorney approves its email in the approval queue.";

type Row = Record<string, unknown>;
const state = {
  markers: [] as Row[],
  markerError: false,
  markerThrows: false,
  orgKey: "rpb-law" as string | null,
  itemStatus: "pending" as string,
  itemFails: false,
  source: "agent" as string,
  proposalFails: false,
};
const filters: Array<[string, unknown]> = [];

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => {
    if (state.markerThrows) throw new Error("no session");
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => {
        filters.push([c, v]);
        return q;
      },
      limit: () => q,
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: state.markerError ? null : state.markers, error: state.markerError ? { message: "boom" } : null }).then(res, rej),
    };
    return { from: () => q };
  },
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/queue/org", () => ({ activeQueueOrgKey: async () => state.orgKey }));
vi.mock("@/lib/queue/api", () => ({
  getQueueItem: vi.fn(async () => {
    if (state.itemFails) throw new Error("Queue API 500");
    return { id: QUEUE_ID, status: state.itemStatus };
  }),
}));
vi.mock("../../src/app/dashboard/proposals/gate", () => ({ gateStaffAction: async () => null }));
vi.mock("@/lib/proposals/store", async (orig) => ({
  ...(await orig<typeof import("@/lib/proposals/store")>()),
  getProposal: vi.fn(async () => {
    if (state.proposalFails) throw new Error("db down");
    return { proposal: { id: PROPOSAL_ID, status: "approved", source: state.source }, versions: [], events: [] };
  }),
  sendProposal: vi.fn(async () => ({})),
}));

import { sendAction } from "@/app/dashboard/proposals/[id]/actions";
import { proposalSendBlock } from "@/lib/consult-proposal/link";
import { getQueueItem } from "@/lib/queue/api";
import { sendProposal } from "@/lib/proposals/store";

function form() {
  const f = new FormData();
  f.set("proposalId", PROPOSAL_ID);
  return f;
}

beforeEach(() => {
  filters.length = 0;
  vi.mocked(sendProposal).mockClear();
  vi.mocked(getQueueItem).mockClear();
  state.markers = [{ payload: { source: "consult-proposal", queue_id: QUEUE_ID, proposal_id: PROPOSAL_ID } }];
  state.markerError = false;
  state.markerThrows = false;
  state.orgKey = "rpb-law";
  state.itemStatus = "pending";
  state.itemFails = false;
  state.source = "agent";
  state.proposalFails = false;
});

describe("proposalSendBlock", () => {
  it("blocks while the linked queue email is pending, and names the queue item", async () => {
    expect(await proposalSendBlock(PROPOSAL_ID)).toEqual({ blocked: true, queueId: QUEUE_ID, reason: "pending" });
    expect(filters).toContainEqual(["payload->>proposal_id", PROPOSAL_ID]);
    expect(filters).toContainEqual(["payload->>source", "consult-proposal"]);
  });

  it("allows it when the email was rejected, or already approved", async () => {
    for (const status of ["rejected", "approved"]) {
      state.itemStatus = status;
      expect(await proposalSendBlock(PROPOSAL_ID)).toEqual({ blocked: false });
    }
  });

  it("allows it when no consult-proposal marker exists", async () => {
    state.markers = [];
    expect(await proposalSendBlock(PROPOSAL_ID)).toEqual({ blocked: false });
    expect(getQueueItem).not.toHaveBeenCalled();
  });

  it("fails closed: unreadable marker, broken marker, no queue, unreadable item", async () => {
    state.markerError = true;
    expect(await proposalSendBlock(PROPOSAL_ID)).toEqual({ blocked: true, queueId: null, reason: "unreadable" });
    state.markerError = false;
    state.markerThrows = true;
    expect(await proposalSendBlock(PROPOSAL_ID)).toMatchObject({ blocked: true, reason: "unreadable" });
    state.markerThrows = false;
    state.markers = [{ payload: { source: "consult-proposal", proposal_id: PROPOSAL_ID } }];
    expect(await proposalSendBlock(PROPOSAL_ID)).toEqual({ blocked: true, queueId: null, reason: "unreadable" });
    state.markers = [{ payload: { source: "consult-proposal", queue_id: QUEUE_ID, proposal_id: PROPOSAL_ID } }];
    state.orgKey = null;
    expect(await proposalSendBlock(PROPOSAL_ID)).toEqual({ blocked: true, queueId: QUEUE_ID, reason: "unreadable" });
    state.orgKey = "rpb-law";
    state.itemFails = true;
    expect(await proposalSendBlock(PROPOSAL_ID)).toEqual({ blocked: true, queueId: QUEUE_ID, reason: "unreadable" });
  });
});

describe("sendAction", () => {
  it("refuses a consult proposal whose email is pending, and sends nothing", async () => {
    expect(await sendAction({}, form())).toEqual({ error: REFUSAL });
    expect(sendProposal).not.toHaveBeenCalled();
  });

  it("refuses when the queue can't be read", async () => {
    state.itemFails = true;
    expect(await sendAction({}, form())).toEqual({ error: REFUSAL });
    expect(sendProposal).not.toHaveBeenCalled();
  });

  it("marks it sent once the queue email was rejected", async () => {
    state.itemStatus = "rejected";
    expect(await sendAction({}, form())).toMatchObject({ saved: true });
    expect(sendProposal).toHaveBeenCalledWith(PROPOSAL_ID);
  });

  it("leaves a staff-made proposal alone, without touching the queue", async () => {
    state.source = "staff";
    expect(await sendAction({}, form())).toMatchObject({ saved: true });
    expect(getQueueItem).not.toHaveBeenCalled();
  });

  it("refuses when the proposal itself can't be read", async () => {
    state.proposalFails = true;
    expect(await sendAction({}, form())).toEqual({ error: REFUSAL });
    expect(sendProposal).not.toHaveBeenCalled();
  });
});
