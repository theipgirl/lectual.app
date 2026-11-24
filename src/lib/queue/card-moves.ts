import "server-only";
import { resolveFirmSession } from "@/lib/firm/session";
import { getQueueItem, type QueueItem } from "@/lib/queue/api";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { QUEUE_EDIT_ROLES } from "@/lib/queue/roles";
import { canApproveItem } from "@/lib/queue/routing";
import { loadApprovalRouting } from "@/lib/queue/routing-load";
import { loadCardState, recordCardEvent } from "@/lib/queue/card-state";
import { currentHolder, eventTrust, trustedCardState } from "@/lib/queue/deck";
import { cardNoticePayload, returnDecision, SEND_BACK_NOTE_MAX } from "@/lib/queue/handed";
import { notify } from "@/lib/notifications/core";
import { NOTIFICATION_KIND_FOR } from "@/lib/notifications/kinds";
import type { Role } from "@/lib/auth/roles";
import { DECK_FAILED, DECK_NOT_YOURS, DECK_PREVIEW_ONLY, NOT_SWITCHED_ON } from "@/lib/ui/words";

/**
 * The card moves the approval deck and the technician approval page SHARE: who is calling, the item, the card events,
 * and the one Send back. Both surfaces call the same functions, so the rule (who may send a card back) cannot drift.
 * Nothing here changes who may approve, and nothing here sends.
 */

export type CardCaller = { userId: string; role: Role; email: string | null; orgId: string };

export async function cardCaller(): Promise<CardCaller | null> {
  const session = await resolveFirmSession().catch(() => null);
  if (!session || session.kind !== "ok") return null;
  if (!QUEUE_EDIT_ROLES.includes(session.role)) return null;
  return { userId: session.user.id, role: session.role, email: session.user.email ?? null, orgId: session.org.id };
}

/** A fixed sentence when the caller is Lectual staff standing inside a firm (no membership row: the fold would drop their hand-offs and returns), else null. */
export async function staffPreviewRefusal(): Promise<string | null> {
  const session = await resolveFirmSession().catch(() => null);
  return session && session.kind === "ok" && session.actingAsStaff ? DECK_PREVIEW_ONLY : null;
}

export function cardIdOf(raw: unknown): string | null {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(raw) ? raw : null;
}

export function cardNoteOf(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim().slice(0, SEND_BACK_NOTE_MAX) : "";
}

export async function readCardItem(id: string): Promise<QueueItem | null> {
  const key = await activeQueueOrgKey();
  if (!key) return null;
  try {
    return await getQueueItem(key, id);
  } catch {
    return null;
  }
}

/** Who may move a card (hand off, later): the person whose yes it is, or the colleague it is handed to. Re-read every call. */
export async function cardContext(id: string): Promise<
  | { ok: true; who: CardCaller; item: QueueItem; mayDecide: boolean; holder: ReturnType<typeof currentHolder> }
  | { ok: false; error: string }
> {
  const who = await cardCaller();
  if (!who) return { ok: false, error: DECK_NOT_YOURS };
  const item = await readCardItem(id);
  if (!item) return { ok: false, error: DECK_FAILED };
  if (item.status !== "pending") return { ok: false, error: DECK_NOT_YOURS };
  const state = await loadCardState([id]);
  if (state.status === "not-set-up") return { ok: false, error: NOT_SWITCHED_ON };
  if (state.status !== "ok") return { ok: false, error: DECK_FAILED };
  const routed = await loadApprovalRouting();
  const routing = routed.status === "ok" ? routed.routing : {};
  // A forged hand-off or return (any staff member can insert one) never makes anyone the holder.
  const trusted = trustedCardState(state, [item], eventTrust(routed));
  return {
    ok: true,
    who,
    item,
    mayDecide: canApproveItem({ role: who.role, userId: who.userId, item, routing }),
    holder: trusted.status === "ok" ? currentHolder(trusted.events, id) : null,
  };
}

/**
 * Send a handed-off card back: re-resolves the caller, re-reads the item (must be pending) and the card events through
 * the scoped client, refuses unless the caller holds it (`allowHander`: the deck also lets whoever handed it recall it),
 * records a `returned` event and tells the person who handed it (bell only). Fixed sentences only.
 */
export async function sendCardBack(args: { id: string; note: string; allowHander: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  const preview = await staffPreviewRefusal();
  if (preview) return { ok: false, error: preview };
  const who = await cardCaller();
  if (!who) return { ok: false, error: DECK_NOT_YOURS };
  const item = await readCardItem(args.id);
  if (!item) return { ok: false, error: DECK_FAILED };
  const [loaded, routed] = await Promise.all([loadCardState([args.id]), loadApprovalRouting()]);
  // The holder comes from the trusted events only: a forged hand-off can't make the caller the holder or the hander.
  const state = trustedCardState(loaded, [item], eventTrust(routed));
  const decision = returnDecision({ callerId: who.userId, callerRole: who.role, itemStatus: item.status, cardState: state, itemId: args.id, allowHander: args.allowHander });
  if (!decision.ok) return { ok: false, error: decision.reason === "not-set-up" ? NOT_SWITCHED_ON : decision.reason === "failed" ? DECK_FAILED : DECK_NOT_YOURS };
  const saved = await recordCardEvent({ orgId: who.orgId, queueItemId: args.id, kind: "returned", note: args.note || null });
  if (!saved.ok) return { ok: false, error: saved.reason === "not-set-up" ? NOT_SWITCHED_ON : DECK_FAILED };
  // The original hander learns it is back. notify() never throws, checks membership and skips a self-notice.
  await notify({ userId: decision.holder.by, kind: NOTIFICATION_KIND_FOR.approval_needed, actorId: who.userId, payload: cardNoticePayload("card_returned", item) });
  return { ok: true };
}

/** After a hand-off is recorded: tell the person it was handed to. Bell only, never throws. */
export async function noticeHandedTo(args: { target: string; actorId: string; item: QueueItem }): Promise<void> {
  await notify({ userId: args.target, kind: NOTIFICATION_KIND_FOR.approval_needed, actorId: args.actorId, payload: cardNoticePayload("card_handoff", args.item) });
}
