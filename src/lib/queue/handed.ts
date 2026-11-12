import type { Role } from "@/lib/auth/roles";
import type { QueueItem } from "@/lib/queue/api";
import { currentHolder, trustedEvents, type CardState, type EventTrust, type Holder } from "@/lib/queue/deck";
import { isAttorneyOnly, memberName, ownerOf, type ApprovalRouting, type RoutableItem, type RoutingMember } from "@/lib/queue/routing";
import { QUEUE_EDIT_ROLES } from "@/lib/queue/roles";
import { A_TEAMMATE, SEND_BACK_NEEDS_APPROVER, sendBackNeedsPerson } from "@/lib/ui/words";

/**
 * Hand-offs as the technician shell shows them. Pure. A hand-off only changes whose deck shows a card: nothing here
 * widens who may approve (that stays `canApproveItem`, run again by the server on every action).
 */

export const SEND_BACK_NOTE_MAX = 500;

/** The items currently handed to `viewerId`, with the hand-off. Empty unless the card events were READ. */
export function handedToViewer(items: readonly (RoutableItem & { id: string })[], state: CardState, viewerId: string | null | undefined, trust: EventTrust): Map<string, Holder> {
  const out = new Map<string, Holder>();
  if (!viewerId || state.status !== "ok") return out;
  const events = trustedEvents(state.events, items, trust);
  for (const item of items) {
    const holder = currentHolder(events, item.id);
    if (holder && holder.userId === viewerId) out.set(item.id, holder);
  }
  return out;
}

/**
 * Is the "Handed to you" pill (and the row markers) drawn? Only when the events were read AND at least one item is
 * handed to the viewer. A failed or missing read draws nothing: it is additive information, never "none handed".
 */
export const showHandedPill = (handed: ReadonlyMap<string, Holder>): boolean => handed.size > 0;

/** The one-line "can't approve" sentence for a card handed to someone who may not approve it; null when they may. */
export function handedCantApprove(args: { canApprove: boolean; item: RoutableItem; routing: ApprovalRouting; members: readonly RoutingMember[] }): string | null {
  if (args.canApprove) return null;
  const owner = ownerOf(args.item, args.routing);
  if (owner.kind === "person" && !isAttorneyOnly(args.item)) {
    const who = args.members.find((m) => m.userId === owner.userId);
    return sendBackNeedsPerson(who ? memberName(who) : A_TEAMMATE);
  }
  return SEND_BACK_NEEDS_APPROVER;
}

export type ReturnRefusal = "not-yours" | "not-set-up" | "failed";

/**
 * May this caller send the card back? Pure decision over what the action re-read: the caller's role, the item's
 * status, the card events and the item's id. `allowHander` lets the person who handed it recall it (the deck's
 * existing behaviour); the item page passes false: only the current holder.
 */
export function returnDecision(args: {
  callerId: string;
  callerRole: Role;
  itemStatus: string | null;
  cardState: CardState;
  itemId: string;
  allowHander: boolean;
}): { ok: true; holder: Holder } | { ok: false; reason: ReturnRefusal } {
  if (!QUEUE_EDIT_ROLES.includes(args.callerRole)) return { ok: false, reason: "not-yours" };
  if (args.itemStatus !== "pending") return { ok: false, reason: "not-yours" };
  if (args.cardState.status === "not-set-up") return { ok: false, reason: "not-set-up" };
  if (args.cardState.status !== "ok") return { ok: false, reason: "failed" };
  const holder = currentHolder(args.cardState.events, args.itemId);
  if (!holder) return { ok: false, reason: "not-yours" };
  if (holder.userId === args.callerId) return { ok: true, holder };
  if (args.allowHander && holder.by === args.callerId) return { ok: true, holder };
  return { ok: false, reason: "not-yours" };
}

/* Bell payloads: ids and a headline only, never the draft body, the note, the recipient or the subject. */

const HEADLINE_MAX = 120;
const clip = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > HEADLINE_MAX ? `${t.slice(0, HEADLINE_MAX - 1).trimEnd()}…` : t;
};

export type CardNoticePayload = { source: "card_handoff" | "card_returned"; queue_id: string; headline: string };

export const cardNoticePayload = (source: CardNoticePayload["source"], item: Pick<QueueItem, "id" | "headline">): CardNoticePayload => ({
  source,
  queue_id: item.id,
  headline: clip(item.headline ?? ""),
});
