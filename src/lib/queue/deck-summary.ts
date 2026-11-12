import "server-only";
import type { Role } from "@/lib/auth/roles";
import { DEFAULT_DEAL_TIMES, dealFor, dealtAt } from "@/lib/deal/times";
import type { QueueItem } from "@/lib/queue/api";
import { buildDeck, deckMinutes } from "@/lib/queue/deck";
import { loadCardState } from "@/lib/queue/card-state";
import { loadActiveQueue } from "@/lib/queue/load";
import { loadApprovalRouting } from "@/lib/queue/routing-load";
import { getFirmTimeZone } from "@/lib/org/profile";

/**
 * Today's "Your cards": how many approval cards are dealt to this person, about how long they take, and when the next
 * deal is. Built from the same `buildDeck` the deck page uses, so the two cannot disagree. Three states, never two: an
 * unreachable queue is `unavailable`, never 0. A routing read that fails applies the default rule (the usual
 * approvers), and card events that can't be read deal every card (never fewer).
 */
export type DeckSummary =
  | { status: "ok"; count: number; minutes: number; dealLabel: string | null; nextDealLabel: string; laterArrivals: number }
  | { status: "unconfigured" }
  | { status: "unavailable" };

/** The viewer's deck from an already-loaded queue: the one `buildDeck` call the Today tile and the deal-ready nudge share. */
export async function viewerDeck(items: readonly QueueItem[], viewer: { userId: string; role: Role }, dealTimes: readonly string[], at?: Date) {
  const [routed, tz, cardState] = await Promise.all([loadApprovalRouting(), getFirmTimeZone(), loadCardState(items.map((i) => i.id))]);
  const now = at ?? new Date();
  const deck = buildDeck({
    items: [...items],
    routing: routed.status === "ok" ? routed.routing : {},
    viewer,
    cardState,
    now,
    dealtAt: dealtAt(now, tz, dealTimes),
  });
  return { deck, now, tz };
}

export async function loadDeckSummary(viewer: { userId: string; role: Role }, dealTimes: readonly string[] = DEFAULT_DEAL_TIMES, at?: Date): Promise<DeckSummary> {
  try {
    const load = await loadActiveQueue("pending");
    if (load.status === "unconfigured") return { status: "unconfigured" };
    if (load.status !== "ok") return { status: "unavailable" };
    const { deck, now, tz } = await viewerDeck(load.items, viewer, dealTimes, at);
    const deal = dealFor(now, tz, dealTimes);
    return {
      status: "ok",
      count: deck.cards.length,
      minutes: deckMinutes(deck.cards),
      dealLabel: deal.current?.label ?? null,
      nextDealLabel: deal.next.label,
      laterArrivals: deck.laterArrivals.length,
    };
  } catch {
    return { status: "unavailable" };
  }
}
