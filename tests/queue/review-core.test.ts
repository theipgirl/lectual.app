import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { followup, qitem, U } from "./routing-fixtures";

/**
 * runQueueReview (src/lib/queue/review-core.ts) is the approve / save / reject body that used to live inside
 * reviewQueueAction. Every refusal is unchanged; the deck's approvals carry a receipt; the draft's link and id come back.
 */

const state = vi.hoisted(() => ({
  item: null as unknown,
  role: "attorney" as string,
  userId: "",
  routed: null as unknown,
  resolve: vi.fn(),
  save: vi.fn(),
  draft: vi.fn(),
  gate: vi.fn(),
  stale: false,
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
vi.mock("@/lib/queue/stale", () => ({ checkDraftStaleness: vi.fn(async () => ({ status: "stale" })), stalenessRequiresConfirm: vi.fn(() => state.stale) }));
vi.mock("@/components/queue/stale-warning", () => ({ staleWarning: vi.fn(() => ({ headline: "Signed Oct 3", confirm: "x" })) }));
vi.mock("@/lib/consult-proposal/link", () => ({ gateLinkedProposal: (...a: unknown[]) => state.gate(...a), makeProposalLive: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/documents/approve-hook", () => ({ generateApprovedDocument: vi.fn(async () => undefined) }));
vi.mock("@/lib/mailbox/my-mailbox", () => ({ draftInMyMailbox: (...a: unknown[]) => state.draft(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

const { runQueueReview, approvalReceipt } = await import("@/lib/queue/review-core");
const { reviewQueueAction } = await import("@/app/dashboard/queue/actions");

const members = [
  { userId: U.rebecca, role: "attorney", displayName: "Rebecca", email: null },
  { userId: U.caitlyn, role: "paralegal", displayName: "Caitlyn", email: null },
];
const routed = (routing: object) => ({ status: "ok", routing, members, dropped: 0, settingsExist: true });
const BODY = "Hi Ana,\n\nThanks for the call.\n\nBest,\nThe Team";

beforeEach(() => {
  state.item = qitem({ draft_body: BODY });
  state.role = "attorney";
  state.userId = U.rebecca;
  state.routed = routed({});
  state.stale = false;
  state.resolve.mockReset().mockResolvedValue({ status: "approved", send: "none" });
  state.save.mockReset().mockResolvedValue(undefined);
  state.draft.mockReset().mockResolvedValue({ provider: "microsoft", email: "r@example.com", webLink: "https://outlook.office.com/d/1", id: "AAMk-1" });
  state.gate.mockReset().mockResolvedValue({ ok: true, proposal: null });
});

describe("runQueueReview: refusals are the action's own", () => {
  it("an item already decided is never resolved again and never drafted twice (second tab, replayed POST)", async () => {
    for (const status of ["approved", "rejected"] as const) {
      state.item = qitem({ draft_body: BODY, status });
      expect(await runQueueReview({ id: "q1", intent: "approve" })).toEqual({ kind: "error", error: "This card was already decided." });
      expect(await runQueueReview({ id: "q1", intent: "reject", note: "x" })).toEqual({ kind: "error", error: "This card was already decided." });
    }
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.draft).not.toHaveBeenCalled();
    expect(state.save).not.toHaveBeenCalled();
  });

  it("a non-refusal error from the sign-in read never reaches the screen", async () => {
    const src = readFileSync("src/lib/queue/review-core.ts", "utf8");
    expect(src).toMatch(/err instanceof ReviewerRefusal \? err\.message : "You must be signed in\."/);
    expect(src).not.toMatch(/console\.error\([^)]*,\s*err\)/);
  });

  it("a role outside the edit roles is refused with the permission sentence", async () => {
    state.role = "viewer";
    expect(await runQueueReview({ id: "q1", intent: "approve" })).toEqual({ kind: "error", error: "You don't have permission to approve or reject client communications." });
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it("routing runs on approve AND reject", async () => {
    state.item = followup();
    state.routed = routed({ stalled_followup: U.caitlyn });
    expect((await runQueueReview({ id: "q1", intent: "approve" })).kind).toBe("error");
    expect((await runQueueReview({ id: "q1", intent: "reject", note: "no" })).kind).toBe("error");
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it("a paralegal cannot approve an attorney-only item", async () => {
    state.role = "paralegal";
    state.userId = U.caitlyn;
    expect(await runQueueReview({ id: "q1", intent: "approve" })).toEqual({ kind: "error", error: "Only an attorney can approve this kind of message." });
  });

  it("the linked-proposal gate refuses before anything is saved", async () => {
    state.gate.mockResolvedValue({ ok: false, error: "Create the proposal's link first." });
    expect(await runQueueReview({ id: "q1", intent: "approve", body: "Hi\n\nBest,\nThe Team" })).toEqual({ kind: "error", error: "Create the proposal's link first." });
    expect(state.save).not.toHaveBeenCalled();
  });

  it("a draft with a banner is refused by approvalBlock", async () => {
    state.item = qitem({ draft_body: "DRAFT — FOR ATTORNEY REVIEW. NOT SENT.\nHi\n\nBest,\nThe Team" });
    const r = await runQueueReview({ id: "q1", intent: "approve" });
    expect(r.kind === "error" && r.error).toMatch(/can't be approved yet/);
  });

  it("a stale draft needs the confirm", async () => {
    state.stale = true;
    const r = await runQueueReview({ id: "q1", intent: "approve" });
    expect(r.kind === "error" && r.error).toMatch(/Tick the confirmation box/);
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it("reject needs a note; save needs a body", async () => {
    expect((await runQueueReview({ id: "q1", intent: "reject" })).kind).toBe("error");
    expect(await runQueueReview({ id: "q1", intent: "save", body: "  " })).toEqual({ kind: "error", error: "Nothing to save — the draft is empty." });
  });

  it("an edit is saved BEFORE the resolve", async () => {
    const order: string[] = [];
    state.save.mockImplementation(async () => void order.push("save"));
    state.resolve.mockImplementation(async () => (order.push("resolve"), { status: "approved", send: "none" }));
    await runQueueReview({ id: "q1", intent: "approve", body: BODY + "\n" });
    expect(order).toEqual(["save", "resolve"]);
  });
});

describe("runQueueReview: results", () => {
  it("returns the mailbox draft's link and id", async () => {
    const r = await runQueueReview({ id: "q1", intent: "approve" });
    expect(r).toEqual({ kind: "resolved", intent: "approve", send: "mailbox-microsoft", webLink: "https://outlook.office.com/d/1", draftId: "AAMk-1", provider: "microsoft" });
  });

  it("keeps the queue's own draft link when the queue drafted it", async () => {
    state.resolve.mockResolvedValue({ status: "approved", send: "drafted", sendResult: { detail: "ok", webLink: "https://outlook/q" } });
    const r = await runQueueReview({ id: "q1", intent: "approve" });
    expect(r).toMatchObject({ kind: "resolved", send: "drafted", webLink: "https://outlook/q", draftId: null });
    expect(state.draft).not.toHaveBeenCalled();
  });

  it("appends a sha256 receipt of the approved text when asked", async () => {
    await runQueueReview({ id: "q1", intent: "approve", note: "ok", withReceipt: true });
    const hex = createHash("sha256").update(BODY, "utf8").digest("hex").slice(0, 12);
    expect(approvalReceipt(BODY)).toBe(`Receipt: sha256 ${hex}`);
    expect(state.resolve).toHaveBeenCalledWith(expect.objectContaining({ note: `ok\nReceipt: sha256 ${hex}` }));
  });

  it("the receipt covers the edited text, not the stored draft", async () => {
    const edited = "Hi Ana, edited.\n\nBest,\nThe Team";
    state.save.mockImplementation(async () => {
      state.item = qitem({ draft_body: BODY, final_body: edited });
    });
    await runQueueReview({ id: "q1", intent: "approve", body: edited, withReceipt: true });
    expect(state.resolve).toHaveBeenCalledWith(expect.objectContaining({ note: approvalReceipt(edited) }));
  });

  it("without withReceipt the note is unchanged (the full approval page)", async () => {
    await runQueueReview({ id: "q1", intent: "approve" });
    expect(state.resolve).toHaveBeenCalledWith(expect.not.objectContaining({ note: expect.anything() }));
  });

  it("a reject resolves with the note", async () => {
    expect(await runQueueReview({ id: "q1", intent: "reject", note: "wrong fee" })).toMatchObject({ kind: "resolved", intent: "reject" });
    expect(state.resolve).toHaveBeenCalledWith(expect.objectContaining({ action: "reject", note: "wrong fee" }));
  });
});

describe("reviewQueueAction is a thin wrapper", () => {
  const form = (f: Record<string, string>) => {
    const d = new FormData();
    for (const [k, v] of Object.entries(f)) d.set(k, v);
    return d;
  };

  it("still redirects to the item page with the send status", async () => {
    await expect(reviewQueueAction({}, form({ id: "q1", intent: "approve" }))).rejects.toMatchObject({ url: "/dashboard/queue/q1/?resolved=approve&send=mailbox-microsoft" });
  });

  it("returns the core's error as the form state", async () => {
    expect(await reviewQueueAction({}, form({ id: "q1", intent: "reject" }))).toEqual({ error: expect.stringMatching(/Add a short note/) });
  });

  it("holds no approval logic of its own", () => {
    const src = readFileSync("src/app/dashboard/queue/actions.ts", "utf8");
    const wrapper = src.slice(src.indexOf("export async function reviewQueueAction"), src.indexOf("export type DismissState"));
    expect(wrapper).toMatch(/runQueueReview\(/);
    expect(wrapper).not.toMatch(/approvalRefusal|approvalBlock|gateLinkedProposal|resolveQueueItem|draftInMyMailbox/);
  });
});
