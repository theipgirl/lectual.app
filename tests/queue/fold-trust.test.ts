import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Role } from "@/lib/auth/roles";
import { buildDeck, currentHolder, eventTrust, trustedCardState, trustedEvents, viewEventTrust, type CardEvent, type EventTrust } from "@/lib/queue/deck";
import { handedToViewer, returnDecision } from "@/lib/queue/handed";
import type { ApprovalRouting, RoutingMember } from "@/lib/queue/routing";
import { followup, MEMBERS, qitem, U } from "./routing-fixtures";

/**
 * The deck's fold ignores hand-off and return rows from people who couldn't have made them (RLS lets any staff member
 * insert one). Approval itself never moves: this is only about whose deck shows a card.
 */

const MALLORY = "00000000-0000-4000-8000-0000000000aa";
const members: RoutingMember[] = [...MEMBERS, { userId: MALLORY, role: "paralegal", displayName: "Mallory", email: "mallory@example.com" }];
const known = (routing: ApprovalRouting = {}): EventTrust => eventTrust({ status: "ok", routing, members });
const UNKNOWN: EventTrust = { status: "unknown" };

let t = 0;
const at = () => `2026-11-10T13:${String(t++ % 60).padStart(2, "0")}:00Z`;
const handoff = (actorId: string, targetUserId: string, queueItemId = "pc"): CardEvent => ({ queueItemId, kind: "handoff", actorId, targetUserId, until: null, note: null, createdAt: at() });
const returned = (actorId: string, queueItemId = "pc"): CardEvent => ({ queueItemId, kind: "returned", actorId, targetUserId: null, until: null, note: null, createdAt: at() });

const pc = qitem({ id: "pc" }); // post-consult: attorney-only
const fu = followup({ id: "fu" }); // a stalled follow-up: routable to any staff member
const items = [pc, fu];
const holderOf = (events: CardEvent[], id = "pc", trust: EventTrust = known()) => currentHolder(trustedEvents(events, items, trust), id);

const NOW = new Date("2026-11-10T15:00:00Z");
const rebecca = { userId: U.rebecca, role: "attorney" as Role };
const deckFor = (events: CardEvent[], trust: EventTrust, routing: ApprovalRouting = {}, viewer = rebecca) =>
  buildDeck({ items, routing, viewer, cardState: { status: "ok", events }, trust, now: NOW, dealtAt: null });
const ids = (cards: { item: { id: string } }[]) => cards.map((c) => c.item.id).sort();

describe("forged events are ignored", () => {
  it("a hand-off by someone who may not approve and does not hold the card", () => {
    // Mallory (paralegal) pulls Rebecca's attorney-only card to herself, then to Caitlyn.
    expect(holderOf([handoff(MALLORY, MALLORY)])).toBeNull();
    expect(holderOf([handoff(MALLORY, U.caitlyn)])).toBeNull();
    const d = deckFor([handoff(MALLORY, U.caitlyn)], known());
    expect(ids(d.cards)).toEqual(["fu", "pc"]);
    expect(d.handedOff).toEqual([]);
  });

  it("a non-approver can't steal a non-attorney card either, without a routing that names them", () => {
    expect(holderOf([handoff(MALLORY, MALLORY, "fu")], "fu")).toBeNull();
  });

  it("a member who has left (no role) counts as no one", () => {
    expect(holderOf([handoff(U.ghost, U.caitlyn)])).toBeNull();
  });

  it("a return by someone who is neither holder, hander nor approver", () => {
    const events = [handoff(U.rebecca, U.caitlyn), returned(MALLORY)];
    expect(holderOf(events)).toMatchObject({ userId: U.caitlyn, by: U.rebecca });
    expect(ids(deckFor(events, known()).handedOff)).toEqual(["pc"]);
  });

  it("a return with nothing handed off is dropped", () => {
    const events = [returned(U.rebecca)];
    expect(trustedEvents(events, items, known())).toEqual([]);
  });

  it("the technician page's pill ignores a forged hand-off to the viewer", () => {
    expect(handedToViewer(items, { status: "ok", events: [handoff(MALLORY, MALLORY)] }, MALLORY, known()).size).toBe(0);
    expect(handedToViewer(items, { status: "ok", events: [handoff(U.rebecca, MALLORY)] }, MALLORY, known()).size).toBe(1);
  });

  it("Send back can't be claimed through a forged hand-off", () => {
    const state = trustedCardState({ status: "ok", events: [handoff(MALLORY, MALLORY)] }, items, known());
    expect(returnDecision({ callerId: MALLORY, callerRole: "paralegal", itemStatus: "pending", cardState: state, itemId: "pc", allowHander: true })).toEqual({ ok: false, reason: "not-yours" });
  });
});

describe("legitimate chains", () => {
  it("approver hands to A; A sends it back", () => {
    const events = [handoff(U.rebecca, U.caitlyn), returned(U.caitlyn)];
    expect(trustedEvents(events, items, known())).toEqual(events);
    expect(holderOf(events)).toBeNull();
  });

  it("the holder may hand it on, and the next holder or the hander may send it back", () => {
    const chain = [handoff(U.rebecca, U.caitlyn), handoff(U.caitlyn, MALLORY)];
    expect(holderOf(chain)).toMatchObject({ userId: MALLORY, by: U.caitlyn });
    expect(holderOf([...chain, returned(MALLORY)])).toBeNull();
    expect(holderOf([...chain, returned(U.caitlyn)])).toBeNull(); // the hander of the current hand-off recalls it
  });

  it("someone who may approve can end a hand-off they didn't make", () => {
    const chain = [handoff(U.rebecca, U.caitlyn), handoff(U.caitlyn, MALLORY), returned(U.taylor)];
    expect(holderOf(chain)).toBeNull();
  });

  it("an earlier holder loses the right once the card has moved on", () => {
    const chain = [handoff(U.rebecca, U.caitlyn), handoff(U.caitlyn, MALLORY), returned(MALLORY), handoff(MALLORY, U.caitlyn)];
    // Mallory was holder, but after her return she holds nothing and may not approve: her hand-off is ignored.
    expect(holderOf(chain)).toBeNull();
  });

  it("a routed owner who isn't an approver role counts for a non-attorney item (canApproveItem allows it)", () => {
    const routing: ApprovalRouting = { stalled_followup: U.caitlyn };
    const events = [handoff(U.caitlyn, MALLORY, "fu")];
    expect(holderOf(events, "fu", known(routing))).toMatchObject({ userId: MALLORY, by: U.caitlyn });
    // Without that routing she may not approve it, so the same row is ignored.
    expect(holderOf(events, "fu", known())).toBeNull();
  });

  it("later rows are kept whoever wrote them: they only change their own actor's deck", () => {
    const later: CardEvent = { queueItemId: "pc", kind: "later", actorId: MALLORY, targetUserId: null, until: "2026-11-11T12:00:00Z", note: null, createdAt: at() };
    expect(trustedEvents([later], items, known())).toEqual([later]);
  });

  it("is idempotent: folding the kept events again keeps them all", () => {
    const events = [handoff(MALLORY, U.caitlyn), handoff(U.rebecca, U.caitlyn), returned(MALLORY), handoff(U.caitlyn, MALLORY), returned(U.caitlyn)];
    const once = trustedEvents(events, items, known());
    expect(trustedEvents(once, items, known())).toEqual(once);
  });

  it("with trust known, a hand-off for an item that isn't in the list can't be checked and is dropped", () => {
    expect(trustedEvents([handoff(U.rebecca, U.caitlyn, "elsewhere")], items, known())).toEqual([]);
  });
});

describe("unreadable roles or routing keep today's behaviour", () => {
  it("eventTrust is unknown when the routing load failed", () => {
    expect(eventTrust({ status: "failed" })).toEqual(UNKNOWN);
    expect(viewEventTrust({ routing: {}, members: null, routingFailed: false })).toEqual(UNKNOWN);
    expect(viewEventTrust({ routing: {}, members, routingFailed: true })).toEqual(UNKNOWN);
    expect(viewEventTrust({ routing: {}, members, routingFailed: false }).status).toBe("known");
  });

  it("every event is trusted, the forged ones included", () => {
    const events = [handoff(MALLORY, U.caitlyn)];
    expect(trustedEvents(events, items, UNKNOWN)).toEqual(events);
    expect(holderOf(events, "pc", UNKNOWN)).toMatchObject({ userId: U.caitlyn, by: MALLORY });
    expect(ids(deckFor(events, UNKNOWN).handedOff)).toEqual(["pc"]);
  });

  it("an unread card-event state passes through as it is", () => {
    expect(trustedCardState({ status: "unavailable" }, items, known())).toEqual({ status: "unavailable" });
    expect(trustedCardState({ status: "not-set-up" }, items, known())).toEqual({ status: "not-set-up" });
    expect(ids(buildDeck({ items, routing: {}, viewer: rebecca, cardState: { status: "unavailable" }, trust: known(), now: NOW, dealtAt: null }).cards)).toEqual(["fu", "pc"]);
  });
});

describe("every reader of the card events folds them with the trust rule", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
    });
  it("each file that calls loadCardState also applies trust", () => {
    const readers = walk("src").filter((f) => !f.endsWith("card-state.ts") && /loadCardState\(/.test(readFileSync(f, "utf8")));
    expect(readers.length).toBeGreaterThan(0);
    for (const f of readers) expect(readFileSync(f, "utf8"), f).toMatch(/eventTrust\(|viewEventTrust\(|trustedCardState\(/);
  });
});
