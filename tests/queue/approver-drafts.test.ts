import { readFileSync } from "node:fs";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { qitem, U } from "./routing-fixtures";

/**
 * Approver drafts (Nov 27): an approved client email is drafted in the APPROVER's own Outlook. The queue is always asked
 * not to draft (`mailbox_draft: false`); the approver's Outlook is checked, with a fresh token, BEFORE anything is saved,
 * made live or resolved; then ONE Graph draft with that token, never retried. Every queue and mailbox call is a spy.
 */

const BODY = "Hi Ana,\n\nThanks for the call.\n\nBest,\nThe Team";
const RAYN = "00000000-0000-4000-8000-000000000005";

const state = vi.hoisted(() => ({
  item: null as unknown,
  role: "attorney" as string,
  userId: "",
  routed: null as unknown,
  actingAsStaff: false,
  resolve: vi.fn(),
  save: vi.fn(),
  live: vi.fn(),
  draft: vi.fn(),
  prep: null as unknown,
  prepCalls: 0,
  passing: "yes" as string,
  record: vi.fn(),
  order: [] as string[],
}));

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: state.userId, email: "rebecca@example.com" } } }) } })),
}));
vi.mock("@/lib/firm/session", () => ({
  resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: state.role, actingAsStaff: state.actingAsStaff, user: { id: state.userId, email: "rebecca@example.com" }, org: { id: "org-1" } })),
}));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
vi.mock("@/lib/queue/audit-context", () => ({ loadAuditContext: vi.fn(async () => ({ signOff: "The Team", teamSignOff: "The Team", memberNames: [] })) }));
vi.mock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => "firm-key") }));
vi.mock("@/lib/queue/roles", async (orig) => ({ ...(await orig<object>()), resolveQueueRole: vi.fn(async (_s: unknown, allowed: string[]) => (allowed.includes(state.role) ? state.role : null)) }));
vi.mock("@/lib/queue/routing-load", () => ({ loadApprovalRouting: vi.fn(async () => state.routed) }));
vi.mock("@/lib/queue/api", () => ({
  getQueueItem: vi.fn(async () => state.item),
  saveQueueEdit: (...a: unknown[]) => (state.order.push("save"), state.save(...a)),
  resolveQueueItem: (...a: unknown[]) => (state.order.push("resolve"), state.resolve(...a)),
}));
vi.mock("@/lib/queue/stale", () => ({ checkDraftStaleness: vi.fn(async () => ({ status: "fresh" })), stalenessRequiresConfirm: vi.fn(() => false) }));
vi.mock("@/components/queue/stale-warning", () => ({ staleWarning: vi.fn(() => null) }));
vi.mock("@/lib/consult-proposal/link", () => ({
  gateLinkedProposal: vi.fn(async () => ({ ok: true, proposal: { id: "p1", status: "approved" } })),
  makeProposalLive: (...a: unknown[]) => (state.order.push("live"), state.live(...a)),
}));
vi.mock("@/lib/documents/approve-hook", () => ({ generateApprovedDocument: vi.fn(async () => undefined) }));
vi.mock("@/lib/mailbox/my-mailbox", () => ({
  prepareMyOutlookDraft: vi.fn(async () => {
    state.prepCalls += 1;
    state.order.push("prepare");
    return state.prep;
  }),
}));
vi.mock("@/lib/queue/card-state", () => ({
  recordCardEvent: (...a: unknown[]) => state.record(...a),
  loadCardState: vi.fn(async () => ({ status: "ok", events: [] })),
  passingSwitchedOn: vi.fn(async () => state.passing),
}));
vi.mock("@/lib/notifications/core", () => ({ notify: vi.fn(async () => undefined) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { runQueueReview } = await import("@/lib/queue/review-core");

const members = [
  { userId: U.rebecca, role: "attorney", displayName: "Rebecca", email: "rebecca@example.com" },
  { userId: RAYN, role: "law_clerk", displayName: "Rayn", email: "rayn@example.com" },
];
const routed = (drafter: string | null) => ({ status: "ok", routing: {}, members, dropped: 0, settingsExist: true, drafter });
const ready = () => ({ ok: true, draft: (...a: unknown[]) => (state.order.push("draft"), state.draft(...a)) });

beforeEach(() => {
  state.item = qitem({ id: "q1", draft_body: BODY });
  state.role = "attorney";
  state.userId = U.rebecca;
  state.routed = routed(null);
  state.actingAsStaff = false;
  state.resolve.mockReset().mockResolvedValue({ status: "approved", send: "manual" });
  state.save.mockReset().mockResolvedValue(undefined);
  state.live.mockReset().mockResolvedValue({ ok: true });
  state.draft.mockReset().mockResolvedValue({ ok: true, id: "AAMk-1", webLink: "https://outlook.office.com/d/1" });
  state.record.mockReset().mockResolvedValue({ ok: true });
  state.prep = ready();
  state.prepCalls = 0;
  state.passing = "yes";
  state.order = [];
});

describe("the approver's Outlook is checked first; not ready = nothing done", () => {
  it.each([
    ["no-mailbox", "Connect your own Outlook before you approve client emails. Nothing was approved.", "/dashboard/settings/integrations/"],
    ["not-outlook", "Only a Gmail mailbox is connected. Connect your own Outlook before you approve client emails. Nothing was approved.", "/dashboard/settings/integrations/"],
    ["needs-permission", "Reconnect your Outlook and allow it to save drafts, then approve again. Nothing was approved.", "/dashboard/settings/integrations/"],
    ["reauth", "Your Outlook needs to be reconnected before you approve client emails. Nothing was approved.", "/dashboard/settings/integrations/"],
    ["unavailable", "Couldn't check your Outlook, so nothing was approved. Refresh to try again.", null],
  ])("%s: a fixed sentence and the connect link; no save, no live link, no resolve, no draft", async (reason, sentence, connect) => {
    state.prep = { ok: false, reason };
    const out = await runQueueReview({ id: "q1", intent: "approve", body: `${BODY}\n` });
    expect(out).toEqual({ kind: "error", error: sentence, connect });
    expect(state.save).not.toHaveBeenCalled();
    expect(state.live).not.toHaveBeenCalled();
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.draft).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  });

  it("the order: prepare, save, proposal live, resolve (mailbox_draft false), then ONE draft", async () => {
    const out = await runQueueReview({ id: "q1", intent: "approve", body: `${BODY}\n` });
    expect(state.order).toEqual(["prepare", "save", "live", "resolve", "draft"]);
    expect(state.resolve.mock.calls[0][0]).toMatchObject({ skipMailboxDraft: true });
    expect(state.draft).toHaveBeenCalledTimes(1);
    expect(state.draft.mock.calls[0][0]).toEqual({ to: "ana@example.com", subject: expect.any(String), body: `${BODY}\n` });
    expect(out).toMatchObject({ kind: "resolved", send: "mailbox-microsoft", provider: "microsoft", draftId: "AAMk-1", webLink: "https://outlook.office.com/d/1" });
  });

  it("Lectual staff viewing as the firm are refused with the preview sentence before anything, even with no drafter", async () => {
    state.actingAsStaff = true;
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).toEqual({ kind: "error", error: "Preview only: hand-offs aren't saved while you're viewing as the firm." });
    expect(state.prepCalls).toBe(0);
    expect(state.resolve).not.toHaveBeenCalled();
  });
});

describe("mailbox_draft false on every plan", () => {
  it.each([
    ["no drafter", null, U.rebecca],
    ["the drafter approves (self)", U.rebecca, U.rebecca],
    ["a colleague is the drafter (pass)", RAYN, U.rebecca],
  ])("%s", async (_n, drafter) => {
    state.routed = routed(drafter);
    await runQueueReview({ id: "q1", intent: "approve" });
    expect(state.resolve.mock.calls[0][0]).toMatchObject({ skipMailboxDraft: true });
  });

  it("a routing read that failed: still the approver's own Outlook, and the queue still told not to draft", async () => {
    state.routed = { status: "failed" };
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(state.resolve.mock.calls[0][0]).toMatchObject({ skipMailboxDraft: true });
    expect(out).toMatchObject({ send: "mailbox-microsoft" });
  });

  it("override (pass, 0112 on): the approver's Outlook is neither checked nor used; the drafter makes it on their own click", async () => {
    state.routed = routed(RAYN);
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(state.prepCalls).toBe(0);
    expect(state.draft).not.toHaveBeenCalled();
    expect(out).toMatchObject({ send: "passed", handoff: { status: "passed", drafter: RAYN } });
  });
});

describe("after the resolve: one draft, never retried", () => {
  it("a definite refusal: mailbox-failed with the approved text; the draft is not tried again", async () => {
    state.draft.mockResolvedValue({ ok: false, reason: "refused" });
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).toMatchObject({ kind: "resolved", send: "mailbox-failed", draftId: null, approvedText: BODY });
    expect(state.draft).toHaveBeenCalledTimes(1);
  });

  it("an uncertain failure (5xx, timeout): mailbox-uncertain, the approved text, never retried", async () => {
    state.draft.mockResolvedValue({ ok: false, reason: "uncertain" });
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).toMatchObject({ kind: "resolved", send: "mailbox-uncertain", approvedText: BODY });
    expect(state.draft).toHaveBeenCalledTimes(1);
  });

  it("the queue drafted it anyway (firm mailbox): no second draft; the link is read from draft.webLink", async () => {
    state.resolve.mockResolvedValue({ status: "approved", send: "drafted", draft: { mailbox: "firm@example.com", draftId: "x", webLink: "https://outlook/firm" } });
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(state.draft).not.toHaveBeenCalled();
    expect(out).toMatchObject({ kind: "resolved", send: "drafted", webLink: "https://outlook/firm", draftId: null });
  });
});

describe("other types are unchanged: no mailbox needed", () => {
  it.each(["BRIEFING", "ENGAGEMENT_LETTER", "USPTO_RESPONSE"])("%s approves with no Outlook check, no skip flag and no draft", async (type) => {
    state.item = qitem({ id: "q1", type, draft_body: "Internal note", recipient: null });
    state.prep = { ok: false, reason: "no-mailbox" };
    state.resolve.mockResolvedValue({ status: "approved", send: type === "BRIEFING" ? "none" : "manual" });
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out.kind).toBe("resolved");
    expect(state.prepCalls).toBe(0);
    expect(state.draft).not.toHaveBeenCalled();
    expect(state.resolve.mock.calls[0][0]).not.toHaveProperty("skipMailboxDraft");
  });

  it("a reject never checks Outlook", async () => {
    state.prep = { ok: false, reason: "no-mailbox" };
    await runQueueReview({ id: "q1", intent: "reject", note: "no" });
    expect(state.prepCalls).toBe(0);
    expect(state.resolve).toHaveBeenCalledTimes(1);
  });
});

describe("pages draw the refusal with its link, and the new outcomes", () => {
  it("the item page, deck card and lead page render the connect link from the error", () => {
    expect(readFileSync("src/components/queue/ReviewPanel.tsx", "utf8")).toMatch(/state\.connect \?[\s\S]*CONNECT_OUTLOOK_LINK/);
    expect(readFileSync("src/components/deck/ApprovalCard.tsx", "utf8")).toMatch(/result\.connect \?[\s\S]*CONNECT_OUTLOOK_LINK/);
    expect(readFileSync("src/components/leads/NeedsYourYes.tsx", "utf8")).toMatch(/outcome\.connect \?[\s\S]*CONNECT_OUTLOOK_LINK/);
    expect(readFileSync("src/app/dashboard/queue/actions.ts", "utf8")).toMatch(/connect: outcome\.connect/);
  });

  it("the item page's outcome lines", async () => {
    const { outcomeText } = await import("@/components/queue/format");
    expect(outcomeText("approve", "mailbox-microsoft")?.text).toContain("Draft is in your Outlook.");
    expect(outcomeText("approve", "mailbox-failed")?.text).toContain("Approved, but the draft couldn't be made in your Outlook. Nothing was sent.");
    expect(outcomeText("approve", "mailbox-uncertain")?.text).toContain("Check your Outlook Drafts before trying again.");
    expect(outcomeText("approve", "drafted")?.text).toContain("firm's mailbox");
    expect(outcomeText("approve", "manual", false, null, "CLIENT_EMAIL")?.text).not.toMatch(/isn't emailed/);
    expect(outcomeText("approve", "manual", false, null, "ENGAGEMENT_LETTER")?.text).toMatch(/isn't emailed/);
  });
});
