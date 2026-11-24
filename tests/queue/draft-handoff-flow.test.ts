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
  access: "ready" as string,
}));
const EMAIL: Record<string, string> = {};

vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: state.userId, email: EMAIL[state.userId] ?? "who@example.com" } } }) } })),
}));
vi.mock("@/lib/firm/session", () => ({
  resolveFirmSession: vi.fn(async () => ({ kind: "ok", role: state.role, actingAsStaff: state.actingAsStaff, user: { id: state.userId, email: EMAIL[state.userId] ?? "who@example.com" }, org: { id: "org-1" } })),
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
  myOutlookDraftAccess: vi.fn(async (posted?: unknown) => (posted && posted !== "conn-rayn" ? "not-yours" : state.access)),
}));
vi.mock("@/lib/queue/card-state", () => ({
  recordCardEvent: (...a: unknown[]) => state.record(...a),
  loadCardState: vi.fn(async () => state.cardState),
}));
vi.mock("@/lib/notifications/core", () => ({ notify: (...a: unknown[]) => state.notify(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { runQueueReview } = await import("@/lib/queue/review-core");
const { clearOpenClaim, makeDraftInMyOutlook, retryPassToDrafter } = await import("@/lib/queue/make-draft");

const members = [
  { userId: U.rebecca, role: "attorney", displayName: "Rebecca", email: "rebecca@example.com" },
  { userId: RAYN, role: "law_clerk", displayName: "Rayn", email: "rayn@example.com" },
  { userId: U.caitlyn, role: "paralegal", displayName: "Caitlyn", email: "caitlyn@example.com" },
  { userId: U.viewer, role: "viewer", displayName: "Vic", email: "vic@example.com" },
];
for (const m of members) EMAIL[m.userId] = m.email;
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
  state.access = "ready";
});

describe("Acceptance 5: the attorney approves with a drafter set", () => {
  it("no mailbox draft anywhere, the queue is asked not to draft, one draft_to to Rayn, one bell notice with ids and a clipped headline", async () => {
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).toMatchObject({ kind: "resolved", intent: "approve", send: "passed", handoff: { status: "passed", drafter: RAYN }, draftId: null });
    expect(state.draftMine).not.toHaveBeenCalled();
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
    expect(state.resolve).toHaveBeenCalledTimes(1);
    // S2: a pass always carries the approve receipt; S7: the re-read text is the final body.
    expect(state.resolve.mock.calls[0][0]).toMatchObject({ action: "approve", skipMailboxDraft: true, finalBody: BODY, note: `Receipt: sha256 ${shownBodySha256(BODY).slice(0, 12)}` });
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
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
  });

  it("when the queue drafted it anyway, the approver is told plainly where the draft went (page and deck)", async () => {
    const { readFileSync } = await import("node:fs");
    const words = readFileSync("src/lib/ui/words.ts", "utf8");
    expect(words).toContain('QUEUE_DRAFTED_ANYWAY = "Approved and drafted by the approval queue, so it wasn\'t passed to the drafter."');
    expect(readFileSync("src/app/dashboard/queue/actions.ts", "utf8")).toMatch(/status === "queue-drafted" \? "&pass=queue"/);
    expect(readFileSync("src/app/dashboard/queue/[id]/page.tsx", "utf8")).toMatch(/pass === "off" \? PASS_NOT_SWITCHED_ON : QUEUE_DRAFTED_ANYWAY/);
    expect(readFileSync("src/app/dashboard/queue/deck/actions.ts", "utf8")).toMatch(/status === "queue-drafted" && !message\) message = QUEUE_DRAFTED_ANYWAY/);
  });

  it("a failed pass makes no draft anywhere", async () => {
    state.record.mockResolvedValue({ ok: false, reason: "failed" });
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).toMatchObject({ kind: "resolved", send: "pass-failed", handoff: { status: "failed" } });
    // SHOULD 3: the outcome is recorded as a pass_failed marker (no text), the only thing that offers the retry.
    expect(state.record).toHaveBeenLastCalledWith({ orgId: "org-1", queueItemId: "q1", kind: "pass_failed" });
    expect(state.draftMine).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
  });

  it("Lectual staff viewing as the firm are refused before anything is saved or resolved", async () => {
    state.actingAsStaff = true;
    const out = await runQueueReview({ id: "q1", intent: "approve", body: `${BODY}\n` });
    // Final review 5: the deck's own staff-preview sentence, never an approval with no draft and no message.
    expect(out).toEqual({ kind: "error", error: "Preview only: hand-offs aren't saved while you're viewing as the firm." });
    expect(state.draftMine).not.toHaveBeenCalled();
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

  it("MUST 1(d): a draft_to refused before 0112 (either constraint, read as not-set-up) never becomes pass-failed or writes a marker", async () => {
    state.record.mockResolvedValue({ ok: false, reason: "not-set-up" });
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).not.toMatchObject({ send: "pass-failed" });
    expect(state.record).toHaveBeenCalledTimes(1); // the draft_to only, no pass_failed marker
  });
});

describe("Item 3 (0103's queue_card_event_not_self): a draft_to is never written to oneself", () => {
  it("the drafter approving her own client email (plan self) writes no draft_to at all, so the self-refusal can never fire", async () => {
    state.role = "law_clerk";
    state.userId = RAYN;
    state.item = qitem({ id: "q1", agent: ROUTINE_MARKER.client_reminder.agent, headline: "Reminder", draft_body: BODY });
    state.routed = routed({ client_reminder: RAYN }, RAYN);
    await runQueueReview({ id: "q1", intent: "approve" });
    expect(state.record).not.toHaveBeenCalled();
    expect(state.record.mock.calls.some((c) => (c[0] as { kind: string; targetUserId?: string }).kind === "draft_to")).toBe(false);
  });

  it("every draft_to the approve path writes targets the drafter, who is never the approver (plan pass only)", async () => {
    await runQueueReview({ id: "q1", intent: "approve" });
    const call = state.record.mock.calls[0][0] as { kind: string; targetUserId: string };
    expect(call.kind).toBe("draft_to");
    expect(call.targetUserId).toBe(RAYN);
    expect(call.targetUserId).not.toBe(U.rebecca);
  });
});

describe("Item 6 and acceptance 4: unchanged paths", () => {
  it("S5 (changed on purpose): the drafter approving herself drafts in her own mailbox only: the queue is asked not to draft, no draft_to", async () => {
    state.role = "law_clerk";
    state.userId = RAYN;
    state.item = qitem({ id: "q1", agent: ROUTINE_MARKER.client_reminder.agent, headline: "Reminder", draft_body: BODY });
    state.routed = routed({ client_reminder: RAYN }, RAYN);
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).toEqual({ kind: "resolved", intent: "approve", send: "mailbox-microsoft", webLink: "https://outlook.office.com/d/1", draftId: "AAMk-1", provider: "microsoft" });
    expect(state.record).not.toHaveBeenCalled();
    expect(state.resolve.mock.calls[0][0]).toMatchObject({ skipMailboxDraft: true });
    expect(state.draftMine).toHaveBeenCalledTimes(1);
  });

  it("no drafter set: today's outcome, no handoff key, no skip flag (S7 adds only the re-read final body)", async () => {
    state.routed = routed({}, null);
    const out = await runQueueReview({ id: "q1", intent: "approve" });
    expect(out).toEqual({ kind: "resolved", intent: "approve", send: "mailbox-microsoft", webLink: "https://outlook.office.com/d/1", draftId: "AAMk-1", provider: "microsoft" });
    expect(state.resolve.mock.calls[0][0]).toEqual({ orgKey: "firm-key", id: "q1", action: "approve", resolvedBy: "rebecca@example.com", finalBody: BODY });
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

const approvedItem = (over: object = {}) =>
  qitem({
    id: "q1",
    status: "approved",
    agent: ROUTINE_MARKER.uspto_notice.agent,
    draft_body: BODY,
    final_body: BODY,
    resolved_by: "rebecca@example.com",
    resolved_at: "2026-11-20T09:59:00Z",
    resolution_note: `Receipt: sha256 ${shownBodySha256(BODY).slice(0, 12)}`,
    ...over,
  });
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

  it("MUST 2 (changed on purpose): Rayn claims the attempt (drafting), makes the draft, THEN confirms it (drafted)", async () => {
    const order: string[] = [];
    state.record.mockImplementation(async (e: { kind: string; attempt?: number }) => (order.push(`${e.kind}:${e.attempt}`), { ok: true }));
    state.draftOwnOutlook.mockImplementation(async () => (order.push("graph"), { ok: true, id: "AAMk-2", webLink: null }));
    const out = await makeDraftInMyOutlook({ id: "q1" });
    expect(out).toEqual({ ok: true, message: "The draft is in your Outlook Drafts. Open it there and press Send. Nothing has reached the client yet.", webLink: null });
    expect(order).toEqual(["drafting:1", "graph", "drafted:1"]);
    expect(state.draftOwnOutlook.mock.calls[0][0]).toEqual({ draft: { to: "ana@example.com", subject: "Next steps", body: BODY }, postedConnectionId: undefined });
    expect(state.draftMine).not.toHaveBeenCalled();
  });

  it("another person's posted connection id is refused before anything is claimed or drafted", async () => {
    const out = await makeDraftInMyOutlook({ id: "q1", postedConnectionId: "conn-of-rebecca" });
    expect(out).toEqual({ ok: false, error: expect.stringMatching(/isn't waiting on your draft/) });
    expect(state.record).not.toHaveBeenCalled();
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
  });

  it("MUST 2: two concurrent clicks make at most one draft (the second claim of attempt 1 is refused by 0112's unique index)", async () => {
    let claims = 0;
    state.record.mockImplementation(async (e: { kind: string }) => (e.kind !== "drafting" ? { ok: true } : ++claims === 1 ? { ok: true } : { ok: false, reason: "conflict" }));
    const [a, b] = await Promise.all([makeDraftInMyOutlook({ id: "q1" }), makeDraftInMyOutlook({ id: "q1" })]);
    expect(state.draftOwnOutlook).toHaveBeenCalledTimes(1);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((r) => !r.ok)).toEqual({ ok: false, error: "This one is already being drafted. Check your Outlook Drafts before trying again." });
  });

  it("MUST 2: a claim that can't be written is a refusal; nothing is drafted", async () => {
    state.record.mockResolvedValue({ ok: false, reason: "failed" });
    expect((await makeDraftInMyOutlook({ id: "q1" })).ok).toBe(false);
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
  });

  it("MUST 2: Graph fails after the claim: draft_failed is recorded (never drafted), the item re-opens, and the retry claims attempt 2", async () => {
    const written: string[] = [];
    state.record.mockImplementation(async (e: { kind: string; attempt?: number; note?: string }) => (written.push(`${e.kind}:${e.attempt}${e.note ? `:${e.note}` : ""}`), { ok: true }));
    state.draftOwnOutlook.mockResolvedValueOnce({ ok: false, reason: "refused" });
    expect(await makeDraftInMyOutlook({ id: "q1" })).toEqual({ ok: false, error: "The draft couldn't be made. Nothing was sent. Try again." });
    expect(written).toEqual(["drafting:1", "draft_failed:1"]);
    // The retry, after reading those rows back:
    const ev = (kind: string, attempt: number, at: string) => ({ ...passEvent(), kind, actorId: RAYN, targetUserId: null, note: null, attempt, createdAt: at });
    state.cardState = { status: "ok", events: [passEvent(), ev("drafting", 1, "2026-11-20T10:01:00Z"), ev("draft_failed", 1, "2026-11-20T10:01:05Z")] };
    written.length = 0;
    expect((await makeDraftInMyOutlook({ id: "q1" })).ok).toBe(true);
    expect(written).toEqual(["drafting:2", "drafted:2"]);
  });

  it("item 5: a note reading 'attempt 2' has no effect: the attempt comes only from the attempt column", async () => {
    const ev = (kind: string, note: string | null, attempt: number | null, at: string) => ({ ...passEvent(), kind, actorId: RAYN, targetUserId: null, note, attempt, createdAt: at });
    // A drafting whose NOTE says "attempt 2" but carries no attempt is not a claim: the item is still open for attempt 1.
    state.cardState = { status: "ok", events: [passEvent(), ev("drafting", "attempt 2", null, "2026-11-20T10:01:00Z")] };
    const written: string[] = [];
    state.record.mockImplementation(async (e: { kind: string; attempt?: number; note?: string }) => (written.push(`${e.kind}:${e.attempt}:${e.note ?? ""}`), { ok: true }));
    expect((await makeDraftInMyOutlook({ id: "q1" })).ok).toBe(true);
    expect(written).toEqual(["drafting:1:", "drafted:1:"]);
  });

  it("final review 1: an UNCERTAIN Graph failure (5xx, timeout, unreadable reply) writes no draft_failed: the claim stays open, 'Check your Drafts'", async () => {
    const written: string[] = [];
    state.record.mockImplementation(async (e: { kind: string; attempt?: number }) => (written.push(`${e.kind}:${e.attempt}`), { ok: true }));
    state.draftOwnOutlook.mockResolvedValue({ ok: false, reason: "uncertain" });
    expect(await makeDraftInMyOutlook({ id: "q1" })).toEqual({ ok: false, error: "Check your Drafts. If it isn't there, copy the approved text below." });
    expect(written).toEqual(["drafting:1"]);
  });

  it("final review 1: a definite refusal (reauth or a 4xx) writes draft_failed and re-opens the item", async () => {
    for (const reason of ["reauth", "refused"]) {
      const written: string[] = [];
      state.record.mockImplementation(async (e: { kind: string; attempt?: number }) => (written.push(`${e.kind}:${e.attempt}`), { ok: true }));
      state.draftOwnOutlook.mockResolvedValue({ ok: false, reason });
      expect((await makeDraftInMyOutlook({ id: "q1" })).ok).toBe(false);
      expect(written, reason).toEqual(["drafting:1", "draft_failed:1"]);
    }
  });

  it("MUST 2: if even the failure can't be recorded, the person is told to ask Lectual (the page then shows 'check your Drafts')", async () => {
    state.record.mockImplementation(async (e: { kind: string }) => (e.kind === "draft_failed" ? { ok: false, reason: "failed" } : { ok: true }));
    state.draftOwnOutlook.mockResolvedValue({ ok: false, reason: "refused" });
    expect(await makeDraftInMyOutlook({ id: "q1" })).toEqual({ ok: false, error: "The draft couldn't be made. Ask Lectual." });
  });

  it("MUST 2: a crash between the claim and the draft (drafting, no outcome) is never drafted again from here", async () => {
    state.cardState = { status: "ok", events: [passEvent(), { ...passEvent(), kind: "drafting", actorId: RAYN, targetUserId: null, note: null, attempt: 1, createdAt: "2026-11-20T10:01:00Z" }] };
    expect(await makeDraftInMyOutlook({ id: "q1" })).toEqual({ ok: false, error: "Check your Drafts. If it isn't there, copy the approved text below." });
    expect(state.record).not.toHaveBeenCalled();
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
  });

  it("note (c): if lawmatics-mcp ever normalised final_body (here: trailing whitespace trimmed), every Make-draft is refused: it fails closed", async () => {
    state.item = approvedItem({ final_body: BODY.trimEnd() + "  " });
    expect(await makeDraftInMyOutlook({ id: "q1" })).toEqual({ ok: false, error: expect.stringMatching(/changed after it was approved/) });
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
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
    state.cardState = { status: "ok", events: [passEvent(), { ...passEvent(), kind: "drafted", actorId: RAYN, targetUserId: null, note: null, attempt: 1, createdAt: "2026-11-20T10:05:00Z" }] };
    expect(await makeDraftInMyOutlook({ id: "q1" })).toMatchObject({ ok: true });
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  });

  it("acceptance 9 (no usable Outlook): the sentence, nothing written anywhere", async () => {
    state.access = "no-mailbox";
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

const passFailed = { queueItemId: "q1", kind: "pass_failed", actorId: U.rebecca, targetUserId: null, until: null, note: null, createdAt: "2026-11-20T10:00:00Z" };

describe("S3: Pass to <drafter> after a pass that didn't go through", () => {
  beforeEach(() => {
    state.item = approvedItem();
    state.role = "attorney";
    state.userId = U.rebecca;
    // SHOULD 3 (changed on purpose): the retry needs the pass_failed marker written at approval.
    state.cardState = { status: "ok", events: [passFailed] };
  });

  it("SHOULD 3: no pass_failed marker (queue drafted, own-mailbox fallback, approved before a drafter existed): no retry", async () => {
    state.cardState = { status: "ok", events: [] };
    expect(await retryPassToDrafter({ id: "q1" })).toEqual({ ok: false, error: "There's no record that passing this one failed, so it can't be passed again from here." });
    // A marker written by someone other than the approver doesn't count either.
    state.cardState = { status: "ok", events: [{ ...passFailed, actorId: U.caitlyn }] };
    expect((await retryPassToDrafter({ id: "q1" })).ok).toBe(false);
    expect(state.record).not.toHaveBeenCalled();
  });

  it("the approver passes it again: one draft_to with the receipt hash, one bell notice, no mailbox draft", async () => {
    expect(await retryPassToDrafter({ id: "q1" })).toEqual({ ok: true, message: expect.stringMatching(/passed to Rayn/), webLink: null });
    expect(state.record).toHaveBeenCalledWith({ orgId: "org-1", queueItemId: "q1", kind: "draft_to", targetUserId: RAYN, note: `approved-text sha256 ${shownBodySha256(BODY)}` });
    expect(state.notify).toHaveBeenCalledTimes(1);
    expect(state.draftMine).not.toHaveBeenCalled();
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
  });

  it("refused for anyone but the approver, while a trusted draft_to exists, after an edit, and for staff previewing", async () => {
    state.userId = U.caitlyn;
    state.role = "paralegal";
    expect(await retryPassToDrafter({ id: "q1" })).toEqual({ ok: false, error: "Only the person who approved this email can pass it on." });
    state.userId = U.rebecca;
    state.role = "attorney";
    state.cardState = { status: "ok", events: [passFailed, passEvent()] };
    expect(await retryPassToDrafter({ id: "q1" })).toEqual({ ok: false, error: "This email has already been passed on. Nothing else was done." });
    state.cardState = { status: "ok", events: [passFailed] };
    state.item = approvedItem({ final_body: `${BODY}\nedited` });
    expect((await retryPassToDrafter({ id: "q1" })).ok).toBe(false);
    state.item = approvedItem();
    state.actingAsStaff = true;
    expect((await retryPassToDrafter({ id: "q1" })).ok).toBe(false);
    expect(state.record).not.toHaveBeenCalled();
  });
});

describe("Final review 2: 'It isn't in my Drafts, try again' clears an open claim", () => {
  const open = { ...passEvent(), kind: "drafting", actorId: RAYN, targetUserId: null, note: null, attempt: 1, createdAt: "2026-11-20T10:01:00Z" };
  beforeEach(() => {
    state.item = approvedItem();
    state.role = "law_clerk";
    state.userId = RAYN;
    state.cardState = { status: "ok", events: [passEvent(), open] };
  });

  it("the target writes draft_failed for that attempt; drafts nothing; the next attempt can then be claimed", async () => {
    expect(await clearOpenClaim({ id: "q1" })).toEqual({ ok: true, message: "Noted. You can make the draft again.", webLink: null });
    expect(state.record).toHaveBeenCalledWith({ orgId: "org-1", queueItemId: "q1", kind: "draft_failed", attempt: 1 });
    expect(state.draftOwnOutlook).not.toHaveBeenCalled();
    // After it is read back, Make the draft claims attempt 2.
    state.record.mockClear();
    state.cardState = { status: "ok", events: [passEvent(), open, { ...open, kind: "draft_failed", createdAt: "2026-11-20T10:02:00Z" }] };
    await makeDraftInMyOutlook({ id: "q1" });
    expect(state.record).toHaveBeenNthCalledWith(1, { orgId: "org-1", queueItemId: "q1", kind: "drafting", attempt: 2 });
  });

  it("only the target, only on an open claim, re-checked on the server (role, fold); staff previewing refused", async () => {
    for (const [role, userId] of [["attorney", U.rebecca], ["paralegal", U.caitlyn], ["viewer", U.viewer]] as const) {
      state.role = role;
      state.userId = userId;
      expect((await clearOpenClaim({ id: "q1" })).ok, role).toBe(false);
    }
    state.role = "law_clerk";
    state.userId = RAYN;
    // No open claim (none yet, or already drafted): refused.
    state.cardState = { status: "ok", events: [passEvent()] };
    expect(await clearOpenClaim({ id: "q1" })).toEqual({ ok: false, error: "There's no draft waiting to be checked on this one. Refresh to see where it is." });
    state.cardState = { status: "ok", events: [passEvent(), open, { ...open, kind: "drafted", createdAt: "2026-11-20T10:02:00Z" }] };
    expect((await clearOpenClaim({ id: "q1" })).ok).toBe(false);
    // A forged claim by someone else isn't an open claim of hers.
    state.cardState = { status: "ok", events: [passEvent(), { ...open, actorId: U.caitlyn }] };
    expect((await clearOpenClaim({ id: "q1" })).ok).toBe(false);
    state.cardState = { status: "ok", events: [passEvent(), open] };
    state.actingAsStaff = true;
    expect((await clearOpenClaim({ id: "q1" })).ok).toBe(false);
    expect(state.record).not.toHaveBeenCalled();
  });
});
