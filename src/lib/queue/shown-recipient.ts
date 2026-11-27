import type { QueueItem } from "./api";
import { INTERNAL_BRIEFING_TO } from "@/lib/ui/words";

/**
 * The "To" Approvals shows for an item (the list, the deck card, the item page). An internal BRIEFING never shows its
 * recipient: the prep-consult skill sets it to the client's address only so the briefing links to the lead, and a briefing
 * is never drafted or sent, so "To <client>" would suggest a client email is waiting. It reads INTERNAL_BRIEFING_TO instead.
 */
export function shownRecipient(item: Pick<QueueItem, "type" | "recipient">): string | null {
  if (item.type === "BRIEFING") return INTERNAL_BRIEFING_TO;
  const to = item.recipient?.trim();
  return to ? to : null;
}

/** The deck card's "To <address>." line: nothing at all for an internal briefing. */
export function cardRecipient(item: Pick<QueueItem, "type" | "recipient">): string | null {
  return item.type === "BRIEFING" ? null : shownRecipient(item);
}
