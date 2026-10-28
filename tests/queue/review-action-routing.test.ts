import { describe, it, expect, vi, beforeEach } from "vitest";
import { followup, qitem, U } from "./routing-fixtures";

/**
 * reviewQueueAction enforces the routing rule on the server: who may approve or reject is decided from the session's
 * role and user id, the item's kind and the firm's routing; nothing from the form is trusted.
 */

const state = vi.hoisted(() => ({
  item: null as unknown,
  role: "attorney" as string,
  userId: "",
  routed: null as unknown,
  resolve: vi.fn(),
  save: vi.fn(),
  draft: vi.fn(),
  document: vi.fn(),
  gate: vi.fn(),
}));

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: state.userId, email: "who@example.com" } } }) } })),
}));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
vi.mock("@/lib/queue/audit-context", () => ({ loadAuditContext: vi.fn(async () => ({ signOff: "The Team", teamSignOff: "The Team", memberNames: [] })) }));
vi.mock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => "firm-key") }));
vi.mock("@/lib/queue/roles", async (orig) => ({ ...(await orig<object>()), resolveQueueRole: vi.fn(async (_s: unknown, allowed: string[]) => (allowed.includes(state.role) ? state.role : null)) }));
vi.mock("@/lib/queue/routing-load", () => ({ loadApprovalRouting: vi.fn(async () => state.routed) }));
vi.mock("@/lib/queue/api", () => ({
  getQueueItem: vi.fn(async () => state.item),
  saveQueueEdit: (...a: unknown[]) => state.save(...a),
  resolveQueueItem: (...a: unknown[]) => state.resolve(...a),
}));
vi.mock("@/lib/queue/stale", () => ({ checkDraftStaleness: vi.fn(async () => ({ status: "not_applicable" })), stalenessRequiresConfirm: vi.fn(() => false) }));
vi.mock("@/components/queue/stale-warning", () => ({ staleWarning: vi.fn(() => null) }));
vi.mock("@/lib/consult-proposal/link", () => ({
  gateLinkedProposal: (...a: unknown[]) => state.gate(...a),
  makeProposalLive: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/documents/approve-hook", () => ({ generateApprovedDocument: (...a: unknown[]) => state.document(...a) }));
vi.mock("@/lib/mailbox/my-mailbox", () => ({ draftInMyMailbox: (...a: unknown[]) => state.draft(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

const { reviewQueueAction } = await import("@/app/dashboard/queue/actions");

const members = [
  { userId: U.rebecca, role: "attorney", displayName: "Rebecca", email: null },
  { userId: U.caitlyn, role: "paralegal", displayName: "Caitlyn", email: null },
];
const routed = (routing: object) => ({ status: "ok", routing, members, dropped: 0, settingsExist: true });

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const as = (role: string, userId: string) => {
  state.role = role;
  state.userId = userId;
};
const act = (intent: string, extra: Record<string, string> = {}) => reviewQueueAction({}, form({ id: "q1", intent, ...extra }));
const approved = () => expect(state.resolve).toHaveBeenCalledTimes(1);
const untouched = () => {
  expect(state.save).not.toHaveBeenCalled();
  expect(state.resolve).not.toHaveBeenCalled();
  expect(state.draft).not.toHaveBeenCalled();
  expect(state.document).not.toHaveBeenCalled();
};

beforeEach(() => {
  state.item = followup({ draft_body: "Hi Bo,\n\nJust checking in.\n\nBest,\nThe Team" });
  state.routed = routed({});
  as("attorney", U.rebecca);
  state.resolve.mockReset().mockResolvedValue({ status: "approved", send: "manual" });
  state.save.mockReset().mockResolvedValue(undefined);
  state.draft.mockReset().mockResolvedValue(null);
  state.document.mockReset().mockResolvedValue(undefined);
  state.gate.mockReset().mockResolvedValue({ ok: true, proposal: null });
});

describe("reviewQueueAction: routing is enforced on the server", () => {
  it("a paralegal who owns the stalled follow-ups approves one: resolved once with the session email", async () => {
    state.routed = routed({ stalled_followup: U.caitlyn });
    as("paralegal", U.caitlyn);
    await expect(act("approve")).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
    approved();
    expect(state.resolve).toHaveBeenCalledWith(expect.objectContaining({ action: "approve", resolvedBy: "who@example.com" }));
  });

  it.each([
    ["a post-consult email", qitem()],
    ["an engagement letter", qitem({ agent: "document-center", type: "ENGAGEMENT_LETTER", headline: "LOE DRAFT" })],
    ["an opinion letter", qitem({ agent: "document-center", type: "OPINION_LETTER", headline: "Opinion letter DRAFT" })],
  ])("the same paralegal approving %s is refused: nothing saved, resolved, drafted or generated", async (_n, item) => {
    state.item = item;
    state.routed = routed({ stalled_followup: U.caitlyn, post_consult_email: U.caitlyn, engagement_letter: U.caitlyn, opinion_letter: U.caitlyn });
    as("paralegal", U.caitlyn);
    const r = await act("approve", { body: "edited" });
    expect(r.error).toBe("Only an attorney can approve this kind of message.");
    untouched();
  });

  it("a forged approve by someone who is not the owner and not the admin tier is refused", async () => {
    state.routed = routed({ stalled_followup: U.caitlyn });
    as("attorney", U.rebecca);
    const r = await act("approve", { owner: U.rebecca, role: "owner", userId: U.caitlyn });
    expect(r.error).toBe("This one is for Caitlyn. Ask them to approve it, or an owner or admin.");
    untouched();
  });

  it("a form-supplied role, user or owner is ignored", async () => {
    state.routed = routed({ stalled_followup: U.caitlyn });
    as("intake", "someone-else");
    const r = await act("approve", { role: "owner", user_id: U.caitlyn });
    expect(r.error).toMatch(/This one is for Caitlyn/);
    untouched();
  });

  it("the admin tier overrides a routed item", async () => {
    state.routed = routed({ stalled_followup: U.caitlyn });
    as("owner", "the-owner");
    await expect(act("approve")).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
    approved();
  });

  it("reject follows the same rule", async () => {
    state.routed = routed({ stalled_followup: U.caitlyn });
    as("attorney", U.rebecca);
    expect((await act("reject", { note: "no" })).error).toMatch(/This one is for Caitlyn/);
    untouched();
    as("paralegal", U.caitlyn);
    await expect(act("reject", { note: "no" })).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
    expect(state.resolve).toHaveBeenCalledWith(expect.objectContaining({ action: "reject", note: "no" }));
  });

  it("empty routing behaves as before: approvers approve everything, others nothing", async () => {
    for (const [role, ok] of [["attorney", true], ["owner", true], ["admin", true], ["senior_admin", true], ["intake", false], ["paralegal", false], ["law_clerk", false], ["clerk", false], ["viewer", false], ["social_media", false]] as const) {
      state.resolve.mockClear();
      as(role, "u");
      const run = act("approve");
      if (ok) {
        await expect(run).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
        approved();
      } else {
        expect((await run).error).toBeTruthy();
        expect(state.resolve).not.toHaveBeenCalled();
      }
    }
  });

  it("a routing read that fails does not widen access: the usual approvers only, attorney-only stays narrow", async () => {
    state.routed = { status: "failed" };
    as("paralegal", U.caitlyn);
    expect((await act("approve")).error).toBeTruthy();
    untouched();
    state.item = qitem();
    as("attorney", U.rebecca);
    await expect(act("approve")).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
    approved();
  });

  it("Save is still open to the staff roles (edit is not approval)", async () => {
    state.routed = routed({ stalled_followup: U.caitlyn });
    as("intake", "anyone");
    expect(await act("save", { body: "edited" })).toEqual({});
    expect(state.save).toHaveBeenCalledWith("firm-key", "q1", "edited");
    as("viewer", "v");
    expect((await act("save", { body: "edited" })).error).toBeTruthy();
  });
});

