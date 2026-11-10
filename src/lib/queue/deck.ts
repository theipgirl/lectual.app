import type { Role } from "@/lib/auth/roles";
import type { QueueItem } from "@/lib/queue/api";
import { approvalBlock, auditDraft, type AuditContext } from "@/lib/queue/hygiene";
import { mineItems } from "@/lib/queue/mine";
import { parseReviewerSummary } from "@/lib/queue/reviewer-summary";
import { QUEUE_APPROVE_ROLES, QUEUE_EDIT_ROLES } from "@/lib/queue/roles";
import { DECK_NOTHING_FOR_YOU, DECK_NOTHING_NOW, deckAllDecided, deckHandedCount, deckOthersWaiting, deckLaterArrivals, deckLaterBack, deckLaterBackWhen } from "@/lib/ui/words";
import { canApproveItem, classifyQueueItem, type ApprovalRouting, type QueueKind, type Viewer } from "@/lib/queue/routing";

/**
 * The approval deck: which pending approvals are dealt to one person, in what order, and what each card says. Pure.
 *
 * Who may approve never changes here: a card has a Yes only when `canApproveItem` says so for this viewer, exactly the
 * rule the server action runs again. Card events (`queue_card_event`) only change WHOSE deck shows a card and WHEN:
 *  · handoff   the card leaves the approver's "Needs your yes" and appears on the colleague's deck. The colleague may
 *              edit and send it back; a Yes appears for them only if `canApproveItem` already allowed it.
 *  · later     the card is hidden from the person who said so until `until` (the next deal time).
 *  · returned  a hand-off ends; the card is back with the usual approvers.
 * When the events can't be read (or the table isn't there yet) every card the viewer may approve is dealt: never fewer.
 */

export type CardEventKind = "handoff" | "later" | "returned";
export type CardEvent = {
  queueItemId: string;
  kind: CardEventKind;
  actorId: string;
  targetUserId: string | null;
  until: string | null;
  note: string | null;
  createdAt: string;
};
export type CardState = { status: "ok"; events: CardEvent[] } | { status: "not-set-up" } | { status: "unavailable" };

/** The hand-off holding an item right now, if any: the newest handoff with no later `returned`. */
export type Holder = { userId: string; by: string; note: string | null; at: string };

export function currentHolder(events: readonly CardEvent[], itemId: string): Holder | null {
  let holder: Holder | null = null;
  for (const e of events) {
    if (e.queueItemId !== itemId) continue;
    if (e.kind === "handoff" && e.targetUserId) holder = { userId: e.targetUserId, by: e.actorId, note: e.note, at: e.createdAt };
    else if (e.kind === "returned") holder = null;
  }
  return holder;
}

/** The viewer's own "later" on an item that is still in force: its `until`, else null. */
export function laterUntil(events: readonly CardEvent[], itemId: string, viewerId: string, now: Date): string | null {
  let until: string | null = null;
  for (const e of events) {
    if (e.queueItemId !== itemId || e.actorId !== viewerId || e.kind !== "later" || !e.until) continue;
    until = e.until;
  }
  if (!until) return null;
  const t = Date.parse(until);
  return Number.isFinite(t) && t > now.getTime() ? until : null;
}

/** About how long a card takes: a minute to read about 200 words, plus one to decide. 1 to 15. */
export function estimateMinutes(item: Pick<QueueItem, "draft_body" | "final_body">): number {
  const words = (item.final_body ?? item.draft_body ?? "").split(/\s+/).filter(Boolean).length;
  return Math.min(15, Math.max(1, Math.ceil(words / 200) + 1));
}

export type CardTag = { kind: "yes"; minutes: number } | { kind: "internal" };

export function cardTag(item: QueueItem): CardTag {
  return classifyQueueItem(item) === "internal_briefing" ? { kind: "internal" } : { kind: "yes", minutes: estimateMinutes(item) };
}

/** Facts the page loader reads on the server, per item, that the pure deal cannot: a stale draft, a linked-proposal gate. */
export type CloserLookFlags = { stale?: boolean; linkedProposal?: boolean };

export type CloserReason = "check-first" | "draft-issue" | "stale" | "linked-proposal";

export type DeckCard = {
  item: QueueItem;
  kind: QueueKind;
  tag: CardTag;
  /** The reviewer's first step, CHECK FIRST ones first. */
  firstStep: string | null;
  checkFirst: boolean;
  /** "Open to review" replaces Yes when this is non-empty. */
  closerLook: CloserReason[];
  /** The viewer may approve this item (the routing rule, unchanged). */
  canYes: boolean;
  /** Handed to this viewer by someone else. */
  handedToMe: Holder | null;
};

export function needsCloserLook(item: QueueItem, audit: Omit<AuditContext, "type"> | null, flags: CloserLookFlags | undefined): CloserReason[] {
  const reasons: CloserReason[] = [];
  if (parseReviewerSummary(item.summary).some((s) => s.checkFirst)) reasons.push("check-first");
  if (audit && approvalBlock(auditDraft(item.final_body ?? item.draft_body, { type: item.type, ...audit }))) reasons.push("draft-issue");
  if (flags?.stale) reasons.push("stale");
  if (flags?.linkedProposal) reasons.push("linked-proposal");
  return reasons;
}

function toCard(item: QueueItem, viewer: Viewer, routing: ApprovalRouting, audit: Omit<AuditContext, "type"> | null, flags: CloserLookFlags | undefined, holder: Holder | null): DeckCard {
  const steps = parseReviewerSummary(item.summary);
  return {
    item,
    kind: classifyQueueItem(item),
    tag: cardTag(item),
    firstStep: steps[0]?.text ?? null,
    checkFirst: steps.some((s) => s.checkFirst),
    closerLook: needsCloserLook(item, audit, flags),
    canYes: canApproveItem({ role: viewer.role, userId: viewer.userId, item, routing }),
    handedToMe: holder && holder.userId === viewer.userId ? holder : null,
  };
}

/** CHECK FIRST first, then oldest first; the id breaks a tie so the order never wobbles. */
export function compareCards(a: DeckCard, b: DeckCard): number {
  if (a.checkFirst !== b.checkFirst) return a.checkFirst ? -1 : 1;
  const t = a.item.created_at.localeCompare(b.item.created_at);
  return t !== 0 ? t : a.item.id.localeCompare(b.item.id);
}

export type Deck = {
  /** Dealt now, in order. */
  cards: DeckCard[];
  /** Queued after the deal: counted, not dealt. */
  laterArrivals: DeckCard[];
  /** Held back by this viewer's own Later. */
  later: Array<DeckCard & { until: string }>;
  /** The viewer's approvals currently handed to someone else. */
  handedOff: Array<DeckCard & { holder: Holder }>;
  /** False when the card events could not be read: every card was dealt and Later / hand-offs were not applied. */
  eventsApplied: boolean;
};

export function buildDeck(args: {
  items: readonly QueueItem[];
  routing: ApprovalRouting;
  viewer: Viewer;
  cardState: CardState;
  now: Date;
  /** The deal on the table; null deals everything now ("Deal them now"). */
  dealtAt: Date | null;
  audit?: Omit<AuditContext, "type"> | null;
  flags?: Record<string, CloserLookFlags>;
}): Deck {
  const { routing, viewer, cardState, now, dealtAt } = args;
  const pending = args.items.filter((i) => i.status === "pending");
  const audit = args.audit ?? null;
  const events = cardState.status === "ok" ? cardState.events : [];
  const eventsApplied = cardState.status === "ok";

  // The viewer's own approvals: the same "Mine" the Approvals page and Today count, then only those they may decide.
  const mineIds = new Set(mineItems(pending, routing, viewer).map((i) => i.id));
  const out: Deck = { cards: [], laterArrivals: [], later: [], handedOff: [], eventsApplied };

  const dealt = (item: QueueItem) => {
    if (!dealtAt) return true;
    const t = Date.parse(item.created_at);
    return !Number.isFinite(t) || t <= dealtAt.getTime();
  };

  for (const item of pending) {
    const holder = eventsApplied ? currentHolder(events, item.id) : null;
    const card = toCard(item, viewer, routing, audit, args.flags?.[item.id], holder);
    const mineToDecide = mineIds.has(item.id) && card.canYes;
    const handedToMe = !!card.handedToMe;
    if (!mineToDecide && !handedToMe) continue;

    if (holder && holder.userId !== viewer.userId) {
      // Handed to a colleague: off this viewer's yes pile, listed under Handed off.
      out.handedOff.push({ ...card, holder });
      continue;
    }
    const until = eventsApplied ? laterUntil(events, item.id, viewer.userId, now) : null;
    if (until) {
      out.later.push({ ...card, until });
      continue;
    }
    // A card handed to me is dealt at once: someone is waiting on it.
    if (!handedToMe && !dealt(item)) {
      out.laterArrivals.push(card);
      continue;
    }
    out.cards.push(card);
  }
  out.cards.sort(compareCards);
  out.laterArrivals.sort(compareCards);
  out.later.sort(compareCards);
  out.handedOff.sort(compareCards);
  return out;
}

export function deckMinutes(cards: readonly DeckCard[]): number {
  return cards.reduce((sum, c) => sum + (c.tag.kind === "yes" ? c.tag.minutes : 1), 0);
}

export type DeckPosition = { index: number; position: number; total: number; prevId: string | null; nextId: string | null; card: DeckCard };

/** Where `?at=<id>` sits in the deck; an unknown or missing id is the first card. Null for an empty deck. */
export function positionOf(cards: readonly DeckCard[], atId: string | null | undefined): DeckPosition | null {
  if (cards.length === 0) return null;
  const found = atId ? cards.findIndex((c) => c.item.id === atId) : -1;
  const index = found >= 0 ? found : 0;
  return {
    index,
    position: index + 1,
    total: cards.length,
    prevId: index > 0 ? cards[index - 1].item.id : null,
    nextId: index < cards.length - 1 ? cards[index + 1].item.id : null,
    card: cards[index],
  };
}

/** A queue item id as it may appear in `?at=`: the queue's own ids, nothing that could carry a path or query. */
export function parseAtParam(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && /^[A-Za-z0-9_-]{1,128}$/.test(v) ? v : null;
}

export type DeckView = "cards" | "list" | "board";
export function parseDeckView(raw: string | string[] | undefined): DeckView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v === "list" || v === "board" ? v : "cards";
}

/** Decided today by this person: resolved items whose `resolved_by` is their session address and whose day is today. */
export function decidedToday(items: readonly QueueItem[], email: string | null, isToday: (at: Date) => boolean): QueueItem[] {
  if (!email) return [];
  const me = email.trim().toLowerCase();
  return items
    .filter((i) => i.status !== "pending" && (i.resolved_by ?? "").trim().toLowerCase() === me && i.resolved_at && isToday(new Date(i.resolved_at)))
    .sort((a, b) => (b.resolved_at ?? "").localeCompare(a.resolved_at ?? ""));
}

export const DECK_BASE = "/dashboard/queue/deck/";

/** A deck address. Only these three keys ever appear; the id is the queue's own (checked by `parseAtParam`). */
export function deckHref(args: { view?: DeckView; at?: string | null; dealNow?: boolean }): string {
  const q = new URLSearchParams();
  if (args.view && args.view !== "cards") q.set("view", args.view);
  if (args.at) q.set("at", args.at);
  if (args.dealNow) q.set("deal", "now");
  const s = q.toString();
  return s ? `${DECK_BASE}?${s}` : DECK_BASE;
}

/** The first lines of the draft, as plain text, for the card. */
export function draftOpening(item: Pick<QueueItem, "draft_body" | "final_body">, max = 220): string {
  const text = (item.final_body ?? item.draft_body ?? "")
    .replace(/[#*_`>|]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export type DeckEmpty =
  | { kind: "unreached" }
  | { kind: "all-decided"; headline: string; details: [] }
  /** Cards exist for this viewer but not on the table: arriving at the next deal, back from Later, or handed to colleagues. */
  | { kind: "waiting"; headline: string; details: string[] }
  | { kind: "nothing-for-you"; headline: string; details: [] };

/**
 * What an empty card pile means. "All decided" only when the queue was reached and nothing is waiting for this person in
 * any form; otherwise the counts say where the cards are. Pure; the page draws it.
 */
/**
 * `othersPending`: pending items the queue holds that are not on this person's deck in any form (someone else's to
 * decide). "All decided" is said only when that is 0 too: nothing is waiting for anyone.
 */
export function deckEmptyState(args: { queueOk: boolean; role: Role; deck: Pick<Deck, "laterArrivals" | "later" | "handedOff">; nextDealLabel: string; othersPending?: number; /** When the earliest Later card comes back ("tomorrow at 7:00 AM"); else the next deal. */ laterBackLabel?: string }): DeckEmpty {
  if (!args.queueOk) return { kind: "unreached" };
  const { laterArrivals, later, handedOff } = args.deck;
  const details: string[] = [];
  if (laterArrivals.length > 0) details.push(`${deckLaterArrivals(laterArrivals.length, args.nextDealLabel)}.`);
  if (later.length > 0) details.push(args.laterBackLabel ? deckLaterBackWhen(later.length, args.laterBackLabel) : deckLaterBack(later.length, args.nextDealLabel));
  if (handedOff.length > 0) details.push(deckHandedCount(handedOff.length));
  if (details.length > 0) return { kind: "waiting", headline: DECK_NOTHING_NOW, details };
  if (!QUEUE_EDIT_ROLES.includes(args.role) || !QUEUE_APPROVE_ROLES.includes(args.role)) return { kind: "nothing-for-you", headline: DECK_NOTHING_FOR_YOU, details: [] };
  const others = args.othersPending ?? 0;
  if (others > 0) return { kind: "waiting", headline: DECK_NOTHING_NOW, details: [deckOthersWaiting(others)] };
  return { kind: "all-decided", headline: deckAllDecided(args.nextDealLabel), details: [] };
}
