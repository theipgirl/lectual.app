import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { qitem, U } from "./routing-fixtures";

/**
 * The approval deck's actions (src/app/dashboard/queue/deck/actions.ts): behind `role-views` (notFound), the caller
 * re-resolved on every call, approve / reject through the shared core, hand-off targets checked against the member
 * directory, Hand off / Later refused with the "not switched on" sentence before lectual 0103, and the send path's checks.
 */

const state = vi.hoisted(() => ({
  modules: ["role-views"] as string[],
  session: null as unknown,
  item: null as unknown,
  core: vi.fn(),
  cardState: { status: "ok", events: [] } as unknown,
  record: vi.fn(),
  members: [] as unknown[],
  membersFail: false,
  routed: { status: "ok", routing: {}, members: [], dropped: 0, settingsExist: true } as unknown,
  sendAccess: "ready" as string,
  send: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => state.modules.includes(m)) }));
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => state.session) }));
vi.mock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => "firm-key") }));
vi.mock("@/lib/queue/api", () => ({ getQueueItem: vi.fn(async () => state.item) }));
vi.mock("@/lib/queue/routing-load", () => ({ loadApprovalRouting: vi.fn(async () => state.routed) }));
vi.mock("@/lib/queue/review-core", () => ({ runQueueReview: (...a: unknown[]) => state.core(...a) }));
vi.mock("@/lib/queue/card-state", () => ({
  loadCardState: vi.fn(async () => state.cardState),
  recordCardEvent: (...a: unknown[]) => state.record(...a),
}));
vi.mock("@/lib/members/directory", () => ({
  listMemberDirectory: vi.fn(async () => {
    if (state.membersFail) throw new Error("boom");
    return state.members;
  }),
}));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
vi.mock("@/lib/mailbox/my-mailbox", () => ({
  mySendAccess: vi.fn(async () => state.sendAccess),
  sendFromMyOutlook: (...a: unknown[]) => state.send(...a),
}));

const A = await import("@/app/dashboard/queue/deck/actions");

const sessionFor = (userId: string, role: string, email = "rebecca@example.com") => ({
  kind: "ok",
  user: { id: userId, email },
  role,
  org: { id: "org-1", name: "Firm", slug: "firm", modules: ["role-views"] },
  member: { role, org_id: "org-1" },
  actingAsStaff: false,
});
const MEMBERS = [
  { userId: U.rebecca, role: "attorney", displayName: "Rebecca", email: null, identified: true },
  { userId: U.caitlyn, role: "paralegal", displayName: "Caitlyn", email: null, identified: true },
  { userId: U.viewer, role: "viewer", displayName: "Vic", email: null, identified: true },
];

beforeEach(() => {
  state.modules = ["role-views"];
  state.session = sessionFor(U.rebecca, "attorney");
  state.item = qitem({ id: "q1" });
  state.core.mockReset().mockResolvedValue({ kind: "resolved", intent: "approve", send: "mailbox-microsoft", webLink: "https://outlook/d", draftId: "AAMk1", provider: "microsoft" });
  state.cardState = { status: "ok", events: [] };
  state.record.mockReset().mockResolvedValue({ ok: true });
  state.members = MEMBERS;
  state.membersFail = false;
  state.sendAccess = "ready";
  state.send.mockReset().mockResolvedValue({ ok: true });
});

const NOT_SWITCHED_ON = "This isn't switched on for your firm yet. Lectual will turn it on.";

describe("the role-views gate", () => {
  it.each([
    ["approve", () => A.approveCardAction("q1")],
    ["mark read", () => A.markReadCardAction("q1")],
    ["reject", () => A.rejectCardAction("q1", "no")],
    ["hand off", () => A.handOffCardAction("q1", U.caitlyn, "")],
    ["later", () => A.laterCardAction("q1")],
    ["send back", () => A.returnCardAction("q1", "")],
    ["send now", () => A.sendDraftNowAction("q1", "AAMk1")],
  ])("%s answers notFound without the switch, and touches nothing", async (_n, call) => {
    state.modules = [];
    await expect(call()).rejects.toMatchObject({ message: "NEXT_NOT_FOUND" });
    expect(state.core).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
    expect(state.send).not.toHaveBeenCalled();
  });

  it("the page gates the same way", () => {
    const src = readFileSync("src/app/dashboard/queue/deck/page.tsx", "utf8");
    expect(src).toMatch(/if \(!\(await orgHasModule\("role-views"\)\)\) notFound\(\);/);
  });
});

describe("every action re-checks the caller", () => {
  it.each([
    ["signed out", { kind: "signed-out", redirectTo: "/" }],
    ["a viewer", sessionFor(U.viewer, "viewer")],
  ])("%s gets nothing done", async (_n, session) => {
    state.session = session;
    for (const r of [await A.approveCardAction("q1"), await A.rejectCardAction("q1", "x"), await A.handOffCardAction("q1", U.caitlyn, ""), await A.laterCardAction("q1"), await A.sendDraftNowAction("q1", "AAMk1")]) {
      expect(r.ok).toBe(false);
    }
    expect(state.core).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
    expect(state.send).not.toHaveBeenCalled();
  });

  it("Yes runs the shared core with a receipt and returns where the draft is", async () => {
    const r = await A.approveCardAction("q1");
    expect(state.core).toHaveBeenCalledWith({ id: "q1", intent: "approve", withReceipt: true });
    expect(r).toMatchObject({ ok: true, draft: { provider: "microsoft", webLink: "https://outlook/d", draftId: "AAMk1", canSend: true } });
  });

  it("the core's refusal comes back as it is (routing, gates, stale)", async () => {
    state.core.mockResolvedValue({ kind: "error", error: "Only an attorney can approve this kind of message." });
    expect(await A.approveCardAction("q1")).toEqual({ ok: false, error: "Only an attorney can approve this kind of message." });
  });

  it("an id that isn't a queue id is refused before anything", async () => {
    expect((await A.approveCardAction("../../x")).ok).toBe(false);
    expect((await A.approveCardAction(42)).ok).toBe(false);
    expect(state.core).not.toHaveBeenCalled();
  });

  it("Mark read is for internal briefings only", async () => {
    expect((await A.markReadCardAction("q1")).ok).toBe(false);
    state.item = qitem({ id: "q1", type: "BRIEFING", agent: "morning-brief" });
    expect(await A.markReadCardAction("q1")).toMatchObject({ ok: true, message: "Marked read." });
  });

  it("Reject needs a note, and the core rejects with it", async () => {
    expect(await A.rejectCardAction("q1", "   ")).toMatchObject({ ok: false });
    expect(state.core).not.toHaveBeenCalled();
    state.core.mockResolvedValue({ kind: "resolved", intent: "reject", send: null, webLink: null, draftId: null, provider: null });
    expect((await A.rejectCardAction("q1", "wrong fee")).ok).toBe(true);
    expect(state.core).toHaveBeenCalledWith({ id: "q1", intent: "reject", note: "wrong fee" });
  });

  it("Send is not offered when the permission isn't there, with the reconnect line", async () => {
    state.sendAccess = "needs-permission";
    const r = await A.approveCardAction("q1");
    expect(r).toMatchObject({ ok: true, draft: { canSend: false, sendNote: expect.stringMatching(/reconnect your Outlook/) } });
    state.sendAccess = "switched-off";
    expect(await A.approveCardAction("q1")).toMatchObject({ ok: true, draft: { canSend: false, sendNote: expect.stringMatching(/isn't switched on/) } });
  });
});

describe("hand off", () => {
  it("records a hand-off to a staff member, the org from the session", async () => {
    const r = await A.handOffCardAction("q1", U.caitlyn, "  tidy  ");
    expect(r.ok).toBe(true);
    expect(state.record).toHaveBeenCalledWith({ orgId: "org-1", queueItemId: "q1", kind: "handoff", targetUserId: U.caitlyn, note: "tidy" });
    // The actor is never passed: the database default is auth.uid().
    expect(Object.keys(state.record.mock.calls[0][0])).not.toContain("actorId");
  });

  it.each([
    ["no one", ""],
    ["a viewer", U.viewer],
    ["someone not on the team", U.ghost],
    ["themselves", U.rebecca],
  ])("refuses %s", async (_n, target) => {
    expect((await A.handOffCardAction("q1", target, "")).ok).toBe(false);
    expect(state.record).not.toHaveBeenCalled();
  });

  it("an unreadable member directory refuses", async () => {
    state.membersFail = true;
    expect((await A.handOffCardAction("q1", U.caitlyn, "")).ok).toBe(false);
  });

  it("only someone whose yes it is, or who holds it, may hand it on", async () => {
    state.session = sessionFor(U.caitlyn, "paralegal", "caitlyn@example.com");
    expect(await A.handOffCardAction("q1", U.rebecca, "")).toMatchObject({ ok: false });
    state.cardState = { status: "ok", events: [{ queueItemId: "q1", kind: "handoff", actorId: U.rebecca, targetUserId: U.caitlyn, until: null, note: null, createdAt: "2026-11-10T13:00:00Z" }] };
    // Holding it, the paralegal may pass it on (still no Yes for them: that is the core's rule, untouched).
    expect((await A.handOffCardAction("q1", U.rebecca, "")).ok).toBe(true);
  });

  it("a resolved item can't be moved", async () => {
    state.item = qitem({ id: "q1", status: "approved" });
    expect((await A.handOffCardAction("q1", U.caitlyn, "")).ok).toBe(false);
    expect((await A.laterCardAction("q1")).ok).toBe(false);
  });
});

describe("before lectual 0103 (card events not set up)", () => {
  beforeEach(() => {
    state.cardState = { status: "not-set-up" };
  });
  it("Hand off, Later and Send back refuse with the not-switched-on sentence", async () => {
    expect(await A.handOffCardAction("q1", U.caitlyn, "")).toEqual({ ok: false, error: NOT_SWITCHED_ON });
    expect(await A.laterCardAction("q1")).toEqual({ ok: false, error: NOT_SWITCHED_ON });
    expect(await A.returnCardAction("q1", "")).toEqual({ ok: false, error: NOT_SWITCHED_ON });
    expect(state.record).not.toHaveBeenCalled();
  });
  it("a write the table refuses says the same", async () => {
    state.cardState = { status: "ok", events: [] };
    state.record.mockResolvedValue({ ok: false, reason: "not-set-up" });
    expect(await A.laterCardAction("q1")).toEqual({ ok: false, error: NOT_SWITCHED_ON });
  });
});

describe("later and send back", () => {
  it("Later puts it off until the next deal time", async () => {
    expect((await A.laterCardAction("q1")).ok).toBe(true);
    const until = Date.parse(state.record.mock.calls[0][0].until);
    expect(until).toBeGreaterThan(Date.now());
    expect(until - Date.now()).toBeLessThanOrEqual(25 * 3600_000);
  });

  it("Send back is for the holder (or whoever handed it)", async () => {
    expect((await A.returnCardAction("q1", "")).ok).toBe(false);
    state.cardState = { status: "ok", events: [{ queueItemId: "q1", kind: "handoff", actorId: U.rebecca, targetUserId: U.caitlyn, until: null, note: null, createdAt: "2026-11-10T13:00:00Z" }] };
    state.session = sessionFor(U.caitlyn, "paralegal", "caitlyn@example.com");
    expect((await A.returnCardAction("q1", "done")).ok).toBe(true);
    expect(state.record).toHaveBeenCalledWith(expect.objectContaining({ kind: "returned", queueItemId: "q1" }));
  });
});

describe("Send from Outlook now", () => {
  const approvedByMe = () => qitem({ id: "q1", status: "approved", resolved_by: "Rebecca@example.com", recipient: "ana@example.com" });

  it("sends only an item this same person approved, to its recipient", async () => {
    state.item = approvedByMe();
    const r = await A.sendDraftNowAction("q1", "AAMk1");
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/^Sent from Outlook by you at .+\.$/) });
    expect(state.send).toHaveBeenCalledWith({ draftId: "AAMk1", recipient: "ana@example.com", subject: "Next steps", approvedAt: null });
  });

  it.each([
    ["still pending", qitem({ id: "q1" })],
    ["approved by someone else", qitem({ id: "q1", status: "approved", resolved_by: "taylor@example.com" })],
    ["rejected", qitem({ id: "q1", status: "rejected", resolved_by: "rebecca@example.com" })],
    ["not a client email", qitem({ id: "q1", status: "approved", resolved_by: "rebecca@example.com", type: "BRIEFING" })],
    ["no recipient", qitem({ id: "q1", status: "approved", resolved_by: "rebecca@example.com", recipient: null })],
  ])("refuses an item %s, without calling the mailbox", async (_n, item) => {
    state.item = item;
    expect((await A.sendDraftNowAction("q1", "AAMk1")).ok).toBe(false);
    expect(state.send).not.toHaveBeenCalled();
  });

  it.each([
    ["needs-permission", /reconnect your Outlook/],
    ["switched-off", /isn't switched on/],
    ["not-a-draft", /isn't in your Outlook Drafts/],
    ["wrong-recipient", /no longer addressed to this client/],
    ["failed", /nothing was sent/],
  ])("a %s refusal from the mailbox is a fixed sentence", async (reason, re) => {
    state.item = approvedByMe();
    state.send.mockResolvedValue({ ok: false, reason });
    const r = await A.sendDraftNowAction("q1", "AAMk1");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(re);
  });
});
