import { describe, it, expect, vi, beforeEach } from "vitest";
import type { QueueItem } from "@/lib/queue/api";

/**
 * reviewQueueAction refuses to APPROVE a client email while its final body
 * holds banner text, worksheet text, an unresolved placeholder or another
 * member's signature (H7). Reject and Save are never held up by it.
 */

const state = vi.hoisted(() => ({
  item: null as unknown,
  audit: null as unknown,
  resolve: vi.fn(),
  save: vi.fn(),
  getItem: vi.fn(),
}));

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: "u-1", email: "rebecca@example.com" } } }) } })),
}));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
vi.mock("@/lib/queue/audit-context", () => ({ loadAuditContext: vi.fn(async () => state.audit) }));
vi.mock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => "firm-key") }));
vi.mock("@/lib/queue/roles", () => ({
  QUEUE_APPROVE_ROLES: ["owner"],
  QUEUE_EDIT_ROLES: ["owner"],
  resolveQueueRole: vi.fn(async () => "owner"),
}));
vi.mock("@/lib/queue/api", () => ({
  getQueueItem: (...a: unknown[]) => state.getItem(...a),
  saveQueueEdit: (...a: unknown[]) => state.save(...a),
  resolveQueueItem: (...a: unknown[]) => state.resolve(...a),
}));
vi.mock("@/lib/queue/stale", () => ({
  checkDraftStaleness: vi.fn(async () => ({ status: "not_applicable" })),
  stalenessRequiresConfirm: vi.fn(() => false),
}));
vi.mock("@/components/queue/stale-warning", () => ({ staleWarning: vi.fn(() => null) }));
vi.mock("@/lib/consult-proposal/link", () => ({
  gateLinkedProposal: vi.fn(async () => ({ ok: true, proposal: null })),
  makeProposalLive: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/lib/documents/approve-hook", () => ({ generateApprovedDocument: vi.fn(async () => undefined) }));
vi.mock("@/lib/mailbox/my-mailbox", () => ({ draftInMyMailbox: vi.fn(async () => null) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

const { reviewQueueAction } = await import("@/app/dashboard/queue/actions");

const SIGN = "Rebecca P. Beliard, Esq.";
const CLEAN = `Hi Ana,\n\nThanks for the call.\n\nBest,\n${SIGN}`;

function item(over: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "q1",
    org_id: "firm-key",
    matter_id: null,
    agent: "post-consult",
    type: "CLIENT_EMAIL",
    headline: "Follow up",
    summary: null,
    draft_body: CLEAN,
    final_body: null,
    status: "pending",
    created_at: "2026-10-20T12:00:00Z",
    client_name: "Ana",
    recipient: "ana@example.com",
    subject: "Next steps",
    proposed_send_at: null,
    attachments: null,
    resolved_by: null,
    resolved_at: null,
    resolution_note: null,
    ...over,
  };
}

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

const approve = (body?: string) => reviewQueueAction({}, form({ id: "q1", intent: "approve", ...(body === undefined ? {} : { body }) }));
const redirected = async (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ message: "NEXT_REDIRECT" });

beforeEach(() => {
  state.item = item();
  state.audit = { signOff: SIGN, teamSignOff: "The RPB Law Team", memberNames: ["Rebecca Beliard", "Dawn Alvarez"] };
  state.getItem.mockReset().mockImplementation(async () => state.item);
  state.resolve.mockReset().mockResolvedValue({ status: "approved", send: "drafted" });
  state.save.mockReset().mockResolvedValue(undefined);
});

describe("reviewQueueAction approval guard (H7)", () => {
  it.each([
    ["a banner", "⚠️ DRAFT — FOR ATTORNEY REVIEW. NOT SENT.\nHi Ana,\n\nBest,\n" + SIGN],
    ["NOT SENT", "Hi Ana,\nNOT SENT\n\nBest,\n" + SIGN],
    ["a [confirm …] placeholder", `Hi Ana,\nWe'll call [confirm the time].\n\nBest,\n${SIGN}`],
    ["Hard Rule 2", `Hi Ana,\nHard Rule 2: never quote fees.\n\nBest,\n${SIGN}`],
    ["[Your name]", "Hi Ana,\n\nBest,\n[Your name]"],
  ])("refuses to approve a body with %s, with one sentence, and resolves nothing", async (_n, body) => {
    state.item = item({ draft_body: body });
    const result = await approve();
    expect(result.error).toMatch(/can't be approved yet/);
    expect(result.error).toMatch(/\.$/);
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it("approves a clean body, resolving it once", async () => {
    await redirected(approve());
    expect(state.resolve).toHaveBeenCalledTimes(1);
    expect(state.resolve).toHaveBeenCalledWith(expect.objectContaining({ id: "q1", action: "approve", resolvedBy: "rebecca@example.com" }));
  });

  it("refuses a body signed by another member from the directory", async () => {
    state.item = item({ draft_body: "Hi Ana,\n\nBest,\nDawn Alvarez" });
    const result = await approve();
    expect(result.error).toContain("Dawn Alvarez");
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it("approves a body signed with the configured sign-off or the team sign-off", async () => {
    await redirected(approve());
    state.resolve.mockClear();
    state.item = item({ draft_body: "Hi Ana,\n\nBest,\nThe RPB Law Team" });
    await redirected(approve());
    expect(state.resolve).toHaveBeenCalledTimes(1);
  });

  it("approves a body with Markdown marks: that is only a warning", async () => {
    state.item = item({ draft_body: `Hi **Ana**,\n\nBest,\n${SIGN}` });
    await redirected(approve());
    expect(state.resolve).toHaveBeenCalledTimes(1);
  });

  it("checks the edit posted with the form: a dirty draft cleaned in the form approves", async () => {
    state.item = item({ draft_body: "NOT SENT\n" + CLEAN });
    await redirected(approve(CLEAN));
    expect(state.save).toHaveBeenCalledWith("firm-key", "q1", CLEAN);
    expect(state.resolve).toHaveBeenCalledTimes(1);
  });

  it("checks the edit posted with the form: a clean draft edited to add a banner is refused", async () => {
    const result = await approve("NOT SENT\n" + CLEAN);
    expect(result.error).toMatch(/can't be approved yet/);
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it("checks the saved edit when the form posts none", async () => {
    state.item = item({ draft_body: CLEAN, final_body: "NOT SENT\n" + CLEAN });
    const result = await approve();
    expect(result.error).toMatch(/can't be approved yet/);
  });

  it("runs before the edit is saved, so a refused body is never stored as the final text", async () => {
    await approve("Hi\nHard Rule 1: x\n\nBest,\n" + SIGN);
    expect(state.save).not.toHaveBeenCalled();
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it("never holds up Reject", async () => {
    state.item = item({ draft_body: "NOT SENT\n[confirm x]\nHard Rule 2" });
    await redirected(reviewQueueAction({}, form({ id: "q1", intent: "reject", note: "wrong client" })));
    expect(state.resolve).toHaveBeenCalledWith(expect.objectContaining({ action: "reject", note: "wrong client" }));
  });

  it("never holds up Save", async () => {
    state.item = item({ draft_body: "NOT SENT\n" + CLEAN });
    const result = await reviewQueueAction({}, form({ id: "q1", intent: "save", body: "NOT SENT\nstill working on it" }));
    expect(result).toEqual({});
    expect(state.save).toHaveBeenCalledWith("firm-key", "q1", "NOT SENT\nstill working on it");
  });

  it("does not refuse a non-email item for a placeholder: a Document Center letter keeps its fill-ins", async () => {
    state.item = item({ type: "OPINION_LETTER", draft_body: "# Letter DRAFT\n\nClass(es): [confirm from the report]" });
    await redirected(approve());
    expect(state.resolve).toHaveBeenCalledTimes(1);
  });

  it("still refuses on the pure checks when the member list or profile couldn't be read", async () => {
    state.audit = { signOff: null, teamSignOff: null, memberNames: null };
    state.item = item({ draft_body: "NOT SENT\n" + CLEAN });
    expect((await approve()).error).toMatch(/can't be approved yet/);
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it("skips only the signer check when the member list couldn't be read", async () => {
    state.audit = { signOff: SIGN, teamSignOff: null, memberNames: null };
    state.item = item({ draft_body: "Hi Ana,\n\nBest,\nDawn Alvarez" });
    await redirected(approve());
    expect(state.resolve).toHaveBeenCalledTimes(1);
  });
});
