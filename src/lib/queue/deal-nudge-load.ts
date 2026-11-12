import "server-only";
import type { Role } from "@/lib/auth/roles";
import { dealNudge, NO_NUDGE, type DealNudge } from "@/lib/deal/nudge";
import type { QueueLoad } from "@/lib/queue/load";
import { viewerDeck } from "@/lib/queue/deck-summary";

/**
 * The owner shell's deal-ready nudge, derived at render time from the queue the layout already loaded (no second queue
 * read) and the viewer's own deal times. Only the owner shell calls this; the technician shell never does. Never throws:
 * a failure is no nudge, never a number.
 */
export async function loadDealNudge(load: QueueLoad, viewer: { userId: string; role: Role }, times: readonly string[]): Promise<DealNudge> {
  try {
    if (load.status !== "ok") return NO_NUDGE;
    const { deck, now, tz } = await viewerDeck(load.items, viewer, times);
    return dealNudge({ now, timeZone: tz, times, read: { status: "ok", undecided: deck.cards.length } });
  } catch {
    return NO_NUDGE;
  }
}
