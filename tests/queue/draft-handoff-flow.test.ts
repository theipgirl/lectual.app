import { describe, it, expect, vi, beforeEach } from "vitest";
import { qitem, U } from "./routing-fixtures";
import { ROUTINE_MARKER } from "@/lib/queue/routing";
import { shownBodySha256 } from "@/lib/queue/shown-text";

/**
 * Sprint 4, the approve path with "Drafts go to" set (runQueueReview) and the drafter's "Make the draft" (makeDraftInMyOutlook).
 * Every mailbox and queue call is a spy: nothing reaches a database, a mailbox or the queue service.
 */

const RAYN = "00000000-0000-4000-8000-000000000005";
const BODY = "Hi Ana,\n\nYour mark was published on Nov 3.\n\nBest,\nThe Team";

const state = vi.hoisted(() => ({
  item: null as unknown,
  role: "attorney" as string,
  userId: "",
  routed: null as unknown,
  actingAsStaff: false,
  resolve: vi.fn(),
  save: vi.fn(),
  draftMine: vi.fn(),
  draftOwnOutlook: vi.fn(),
  record: vi.fn(),
  notify: vi.fn(),
  cardState: null as unknown,
}));

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: state.userId, email: "who@example.com" } } }) } })),
}));
vi.mock("@/lib/firm/session", () => ({
  resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: state.role, actingAsStaff: state.actingAsStaff, user: { id: state.userId, email: "who@example.com" }, org: { id: "org-1" } })),
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
vi.mock("@/lib/queue/stale", () => ({ checkDraftStaleness: vi.fn(async () => ({ status: "fresh" })), stalenessRequiresConfirm: vi.fn(() => false) }));
vi.mock("@/components/queue/stale-warning", () => ({ staleWarning: vi.fn(() => null) }));
vi.mock("@/lib/consult-proposal/link", () => ({ gateLinkedProposal: vi.fn(async () => ({ ok: true, proposal: null })), makeProposalLive: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/documents/approve-hook", () => ({ generateApprovedDocument: vi.fn(async () => undefined) }));
vi.mock("@/lib/mailbox/my-mailbox", () => ({
  draftInMyMailbox: (...a: unknown[]) => state.draftMine(...a),
  draftInMyOwnOutlook: (...a: unknown[]) => state.draftOwnOutlook(...a),
}));
vi.mock("@/lib/queue/card-state", () => ({
  recordCardEvent: (...a: unknown[]) => state.record(...a),
  loadCardState: vi.fn(async () => state.cardState),
}));
vi.mock("@/lib/notifications/core", () => ({ notify: (...a: unknown[]) => state.notify(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { runQueueReview } = await import("@/lib/queue/review-core");
const { makeDraftInMyOutlook } = await import("@/lib/queue/make-draft");

const members = [
  { userId: U.rebecca, role: "attorney", displayName: "Rebecca", email: null },
  { userId: RAYN, role: "law_clerk", displayName: "Rayn", email: null },
  { userId: U.caitlyn, role: "paralegal", displayName: "Caitlyn", email: null },
  { userId: U.viewer, role: "viewer", displayName: "Vic", email: null },
];
const routed = (routing: object, drafter: string | null) => ({ status: "ok", routing, members, dropped: 0, settingsExist: true, drafter });
const notice = (item: { id: string }) => ({ queue_id: item.id });

beforeEach(() => {
  state.item = qitem({ id: "q1", draft_body: BODY });
  state.role = "attorney";
  state.userId = U.rebecca;
  state.actingAsStaff = false;
  state.routed = routed({}, RAYN);
  state.resolve.mockReset().mockResolvedValue({ status: "approved", send: "none" });
  state.save.mockReset().mockResolvedValue(undefined);
  state.draftMine.mockReset().mockResolvedValue({ provider: "microsoft", email: "r@example.com", webLink: "https://outlook.office.com/d/1", id: "AAMk-1" });
  state.draftOwnOutlook.mockReset().mockResolvedValue({ ok: true, id: "AAMk-2", webLink: "https://outlook.office.com/d/2" });
  state.record.mockReset().mockResolvedValue({ ok: true });
  state.notify.mockReset().mockResolvedValue(undefined);
  state.cardState = { status: "ok", events: [] };
});

describe("Acceptance 5: the attorney approves with a drafter set", () => {
  it("no mailbox draft anywhere, the queue is asked not to draft, one draft_to to Rayn, one bell notice with ids and a clipped headline", async () => {
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).toMatchObject({ kind: "resolved", intent: "approve", send: "passed", handoff: { status: "passed", drafter: RAYN }, draftId: null });
    expect(state.draftMine).not.toHaveBeenCalled();
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
    expect(state.resolve).toHaveBeenCalledTimes(1);
    expect(state.resolve.mock.calls[0][0]).toMatchObject({ action: "approve", skipMailboxDraft: true });
    expect(state.record).toHaveBeenCalledTimes(1);
    expect(state.record.mock.calls[0][0]).toEqual({ orgId: "org-1", queueItemId: "q1", kind: "draft_to", targetUserId: RAYN, note: `approved-text sha256 ${shownBodySha256(BODY)}` });
    expect(state.notify).toHaveBeenCalledTimes(1);
    const n = state.notify.mock.calls[0][0] as { userId: string; actorId: string; payload: Record<string, unknown> };
    expect(n.userId).toBe(RAYN);
    expect(n.actorId).toBe(U.rebecca);
    expect(n.payload).toEqual({ source: "draft_to", ...notice({ id: "q1" }), headline: "Post-consult follow-up — Ana" });
  });

  it("the queue drafting it anyway (it ignored the request) passes nothing on and makes no second draft", async () => {
    state.resolve.mockResolvedValue({ status: "approved", send: "drafted", sendResult: { detail: "x" } });
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).toMatchObject({ kind: "resolved", send: "drafted", handoff: { status: "queue-drafted" } });
    expect(state.record).not.toHaveBeenCalled();
    expect(state.draftMine).not.toHaveBeenCalled();
  });

  it("a failed pass makes no draft anywhere", async () => {
    state.record.mockResolvedValue({ ok: false, reason: "failed" });
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).toMatchObject({ kind: "resolved", send: "pass-failed", handoff: { status: "failed" } });
    expect(state.draftMine).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
  });

  it("Lectual staff viewing as the firm are refused before anything is saved or resolved", async () => {
    state.actingAsStaff = true;
    const out = await runQueueReview({ id: "q1", intent: "approve", body: `${BODY}\n` });
    expect(out.kind).toBe("error");
    expect(state.save).not.toHaveBeenCalled();
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  });
});

describe("Acceptance 10: before lectual 0112 (the event is refused)", () => {
  it("falls back to today's behaviour ONLY for the approver's own mailbox, and says passing isn't switched on", async () => {
    state.record.mockResolvedValue({ ok: false, reason: "not-set-up" });
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).toMatchObject({ kind: "resolved", send: "mailbox-microsoft", draftId: "AAMk-1", handoff: { status: "not-switched-on", drafter: RAYN } });
    expect(state.draftMine).toHaveBeenCalledTimes(1);
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
  });
});

describe("Item 6 and acceptance 4: unchanged paths", () => {
  it("the drafter approving herself is today's path (her own mailbox), no draft_to", async () => {
    state.role = "law_clerk";
    state.userId = RAYN;
    state.item = qitem({ id: "q1", agent: ROUTINE_MARKER.client_reminder.agent, headline: "Reminder", draft_body: BODY });
    state.routed = routed({ client_reminder: RAYN }, RAYN);
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).toEqual({ kind: "resolved", intent: "approve", send: "mailbox-microsoft", webLink: "https://outlook.office.com/d/1", draftId: "AAMk-1", provider: "microsoft" });
    expect(state.record).not.toHaveBeenCalled();
    expect(state.resolve.mock.calls[0][0]).not.toHaveProperty("skipMailboxDraft");
  });

  it("no drafter set: byte-identical outcome and resolve call to today's (no handoff key, no flag)", async () => {
    state.routed = routed({}, null);
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).toEqual({ kind: "resolved", intent: "approve", send: "mailbox-microsoft", webLink: "https://outlook.office.com/d/1", draftId: "AAMk-1", provider: "microsoft" });
    expect(state.resolve.mock.calls[0][0]).toEqual({ orgKey: "firm-key", id: "q1", action: "approve", resolvedBy: "who@example.com" });
    expect(state.record).not.toHaveBeenCalled();
  });

  it("a routing read that failed: today's path, no hand-off made", async () => {
    state.routed = { status: "failed" };
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).toMatchObject({ kind: "resolved", send: "mailbox-microsoft" });
    expect(out).not.toHaveProperty("handoff");
    expect(state.record).not.toHaveBeenCalled();
  });
});

describe("Acceptance 2: re-classified on approve", () => {
  it("Rayn's approve of a routine item whose edit adds advice is refused before anything is saved, drafted or resolved", async () => {
    state.role = "law_clerk";
    state.userId = RAYN;
    state.item = qitem({ id: "q1", agent: ROUTINE_MARKER.uspto_notice.agent, headline: "Published", draft_body: BODY });
    state.routed = routed({ uspto_notice: RAYN }, RAYN);
    const out = await runQueueReview({ id: "q1", intent: "approve", body: "Hi Ana,\n\nYou should respond to the office action.\n\nBest,\nThe Team" });
    expect(out).toEqual({ kind: "error", error: "Only an attorney can approve this kind of message." });
    expect(state.save).not.toHaveBeenCalled();
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.draftMine).not.toHaveBeenCalled();
  });

  it("an item that already reads as advice is refused for Rayn", async () => {
    state.role = "law_clerk";
    state.userId = RAYN;
    state.item = qitem({ id: "q1", agent: ROUTINE_MARKER.client_request.agent, headline: "Need", draft_body: "You should respond by Friday." });
    state.routed = routed({ client_request: RAYN }, RAYN);
    expect((await runQueueReview({ id: "q1", intent: "approve" })).kind).toBe("error");
    expect(state.resolve).not.toHaveBeenCalled();
  });

  it("an edit saved by a colleague in between (re-read) that adds advice is refused before resolving", async () => {
    state.role = "law_clerk";
    state.userId = RAYN;
    state.routed = routed({ uspto_notice: RAYN }, RAYN);
    const clean = qitem({ id: "q1", agent: ROUTINE_MARKER.uspto_notice.agent, headline: "Published", draft_body: BODY });
    const changed = { ...clean, final_body: "You should respond to the office action." };
    const reads = [clean, clean, changed];
    const api = await import("@/lib/queue/api");
    vi.mocked(api.getQueueItem).mockImplementation(async () => (reads.length > 1 ? reads.shift() : reads[0]) as never);
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).toEqual({ kind: "error", error: "Only an attorney can approve this kind of message." });
    expect(state.resolve).not.toHaveBeenCalled();
    vi.mocked(api.getQueueItem).mockImplementation(async () => state.item as never);
  });
});

/* ─────────────── Make the draft ─────────────── */

const approvedItem = (over: object = {}) => qitem({ id: "q1", status: "approved", agent: ROUTINE_MARKER.uspto_notice.agent, draft_body: BODY, ...over });
const passEvent = (actor = U.rebecca, target = RAYN) => ({
  queueItemId: "q1",
  kind: "draft_to",
  actorId: actor,
  targetUserId: target,
  until: null,
  note: `approved-text sha256 ${shownBodySha256(BODY)}`,
  createdAt: "2026-11-20T10:00:00Z",
});

describe("Acceptances 6 to 8 through makeDraftInMyOutlook", () => {
  beforeEach(() => {
    state.item = approvedItem();
    state.role = "law_clerk";
    state.userId = RAYN;
    state.cardState = { status: "ok", events: [passEvent()] };
  });

  it("Rayn makes the draft through her own Outlook with the approved text, then a drafted event", async () => {
    const out = await makeDraftInMyOutlook({ id: "q1" });
    expect(out.ok).toBe(true);
    expect(state.draftOwnOutlook).toHaveBeenCalledTimes(1);
    expect(state.draftOwnOutlook.mock.calls[0][0]).toEqual({ draft: { to: "ana@example.com", subject: "Next steps", body: BODY }, postedConnectionId: undefined });
    expect(state.record).toHaveBeenCalledWith({ orgId: "org-1", queueItemId: "q1", kind: "drafted" });
    expect(state.draftMine).not.toHaveBeenCalled();
  });

  it("a posted connection id is handed to the own-Outlook helper only to be compared (another person's is refused there)", async () => {
    state.draftOwnOutlook.mockResolvedValue({ ok: false, reason: "not-yours" });
    const out = await makeDraftInMyOutlook({ id: "q1", postedConnectionId: "conn-of-rebecca" });
    expect(out.ok).toBe(false);
    expect(state.draftOwnOutlook.mock.calls[0][0]).toMatchObject({ postedConnectionId: "conn-of-rebecca" });
    expect(state.record).not.toHaveBeenCalled();
  });

  it("Rebecca, another clerk, a viewer and Lectual staff are refused with fixed sentences; nothing is drafted or written", async () => {
    for (const [role, userId] of [["attorney", U.rebecca], ["paralegal", U.caitlyn], ["viewer", U.viewer]] as const) {
      state.role = role;
      state.userId = userId;
      const out = await makeDraftInMyOutlook({ id: "q1" });
      expect(out, role).toEqual({ ok: false, error: expect.stringMatching(/isn't waiting on your draft/) });
    }
    state.role = "law_clerk";
    state.userId = RAYN;
    state.actingAsStaff = true;
    expect(await makeDraftInMyOutlook({ id: "q1" })).toEqual({ ok: false, error: "Preview only: drafts aren't made while you're viewing as the firm." });
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  });

  it("a forged draft_to from a non-approver gives its target nothing", async () => {
    state.role = "paralegal";
    state.userId = U.caitlyn;
    state.cardState = { status: "ok", events: [passEvent(U.caitlyn, U.caitlyn)] };
    expect((await makeDraftInMyOutlook({ id: "q1" })).ok).toBe(false);
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
  });

  it("an edit after approval refuses the draft", async () => {
    state.item = approvedItem({ final_body: `${BODY}\nEdited later.` });
    expect(await makeDraftInMyOutlook({ id: "q1" })).toEqual({ ok: false, error: expect.stringMatching(/changed after it was approved/) });
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
  });

  it("a second click on a drafted item does nothing", async () => {
    state.cardState = { status: "ok", events: [passEvent(), { ...passEvent(), kind: "drafted", actorId: RAYN, targetUserId: null, note: null, createdAt: "2026-11-20T10:05:00Z" }] };
    expect(await makeDraftInMyOutlook({ id: "q1" })).toMatchObject({ ok: true });
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  });

  it("acceptance 9 (no usable Outlook): the sentence, nothing written anywhere", async () => {
    state.draftOwnOutlook.mockResolvedValue({ ok: false, reason: "no-mailbox" });
    expect(await makeDraftInMyOutlook({ id: "q1" })).toEqual({ ok: false, error: "Connect your own Outlook to make drafts here." });
    expect(state.record).not.toHaveBeenCalled();
  });

  it("before 0112 / unreadable events / unreadable routing: refused, never guessed", async () => {
    state.cardState = { status: "not-set-up" };
    expect((await makeDraftInMyOutlook({ id: "q1" })).ok).toBe(false);
    state.cardState = { status: "unavailable" };
    expect(await makeDraftInMyOutlook({ id: "q1" })).toEqual({ ok: false, error: "Couldn't check what's ready to draft. Refresh to try again." });
    state.cardState = { status: "ok", events: [passEvent()] };
    state.routed = { status: "failed" };
    expect((await makeDraftInMyOutlook({ id: "q1" })).ok).toBe(false);
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
  });
});
