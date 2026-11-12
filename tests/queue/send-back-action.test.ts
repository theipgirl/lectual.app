import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { qitem, U } from "./routing-fixtures";

/** The approval page's "Send back to <name>" action (src/app/dashboard/queue/actions.ts -> sendCardBack). */

const state = vi.hoisted(() => ({
  session: null as unknown,
  item: null as unknown,
  cardState: { status: "ok", events: [] } as unknown,
  record: vi.fn(),
  notify: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (...a: unknown[]) => {
    state.redirect(...a);
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT" });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: vi.fn(async () => state.session) }));
vi.mock("@/lib/queue/org", () => ({ activeQueueOrgKey: vi.fn(async () => "firm-key") }));
vi.mock("@/lib/queue/api", () => ({ getQueueItem: vi.fn(async () => state.item), resolveQueueItem: vi.fn() }));
vi.mock("@/lib/queue/review-core", () => ({ runQueueReview: vi.fn(), requireFirmReviewer: vi.fn(), ReviewerRefusal: class extends Error {} }));
vi.mock("@/lib/queue/routing-load", () => ({ loadApprovalRouting: vi.fn(async () => ({ status: "ok", routing: {}, members: [], dropped: 0 })) }));
vi.mock("@/lib/queue/load", () => ({ loadActiveQueue: vi.fn() }));
vi.mock("@/lib/queue/card-state", () => ({
  loadCardState: vi.fn(async () => state.cardState),
  recordCardEvent: (...a: unknown[]) => state.record(...a),
}));
vi.mock("@/lib/notifications/core", () => ({ notify: (...a: unknown[]) => state.notify(...a) }));

const A = await import("@/app/dashboard/queue/actions");

const sessionFor = (userId: string, role: string) => ({ kind: "ok", user: { id: userId, email: "x@example.com" }, role, org: { id: "org-1", name: "Firm", slug: "firm", modules: [] }, member: { role, org_id: "org-1" }, actingAsStaff: false });
const handoff = (over: object = {}) => ({ queueItemId: "q1", kind: "handoff", actorId: U.rebecca, targetUserId: U.caitlyn, until: null, note: "please check", createdAt: "2026-11-10T13:00:00Z", ...over });
const form = (id: string, note?: string) => {
  const f = new FormData();
  f.set("id", id);
  if (note !== undefined) f.set("note", note);
  return f;
};
const NOT_YOURS = "This card isn't on your deck any more. Refresh to see what's left.";

beforeEach(() => {
  state.session = sessionFor(U.caitlyn, "paralegal");
  state.item = qitem({ id: "q1", headline: "Post-consult follow-up — Ana", draft_body: "SECRET BODY" });
  state.cardState = { status: "ok", events: [handoff()] };
  state.record.mockReset().mockResolvedValue({ ok: true });
  state.notify.mockReset().mockResolvedValue(undefined);
  state.redirect.mockReset();
});

describe("sendBackAction", () => {
  it("the current holder sends it back: a returned event with the note, a notice to the hander, then a redirect", async () => {
    await expect(A.sendBackAction({}, form("q1", "  all good, over to you  "))).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
    expect(state.record).toHaveBeenCalledWith({ orgId: "org-1", queueItemId: "q1", kind: "returned", note: "all good, over to you" });
    expect(state.notify).toHaveBeenCalledTimes(1);
    const arg = state.notify.mock.calls[0][0];
    expect(arg).toMatchObject({ userId: U.rebecca, kind: "approval_needed", actorId: U.caitlyn });
    expect(arg.payload).toEqual({ source: "card_returned", queue_id: "q1", headline: "Post-consult follow-up — Ana" });
    expect(JSON.stringify(arg)).not.toMatch(/SECRET BODY|all good/);
    expect(state.redirect).toHaveBeenCalledWith("/dashboard/queue/q1/?returned=1");
  });

  it("the note is optional", async () => {
    await expect(A.sendBackAction({}, form("q1"))).rejects.toMatchObject({ message: "NEXT_REDIRECT" });
    expect(state.record.mock.calls[0][0].note).toBeNull();
  });

  it("refuses a note over 500 characters, writing nothing", async () => {
    const r = await A.sendBackAction({}, form("q1", "x".repeat(501)));
    expect(r.error).toBe("That note is too long. Keep it to 500 characters.");
    expect(state.record).not.toHaveBeenCalled();
  });

  it.each([
    ["not the holder", () => (state.session = sessionFor(U.taylor, "owner"))],
    ["the person who handed it (the item page is for the holder)", () => (state.session = sessionFor(U.rebecca, "attorney"))],
    ["signed out", () => (state.session = { kind: "signed-out", redirectTo: "/" })],
    ["a viewer", () => (state.session = sessionFor(U.viewer, "viewer"))],
    ["an item that is not pending", () => (state.item = qitem({ id: "q1", status: "approved" }))],
    ["a card already sent back", () => (state.cardState = { status: "ok", events: [handoff(), handoff({ kind: "returned", targetUserId: null, createdAt: "2026-11-10T14:00:00Z" })] })],
    ["another firm's item (not found)", () => (state.item = null)],
    ["an item with no hand-off at all", () => (state.cardState = { status: "ok", events: [handoff({ queueItemId: "other" })] })],
  ])("refuses %s and records nothing", async (_n, arrange) => {
    arrange();
    const r = await A.sendBackAction({}, form("q1"));
    expect(r.error).toBeTruthy();
    expect(state.record).not.toHaveBeenCalled();
    expect(state.notify).not.toHaveBeenCalled();
    expect(state.redirect).not.toHaveBeenCalled();
  });

  it("uses fixed sentences: not yours, not switched on, failed", async () => {
    state.session = sessionFor(U.taylor, "owner");
    expect((await A.sendBackAction({}, form("q1"))).error).toBe(NOT_YOURS);
    state.session = sessionFor(U.caitlyn, "paralegal");
    state.cardState = { status: "not-set-up" };
    expect((await A.sendBackAction({}, form("q1"))).error).toBe("This isn't switched on for your firm yet. Lectual will turn it on.");
    state.cardState = { status: "unavailable" };
    expect((await A.sendBackAction({}, form("q1"))).error).toMatch(/didn't go through/);
    state.cardState = { status: "ok", events: [handoff()] };
    state.record.mockResolvedValue({ ok: false, reason: "not-set-up" });
    expect((await A.sendBackAction({}, form("q1"))).error).toBe("This isn't switched on for your firm yet. Lectual will turn it on.");
    state.record.mockResolvedValue({ ok: false, reason: "failed" });
    expect((await A.sendBackAction({}, form("q1"))).error).toMatch(/didn't go through/);
    expect(state.notify).not.toHaveBeenCalled();
  });

  it("a bad id is refused without any read", async () => {
    expect((await A.sendBackAction({}, form("../x"))).error).toBeTruthy();
    expect(state.record).not.toHaveBeenCalled();
  });

  it("takes no user, org or role from the form", () => {
    const src = readFileSync("src/lib/queue/card-moves.ts", "utf8");
    expect(src).not.toMatch(/formData\.get\("(user|org|role)/);
    expect(readFileSync("src/app/dashboard/queue/actions.ts", "utf8")).toMatch(/sendCardBack\(\{ id, note: cardNoteOf\(rawNote\), allowHander: false \}\)/);
  });
});
