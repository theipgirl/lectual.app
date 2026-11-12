import { describe, it, expect } from "vitest";
import { currentHolder, type CardEvent, type CardState } from "@/lib/queue/deck";
import { cardNoticePayload, handedCantApprove, handedToViewer, returnDecision, showHandedPill } from "@/lib/queue/handed";
import { describeNotification } from "@/lib/notifications/describe";
import { followup, MEMBERS, qitem, U } from "./routing-fixtures";

const ev = (over: Partial<CardEvent>): CardEvent => ({ queueItemId: "q1", kind: "handoff", actorId: U.rebecca, targetUserId: U.caitlyn, until: null, note: null, createdAt: "2026-11-10T13:00:00Z", ...over });
const ok = (events: CardEvent[]): CardState => ({ status: "ok", events });

describe("holder detection", () => {
  it("a handoff holds the card for its target", () => {
    expect(currentHolder([ev({ note: "hi" })], "q1")).toMatchObject({ userId: U.caitlyn, by: U.rebecca, note: "hi" });
  });
  it("a returned event ends it", () => {
    expect(currentHolder([ev({}), ev({ kind: "returned", actorId: U.caitlyn, targetUserId: null, createdAt: "2026-11-10T14:00:00Z" })], "q1")).toBeNull();
  });
  it("a re-handoff after a return holds again, for the new target", () => {
    const events = [ev({}), ev({ kind: "returned", actorId: U.caitlyn, targetUserId: null, createdAt: "2026-11-10T14:00:00Z" }), ev({ targetUserId: U.taylor, createdAt: "2026-11-10T15:00:00Z" })];
    expect(currentHolder(events, "q1")).toMatchObject({ userId: U.taylor });
  });
  it("another item's events never hold this one", () => {
    expect(currentHolder([ev({ queueItemId: "q2" })], "q1")).toBeNull();
  });
});

describe("handedToViewer and the pill", () => {
  const items = [{ id: "q1" }, { id: "q2" }, { id: "q3" }];
  it("lists only the items handed to the viewer", () => {
    const handed = handedToViewer(items, ok([ev({}), ev({ queueItemId: "q2", targetUserId: U.taylor })]), U.caitlyn);
    expect([...handed.keys()]).toEqual(["q1"]);
    expect(showHandedPill(handed)).toBe(true);
  });
  it("draws nothing with no hand-offs, and nothing when the events were not read", () => {
    expect(showHandedPill(handedToViewer(items, ok([]), U.caitlyn))).toBe(false);
    expect(showHandedPill(handedToViewer(items, ok([ev({ targetUserId: U.taylor })]), U.caitlyn))).toBe(false);
    expect(showHandedPill(handedToViewer(items, { status: "not-set-up" }, U.caitlyn))).toBe(false);
    expect(showHandedPill(handedToViewer(items, { status: "unavailable" }, U.caitlyn))).toBe(false);
    expect(showHandedPill(handedToViewer(items, ok([ev({})]), null))).toBe(false);
  });
});

describe("send back decision", () => {
  const base = { callerId: U.caitlyn, callerRole: "paralegal" as const, itemStatus: "pending", cardState: ok([ev({})]), itemId: "q1", allowHander: false };
  it("allows the current holder", () => {
    expect(returnDecision(base)).toMatchObject({ ok: true, holder: { userId: U.caitlyn, by: U.rebecca } });
  });
  it("refuses someone who is not the holder, the hander (item page), and a card already sent back", () => {
    expect(returnDecision({ ...base, callerId: U.taylor })).toEqual({ ok: false, reason: "not-yours" });
    expect(returnDecision({ ...base, callerId: U.rebecca })).toEqual({ ok: false, reason: "not-yours" });
    expect(returnDecision({ ...base, cardState: ok([ev({}), ev({ kind: "returned", targetUserId: null, createdAt: "2026-11-10T14:00:00Z" })]) })).toEqual({ ok: false, reason: "not-yours" });
  });
  it("the deck's wider rule lets whoever handed it recall it", () => {
    expect(returnDecision({ ...base, callerId: U.rebecca, allowHander: true }).ok).toBe(true);
  });
  it("refuses an item that is not pending", () => {
    for (const status of ["approved", "rejected", null]) expect(returnDecision({ ...base, itemStatus: status })).toEqual({ ok: false, reason: "not-yours" });
  });
  it("refuses a foreign item: no hand-off for this id", () => {
    expect(returnDecision({ ...base, itemId: "someone-elses" })).toEqual({ ok: false, reason: "not-yours" });
  });
  it("refuses a role that cannot hold work", () => {
    expect(returnDecision({ ...base, callerRole: "viewer" })).toEqual({ ok: false, reason: "not-yours" });
  });
  it("says not set up for a missing table and failed for an unreadable one, never allowing", () => {
    expect(returnDecision({ ...base, cardState: { status: "not-set-up" } })).toEqual({ ok: false, reason: "not-set-up" });
    expect(returnDecision({ ...base, cardState: { status: "unavailable" } })).toEqual({ ok: false, reason: "failed" });
  });
});

describe("the can't-approve sentence", () => {
  const members = MEMBERS;
  it("is null when the viewer may approve", () => {
    expect(handedCantApprove({ canApprove: true, item: qitem(), routing: {}, members })).toBeNull();
  });
  it("names the approver rule, or the person it is routed to", () => {
    expect(handedCantApprove({ canApprove: false, item: qitem(), routing: {}, members })).toBe("This one needs an approver's yes. You can edit it and send it back.");
    expect(handedCantApprove({ canApprove: false, item: followup(), routing: { stalled_followup: U.rebecca }, members })).toBe("This one is for Rebecca. You can edit it and send it back.");
  });
});

describe("notification payload and text", () => {
  it("carries the id, the source and a clipped headline, nothing else", () => {
    const payload = cardNoticePayload("card_handoff", qitem({ id: "q9", headline: "x".repeat(300), draft_body: "BODY", recipient: "a@b.c", subject: "SUBJ" }));
    expect(Object.keys(payload).sort()).toEqual(["headline", "queue_id", "source"]);
    expect(payload.headline.length).toBeLessThanOrEqual(120);
    expect(JSON.stringify(payload)).not.toMatch(/BODY|a@b\.c|SUBJ/);
  });
  it("renders as '<first name> handed you an approval', linking to the card", () => {
    const d = describeNotification({ kind: "approval_needed", payload: { source: "card_handoff", queue_id: "q1", headline: "Hi" } }, { actorName: "Rebecca Smith" });
    expect(d).toMatchObject({ sentence: "Rebecca handed you an approval", href: "/dashboard/queue/q1/", icon: "approval" });
  });
  it("renders a sent-back card, and falls back to 'Someone' without a name", () => {
    expect(describeNotification({ kind: "approval_needed", payload: { source: "card_returned", queue_id: "q1" } }, { actorName: "Caitlyn" }).sentence).toBe("Caitlyn sent an approval back");
    expect(describeNotification({ kind: "approval_needed", payload: { source: "card_handoff", queue_id: "q1" } }).sentence).toBe("Someone handed you an approval");
  });
  it("an ordinary approval notice still reads as before", () => {
    expect(describeNotification({ kind: "approval_needed", payload: { source: "approval_needed", queue_id: "q1", headline: "H" } }).sentence).toBe("A draft is waiting for your approval: H");
  });
  it("never reads a note or body, even if a payload carries one", () => {
    const d = describeNotification({ kind: "approval_needed", payload: { source: "card_handoff", queue_id: "q1", note: "SECRET", body: "SECRET" } }, { actorName: "Rebecca" });
    expect(JSON.stringify(d)).not.toContain("SECRET");
  });
});
