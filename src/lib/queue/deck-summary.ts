import "server-only";
import type { Role } from "@/lib/auth/roles";
import { dealFor, dealtAt } from "@/lib/deal/times";
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

export async function loadDeckSummary(viewer: { userId: string; role: Role }): Promise<DeckSummary> {
  try {
    const load = await loadActiveQueue("pending");
    if (load.status === "unconfigured") return { status: "unconfigured" };
    if (load.status !== "ok") return { status: "unavailable" };
    const [routed, tz, cardState] = await Promise.all([loadApprovalRouting(), getFirmTimeZone(), loadCardState(load.items.map((i) => i.id))]);
    const now = new Date();
    const deal = dealFor(now, tz);
    const deck = buildDeck({
      items: load.items,
      routing: routed.status === "ok" ? routed.routing : {},
      viewer,
      cardState,
      now,
      dealtAt: dealtAt(now, tz),
    });
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
