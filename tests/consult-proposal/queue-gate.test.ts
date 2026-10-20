import { describe, it, expect, vi, beforeEach } from "vitest";
import { sevetri } from "../proposals/fixture";

/**
 * reviewQueueAction's approve gate for a consult-agent email: only a named
 * proposal approver, only once the linked proposal is approved, and the
 * client's link goes live BEFORE the mailbox draft exists.
 */

const QUEUE_ID = "q-42";
const PROPOSAL_ID = "11111111-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;
const state = {
  markers: [] as Row[],
  markerError: false,
  proposal: null as Row | null,
};
const calls: string[] = [];

function query(table: string) {
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    limit: () => q,
    maybeSingle: () => Promise.resolve({ data: table === "client_proposal" ? state.proposal : null, error: null }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(
        table === "crm_activity"
          ? { data: state.markerError ? null : state.markers, error: state.markerError ? { message: "boom" } : null }
          : { data: [], error: null },
      ).then(res, rej),
  };
  return q;
}

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({
    from: (t: string) => query(t),
    auth: { getUser: async () => ({ data: { user: { id: "user-1", email: "rebecca@rpb.test" } } }) },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/queue/audit-context", () => ({ loadAuditContext: vi.fn(async () => ({ signOff: null, teamSignOff: null, memberNames: [] })) }));
vi.mock("@/lib/queue/org", () => ({ activeQueueOrgKey: async () => "rpb-law" }));
vi.mock("@/lib/queue/roles", async (orig) => ({
  ...(await orig<typeof import("@/lib/queue/roles")>()),
  resolveQueueRole: async () => "attorney",
}));
vi.mock("@/lib/queue/stale", () => ({
  checkDraftStaleness: async () => ({ status: "clear", leadIds: [], leadName: null, linkedBy: "draft" }),
  stalenessRequiresConfirm: () => false,
}));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/documents/approve-hook", () => ({ generateApprovedDocument: async () => undefined }));

const item = { id: QUEUE_ID, type: "CLIENT_EMAIL", recipient: "c@example.com", subject: "Your Trademark Proposal", headline: "h", draft_body: "body", final_body: null };
vi.mock("@/lib/queue/api", () => ({
  getQueueItem: async () => item,
  saveQueueEdit: vi.fn(),
  resolveQueueItem: vi.fn(async () => {
    calls.push("resolve");
    return { send: "none" };
  }),
}));
vi.mock("@/lib/mailbox/my-mailbox", () => ({
  draftInMyMailbox: vi.fn(async () => {
    calls.push("mailbox");
    return { provider: "gmail" };
  }),
}));

const approver = { value: true };
const sendFails = { value: false };
vi.mock("@/lib/proposals/store", async (orig) => ({
  ...(await orig<typeof import("@/lib/proposals/store")>()),
  isCurrentUserApprover: async () => approver.value,
  sendProposal: vi.fn(async () => {
    calls.push("send");
    if (sendFails.value) throw new Error("db down");
    return {};
  }),
}));

import { reviewQueueAction } from "@/app/dashboard/queue/actions";
import { sendProposal } from "@/lib/proposals/store";
import { resolveQueueItem } from "@/lib/queue/api";
import { draftInMyMailbox } from "@/lib/mailbox/my-mailbox";

function proposalRow(status: string): Row {
  return {
    id: PROPOSAL_ID,
    version: 1,
    status,
    client_name: "Sevetri Wilson",
    client_email: "c@example.com",
    title: "Trademark Proposal",
    content: sevetri(),
    expires_on: "2026-11-01",
    pay_url: "https://pay.example.com/x",
  };
}

function form(intent = "approve") {
  const f = new FormData();
  f.set("id", QUEUE_ID);
  f.set("intent", intent);
  return f;
}

async function approve(): Promise<{ error?: string; redirected?: string }> {
  try {
    return await reviewQueueAction({}, form());
  } catch (e) {
    if ((e as Error).message === "NEXT_REDIRECT") return { redirected: (e as { url: string }).url };
    throw e;
  }
}

beforeEach(() => {
  calls.length = 0;
  vi.mocked(sendProposal).mockClear();
  vi.mocked(resolveQueueItem).mockClear();
  vi.mocked(draftInMyMailbox).mockClear();
  state.markers = [{ lead_id: "lead-1", payload: { source: "consult-proposal", queue_id: QUEUE_ID, proposal_id: PROPOSAL_ID } }];
  state.markerError = false;
  state.proposal = proposalRow("approved");
  approver.value = true;
  sendFails.value = false;
});

describe("approving a consult-agent email", () => {
  it("refuses a reviewer who is not a named proposal approver, and resolves nothing", async () => {
    approver.value = false;
    const r = await approve();
    expect(r.error).toMatch(/only the firm's named proposal approvers/i);
    expect(resolveQueueItem).not.toHaveBeenCalled();
    expect(draftInMyMailbox).not.toHaveBeenCalled();
  });

  it("refuses while the linked proposal is still a draft", async () => {
    state.proposal = proposalRow("draft");
    const r = await approve();
    expect(r.error).toBe("Approve the proposal first: open it, review it, and click Approve.");
    expect(resolveQueueItem).not.toHaveBeenCalled();
    expect(sendProposal).not.toHaveBeenCalled();
  });

  it("refuses a withdrawn proposal", async () => {
    state.proposal = proposalRow("withdrawn");
    expect((await approve()).error).toMatch(/withdrawn/);
    expect(resolveQueueItem).not.toHaveBeenCalled();
  });

  it("fails closed when the link can't be read", async () => {
    state.markerError = true;
    const r = await approve();
    expect(r.error).toMatch(/couldn't check the proposal/i);
    expect(resolveQueueItem).not.toHaveBeenCalled();
  });

  it("fails closed when the marker names a proposal that can't be found", async () => {
    state.proposal = null;
    expect((await approve()).error).toMatch(/couldn't read the proposal/i);
    expect(resolveQueueItem).not.toHaveBeenCalled();
  });

  it("with an approved proposal: makes the link live (sendProposal) BEFORE resolving, so before any mailbox draft", async () => {
    const r = await approve();
    expect(r.redirected).toContain(`/dashboard/queue/${QUEUE_ID}/?resolved=approve`);
    expect(sendProposal).toHaveBeenCalledWith(PROPOSAL_ID);
    // resolve may itself create the draft (the queue service's Outlook channel), so the link goes live first
    expect(calls).toEqual(["send", "resolve", "mailbox"]);
  });

  it("when the queue service drafts the email itself on resolve, the link is already live", async () => {
    vi.mocked(resolveQueueItem).mockImplementationOnce(async () => {
      calls.push("resolve");
      return { status: "approved", send: "drafted" };
    });
    const r = await approve();
    expect(r.redirected).toContain("send=drafted");
    expect(calls).toEqual(["send", "resolve"]);
    expect(draftInMyMailbox).not.toHaveBeenCalled();
  });

  it("an already-sent proposal is not sent again, and the draft is still made", async () => {
    state.proposal = proposalRow("sent");
    await approve();
    expect(sendProposal).not.toHaveBeenCalled();
    expect(calls).toEqual(["resolve", "mailbox"]);
  });

  it("if the link can't be made live, nothing is approved and no mailbox draft is created anywhere", async () => {
    sendFails.value = true;
    const r = await approve();
    expect(r.error).toMatch(/could not be made live/);
    expect(r.error).toMatch(/nothing was approved and no mailbox draft was created/);
    expect(resolveQueueItem).not.toHaveBeenCalled();
    expect(draftInMyMailbox).not.toHaveBeenCalled();
  });

  it("a proposal edited after approval (back to draft) between the gate and going live: nothing is approved", async () => {
    // The gate read "approved"; by the time it is made live, an edit has returned it to draft and the send is refused.
    sendFails.value = true;
    vi.mocked(sendProposal).mockImplementationOnce(async () => {
      calls.push("send");
      state.proposal = proposalRow("draft");
      throw new Error("Only an approved version can be marked as sent. Approve it first.");
    });
    const r = await approve();
    expect(r.error).toMatch(/could not be made live/);
    expect(resolveQueueItem).not.toHaveBeenCalled();
    expect(draftInMyMailbox).not.toHaveBeenCalled();
  });

  it("an ordinary queue item (no marker) is approved exactly as before, with no proposal calls", async () => {
    state.markers = [];
    approver.value = false; // would be refused if the gate applied
    const r = await approve();
    expect(r.redirected).toBeDefined();
    expect(sendProposal).not.toHaveBeenCalled();
    expect(calls).toEqual(["resolve", "mailbox"]);
  });

  it("reject is unchanged: no gate, needs a note", async () => {
    approver.value = false;
    state.proposal = proposalRow("draft");
    const f = form("reject");
    expect((await reviewQueueAction({}, f)).error).toMatch(/note/i);
    f.set("note", "not right");
    try {
      await reviewQueueAction({}, f);
    } catch (e) {
      expect((e as Error).message).toBe("NEXT_REDIRECT");
    }
    expect(resolveQueueItem).toHaveBeenCalledWith(expect.objectContaining({ action: "reject" }));
  });
});
