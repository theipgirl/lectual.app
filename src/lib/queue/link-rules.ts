/**
 * The pieces of "which lead does this queue item belong to" that the
 * approval-time stale check (stale.ts, one item) and the pending-approvals
 * loader (lead-pending.ts, every pending item in one pass) must agree on.
 * The resolution ORDER and the queries are each caller's own; what is shared
 * here is only what has to be identical for the two to name the same lead.
 */

/** Queue ids are the queue service's own; anything outside this shape is never put in a filter string. */
export const QUEUE_ID = /^[A-Za-z0-9_-]{1,100}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `queue_drafted` payload keys a drafter may have written the queue id
 * under: campaigns and prep-consult use `queueItemId`, post-consult and
 * meeting follow-ups use `queue_id`. Tried in this order.
 */
export const DRAFT_PAYLOAD_KEYS = ["queueItemId", "queue_id"] as const;

/** A recipient address is matched exactly, as written or lower-cased, and names at most this many lead rows. */
export const MAX_RECIPIENT_LEADS = 5;

/** The exact addresses a recipient is looked up by; null when it is not an address. */
export function recipientAddresses(recipient: string | null | undefined): string[] | null {
  const trimmed = recipient?.trim();
  if (!trimmed || !trimmed.includes("@")) return null;
  return [...new Set([trimmed, trimmed.toLowerCase()])];
}
