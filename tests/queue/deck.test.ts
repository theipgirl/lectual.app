import { describe, expect, it } from "vitest";
import type { Role } from "@/lib/auth/roles";
import type { QueueItem } from "@/lib/queue/api";
import { buildDeck, deckEmptyState, cardTag, currentHolder, decidedToday, deckHref, deckMinutes, parseAtParam, positionOf, type CardEvent, type CardState } from "@/lib/queue/deck";
import { canApproveItem, type ApprovalRouting } from "@/lib/queue/routing";
import { followup, qitem, U } from "./routing-fixtures";

const NOW = new Date("2026-11-10T15:00:00Z");
const DEALT = new Date("2026-11-10T12:00:00Z");
const ok = (events: CardEvent[] = []): CardState => ({ status: "ok", events });
const ev = (over: Partial<CardEvent>): CardEvent => ({ queueItemId: "q1", kind: "handoff", actorId: U.rebecca, targetUserId: null, until: null, note: null, createdAt: "2026-11-10T13:00:00Z", ...over });
const rebecca = { userId: U.rebecca, role: "attorney" as Role };
const caitlyn = { userId: U.caitlyn, role: "paralegal" as Role };

const deck = (items: QueueItem[], over: Partial<Parameters<typeof buildDeck>[0]> = {}) =>
  buildDeck({ items, routing: {}, viewer: rebecca, cardState: ok(), now: NOW, dealtAt: DEALT, ...over });

const ids = (cards: { item: QueueItem }[]) => cards.map((c) => c.item.id);

describe("membership", () => {
  const items = [
    qitem({ id: "pc" }), // post-consult: attorney-only
    followup({ id: "fu" }),
    qitem({ id: "brief", type: "BRIEFING", agent: "morning-brief", headline: "Morning brief" }),
    qitem({ id: "done", status: "approved" }),
  ];

  it("deals the pending items the viewer may decide", () => {
    expect(ids(deck(items).cards).sort()).toEqual(["brief", "fu", "pc"]);
  });

  it("never deals a yes-card canApproveItem refuses, for any role and routing", () => {
    const routings: ApprovalRouting[] = [{}, { stalled_followup: U.caitlyn }, { internal_briefing: U.caitlyn, welcome_email: U.taylor }];
    const roles: Role[] = ["owner", "admin", "senior_admin", "attorney", "intake", "paralegal", "law_clerk", "clerk", "viewer", "social_media"];
    const pool = [...items, qitem({ id: "advice", agent: "welcome-client", draft_body: "We advise that you file now. This is legal advice." }), qitem({ id: "w", agent: "welcome-client" })];
    for (const routing of routings)
      for (const role of roles) {
        const viewer = { userId: U.caitlyn, role };
        const d = buildDeck({ items: pool, routing, viewer, cardState: ok(), now: NOW, dealtAt: null });
        for (const c of [...d.cards, ...d.laterArrivals, ...d.later, ...d.handedOff]) {
          expect(c.canYes, `${role} ${c.item.id}`).toBe(true);
          expect(canApproveItem({ role, userId: viewer.userId, item: c.item, routing }), `${role} ${c.item.id}`).toBe(true);
        }
      }
  });

  it("a viewer or social media role gets nothing", () => {
    expect(deck(items, { viewer: { userId: U.viewer, role: "viewer" } }).cards).toEqual([]);
  });

  it("an item routed to a colleague is not on the attorney's deck", () => {
    expect(ids(deck(items, { routing: { stalled_followup: U.caitlyn } }).cards)).not.toContain("fu");
    expect(ids(deck(items, { routing: { stalled_followup: U.caitlyn }, viewer: caitlyn }).cards)).toEqual(["fu"]);
  });
});

describe("hand-offs never widen who may approve", () => {
  const pc = qitem({ id: "q1" }); // attorney-only
  const handed = ok([ev({ kind: "handoff", targetUserId: U.caitlyn, note: "tidy the tone" })]);

  it("the colleague sees the card, with no Yes, on an attorney-only item", () => {
    const d = deck([pc], { viewer: caitlyn, cardState: handed });
    expect(ids(d.cards)).toEqual(["q1"]);
    expect(d.cards[0].canYes).toBe(false);
    expect(d.cards[0].handedToMe).toMatchObject({ userId: U.caitlyn, by: U.rebecca, note: "tidy the tone" });
  });

  it("the approver sees it under Handed off, not Needs your yes", () => {
    const d = deck([pc], { cardState: handed });
    expect(d.cards).toEqual([]);
    expect(d.handedOff.map((c) => c.holder.userId)).toEqual([U.caitlyn]);
  });

  it("sending it back returns it to the approver's deck", () => {
    const back = ok([ev({ kind: "handoff", targetUserId: U.caitlyn }), ev({ kind: "returned", actorId: U.caitlyn, createdAt: "2026-11-10T14:00:00Z" })]);
    expect(ids(deck([pc], { cardState: back }).cards)).toEqual(["q1"]);
    expect(deck([pc], { viewer: caitlyn, cardState: back }).cards).toEqual([]);
    expect(currentHolder(back.status === "ok" ? back.events : [], "q1")).toBeNull();
  });

  it("a handed card dealt to its holder ignores the deal time (someone is waiting on it)", () => {
    const late = qitem({ id: "q1", created_at: "2026-11-10T14:30:00Z" });
    expect(ids(deck([late], { viewer: caitlyn, cardState: handed }).cards)).toEqual(["q1"]);
  });
});

describe("later and late arrivals", () => {
  it("Later hides the card from the person who said so, until its time", () => {
    const later = ok([ev({ kind: "later", until: "2026-11-10T19:00:00Z" })]);
    const d = deck([qitem({ id: "q1" })], { cardState: later });
    expect(d.cards).toEqual([]);
    expect(d.later.map((c) => c.until)).toEqual(["2026-11-10T19:00:00Z"]);
    expect(ids(deck([qitem({ id: "q1" })], { cardState: later, now: new Date("2026-11-10T19:00:01Z") }).cards)).toEqual(["q1"]);
    // Someone else's Later doesn't hide it from me.
    expect(ids(deck([qitem({ id: "q1" })], { cardState: ok([ev({ kind: "later", actorId: U.taylor, until: "2026-11-10T19:00:00Z" })]) }).cards)).toEqual(["q1"]);
  });

  it("items queued after the deal are counted, not dealt; Deal them now deals them", () => {
    const items = [qitem({ id: "old", created_at: "2026-11-10T11:00:00Z" }), qitem({ id: "new", created_at: "2026-11-10T13:00:00Z" })];
    const d = deck(items);
    expect(ids(d.cards)).toEqual(["old"]);
    expect(ids(d.laterArrivals)).toEqual(["new"]);
    expect(ids(deck(items, { dealtAt: null }).cards)).toEqual(["old", "new"]);
  });
});

describe("a failed card-state read shows every card", () => {
  const items = [qitem({ id: "q1" }), qitem({ id: "q2" })];
  const events = [ev({ queueItemId: "q1", kind: "handoff", targetUserId: U.caitlyn }), ev({ queueItemId: "q2", kind: "later", until: "2026-11-10T19:00:00Z" })];
  it.each<CardState>([{ status: "unavailable" }, { status: "not-set-up" }])("%o", (cardState) => {
    const d = deck(items, { cardState });
    expect(ids(d.cards).sort()).toEqual(["q1", "q2"]);
    expect(d.eventsApplied).toBe(false);
  });
  it("while an ok read applies them", () => {
    expect(deck(items, { cardState: ok(events) }).cards).toEqual([]);
  });
});

describe("cards", () => {
  it("orders CHECK FIRST first, then oldest", () => {
    const items = [
      qitem({ id: "b", created_at: "2026-11-09T10:00:00Z" }),
      qitem({ id: "a", created_at: "2026-11-08T10:00:00Z" }),
      qitem({ id: "c", created_at: "2026-11-10T10:00:00Z", summary: "- CHECK FIRST: the fee quoted" }),
    ];
    expect(ids(deck(items).cards)).toEqual(["c", "a", "b"]);
  });

  it("tags, first step and closer look", () => {
    const d = deck([
      qitem({ id: "q1", summary: "Check the class list\nCHECK FIRST: the date" }),
      qitem({ id: "q2", type: "BRIEFING", agent: "morning-brief", headline: "Brief" }),
      qitem({ id: "q3", draft_body: "Hi [confirm the time]\n\nBest,\nThe Team" }),
      qitem({ id: "q4" }),
    ], { audit: { signOff: "The Team", teamSignOff: "The Team", memberNames: [] }, flags: { q4: { stale: true } } });
    const by = Object.fromEntries(d.cards.map((c) => [c.item.id, c]));
    expect(by.q1.firstStep).toBe("the date");
    expect(by.q1.closerLook).toEqual(["check-first"]);
    expect(by.q2.tag).toEqual({ kind: "internal" });
    expect(by.q3.closerLook).toContain("draft-issue");
    expect(by.q4.closerLook).toEqual(["stale"]);
    expect(cardTag(qitem())).toEqual({ kind: "yes", minutes: 2 });
    expect(deckMinutes(d.cards)).toBeGreaterThan(0);
  });

  it("positions by id, not by index", () => {
    const d = deck([qitem({ id: "a", created_at: "2026-11-08T00:00:00Z" }), qitem({ id: "b", created_at: "2026-11-09T00:00:00Z" }), qitem({ id: "c", created_at: "2026-11-10T00:00:00Z" })]);
    expect(positionOf(d.cards, "b")).toMatchObject({ position: 2, total: 3, prevId: "a", nextId: "c" });
    expect(positionOf(d.cards, "gone")).toMatchObject({ position: 1, prevId: null, nextId: "b" });
    expect(positionOf([], "a")).toBeNull();
    expect(parseAtParam("abc-1_2")).toBe("abc-1_2");
    expect(parseAtParam("../x")).toBeNull();
    expect(parseAtParam("a?b")).toBeNull();
    expect(deckHref({ view: "board", at: "b", dealNow: true })).toBe("/dashboard/queue/deck/?view=board&at=b&deal=now");
    expect(deckHref({})).toBe("/dashboard/queue/deck/");
  });

  it("decided today is this person's, today only", () => {
    const items = [
      qitem({ id: "a", status: "approved", resolved_by: "Rebecca@Example.com", resolved_at: "2026-11-10T13:00:00Z" }),
      qitem({ id: "b", status: "rejected", resolved_by: "other@example.com", resolved_at: "2026-11-10T13:00:00Z" }),
      qitem({ id: "c", status: "approved", resolved_by: "rebecca@example.com", resolved_at: "2026-11-01T13:00:00Z" }),
    ];
    expect(decidedToday(items, "rebecca@example.com", (d) => d.toISOString().startsWith("2026-11-10")).map((i) => i.id)).toEqual(["a"]);
    expect(decidedToday(items, null, () => true)).toEqual([]);
  });
});

describe("deckEmptyState", () => {
  const none = { laterArrivals: [], later: [], handedOff: [] };
  const card = (id: string) => ({ item: qitem({ id }) }) as never;
  const st = (over: Partial<Parameters<typeof deckEmptyState>[0]> = {}) => deckEmptyState({ queueOk: true, role: "attorney", deck: none, nextDealLabel: "2:00 PM", ...over });

  it("All decided only for a reached queue with nothing waiting", () => {
    expect(st()).toMatchObject({ kind: "all-decided", headline: "All decided. Next deal 2:00 PM." });
  });
  it("an unreached queue is never All decided", () => {
    expect(st({ queueOk: false })).toEqual({ kind: "unreached" });
  });
  it("later arrivals, Later and hand-offs are counted", () => {
    expect(st({ deck: { ...none, laterArrivals: [card("a"), card("b")] } })).toMatchObject({ kind: "waiting", details: ["2 more at 2:00 PM."] });
    expect(st({ deck: { ...none, later: [card("a")] as never } })).toMatchObject({ details: ["1 card is back at 2:00 PM."] });
    expect(st({ deck: { ...none, handedOff: [card("a"), card("b")] as never } })).toMatchObject({ details: ["2 handed to colleagues."] });
  });
  it("viewer and non-approver roles have nothing to decide", () => {
    for (const role of ["viewer", "social_media", "paralegal", "clerk"] as Role[]) expect(st({ role }).kind, role).toBe("nothing-for-you");
  });
});

describe("deckEmptyState: All decided only when nothing waits for anyone", () => {
  it("an approver with an empty deck but items waiting for colleagues is told so", async () => {
    const { deckEmptyState } = await import("@/lib/queue/deck");
    const empty = { laterArrivals: [], later: [], handedOff: [] };
    const r = deckEmptyState({ queueOk: true, role: "owner", deck: empty, nextDealLabel: "2:00 PM", othersPending: 2 });
    expect(r.kind).toBe("waiting");
    expect(r.kind === "waiting" && r.details.join(" ")).toMatch(/2 waiting for colleagues to decide/);
    expect(deckEmptyState({ queueOk: true, role: "owner", deck: empty, nextDealLabel: "2:00 PM", othersPending: 0 }).kind).toBe("all-decided");
  });
});
