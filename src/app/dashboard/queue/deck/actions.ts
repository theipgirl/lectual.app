"use server";

import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { orgHasModule } from "@/lib/org/modules";
import { QUEUE_EDIT_ROLES } from "@/lib/queue/roles";
import { classifyQueueItem } from "@/lib/queue/routing";
import { runQueueReview, type ReviewOutcome } from "@/lib/queue/review-core";
import { recordCardEvent } from "@/lib/queue/card-state";
import { cardCaller, cardContext, cardIdOf, cardNoteOf, noticeHandedTo, readCardItem, sendCardBack } from "@/lib/queue/card-moves";
import { listMemberDirectory } from "@/lib/members/directory";
import { getFirmTimeZone } from "@/lib/org/profile";
import { dealFor } from "@/lib/deal/times";
import { mySendAccess, sendFromMyOutlook } from "@/lib/mailbox/my-mailbox";
import {
  DECK_BAD_PERSON,
  DECK_FAILED,
  DECK_HANDED_OFF,
  DECK_LATER_DONE,
  DECK_MARKED_READ,
  DECK_NOT_YOURS,
  DECK_PICK_PERSON,
  DECK_REJECTED,
  DECK_REJECT_NOTE_NEEDED,
  DECK_SEND_OFF,
  DECK_SEND_RECONNECT,
  DECK_SENT_BACK,
  NOT_SWITCHED_ON,
  deckSentAt,
} from "@/lib/ui/words";

/**
 * The approval deck's moves. Every one, on every call:
 *  · fails closed behind `role-views` (`notFound()`, the same as the page);
 *  · re-resolves who is calling from the session (never from the browser: no user, org or role argument);
 *  · approve, mark read and reject go through `runQueueReview`, the same core as the full approval page, so the
 *    routing rule, the linked-proposal gate, the draft checks and the stale confirm all run again here.
 * Hand off, Later and Send back only change whose deck shows a card and when. They never change who may approve it.
 * Nothing here sends anything, except `sendDraftNowAction`, which a person presses herself after approving.
 */

export type DeckResult =
  | {
      ok: true;
      message: string;
      /** After an approve: where the draft is. */
      draft?: { provider: "google" | "microsoft" | null; webLink: string | null; draftId: string | null; canSend: boolean; sendNote: string | null } | null;
    }
  | { ok: false; error: string };

async function gate(): Promise<void> {
  if (!(await orgHasModule("role-views"))) notFound();
}

function revalidate(): void {
  revalidatePath("/dashboard/queue/");
  revalidatePath("/dashboard/queue/deck/");
}

function sendNoteFor(access: Awaited<ReturnType<typeof mySendAccess>>): string | null {
  if (access === "ready") return null;
  if (access === "needs-permission") return DECK_SEND_RECONNECT;
  return DECK_SEND_OFF;
}

async function approveResult(outcome: ReviewOutcome, message?: string): Promise<DeckResult> {
  if (outcome.kind === "error") return { ok: false, error: outcome.error };
  if (outcome.kind !== "resolved") return { ok: false, error: DECK_FAILED };
  revalidate();
  const drafted = outcome.send === "drafted" || outcome.send === "mailbox-microsoft" || outcome.send === "mailbox-google";
  if (!drafted) return { ok: true, message: message ?? approvedText(outcome.send), draft: null };
  const provider = outcome.provider ?? (outcome.send === "drafted" ? "microsoft" : null);
  // Send from here only for a draft this call put in the approver's OWN Outlook (we hold its id).
  const ownOutlook = outcome.provider === "microsoft" && !!outcome.draftId;
  const access = ownOutlook ? await mySendAccess() : "switched-off";
  return {
    ok: true,
    message: message ?? "",
    draft: { provider, webLink: outcome.webLink, draftId: outcome.draftId, canSend: ownOutlook && access === "ready", sendNote: ownOutlook ? sendNoteFor(access) : DECK_SEND_OFF },
  };
}

function approvedText(send: string | null): string {
  if (send === "manual") return "Approved. This type isn't emailed: file or deliver it the usual way.";
  if (send === "failed" || send === "mailbox-failed") return "Approved, but the draft couldn't be made, so nothing reached a mailbox. Open the approval to copy it.";
  if (send === "sent") return "Approved.";
  return "Approved. Nothing has gone out.";
}

/** Yes: the existing approve path, with a receipt of the approved text on the note. */
export async function approveCardAction(rawId: unknown): Promise<DeckResult> {
  await gate();
  const id = cardIdOf(rawId);
  if (!id) return { ok: false, error: DECK_FAILED };
  if (!(await cardCaller())) return { ok: false, error: "You don't have permission to approve or reject client communications." };
  return approveResult(await runQueueReview({ id, intent: "approve", withReceipt: true }));
}

/** Mark read: an internal briefing is approved (nothing goes to a client). Refused for anything else. */
export async function markReadCardAction(rawId: unknown): Promise<DeckResult> {
  await gate();
  const id = cardIdOf(rawId);
  if (!id) return { ok: false, error: DECK_FAILED };
  if (!(await cardCaller())) return { ok: false, error: "You don't have permission to approve or reject client communications." };
  const item = await readCardItem(id);
  if (!item) return { ok: false, error: DECK_FAILED };
  if (classifyQueueItem(item) !== "internal_briefing") return { ok: false, error: DECK_NOT_YOURS };
  return approveResult(await runQueueReview({ id, intent: "approve", withReceipt: true }), DECK_MARKED_READ);
}

export async function rejectCardAction(rawId: unknown, rawNote: unknown): Promise<DeckResult> {
  await gate();
  const id = cardIdOf(rawId);
  if (!id) return { ok: false, error: DECK_FAILED };
  const note = cardNoteOf(rawNote);
  if (!note) return { ok: false, error: DECK_REJECT_NOTE_NEEDED };
  if (!(await cardCaller())) return { ok: false, error: "You don't have permission to approve or reject client communications." };
  const outcome = await runQueueReview({ id, intent: "reject", note });
  if (outcome.kind === "error") return { ok: false, error: outcome.error };
  revalidate();
  return { ok: true, message: DECK_REJECTED };
}

export async function handOffCardAction(rawId: unknown, rawTarget: unknown, rawNote: unknown): Promise<DeckResult> {
  await gate();
  const id = cardIdOf(rawId);
  if (!id) return { ok: false, error: DECK_FAILED };
  const target = typeof rawTarget === "string" ? rawTarget.trim() : "";
  if (!target) return { ok: false, error: DECK_PICK_PERSON };
  const ctx = await cardContext(id);
  if (!ctx.ok) return ctx;
  const holdsIt = ctx.holder?.userId === ctx.who.userId;
  if (!ctx.mayDecide && !holdsIt) return { ok: false, error: DECK_NOT_YOURS };
  // The target is a current member who can prepare drafts, from the member directory; never the caller.
  let members: Awaited<ReturnType<typeof listMemberDirectory>>;
  try {
    members = await listMemberDirectory();
  } catch {
    return { ok: false, error: DECK_FAILED };
  }
  const person = members.find((m) => m.userId === target);
  if (!person || target === ctx.who.userId || !QUEUE_EDIT_ROLES.includes(person.role)) return { ok: false, error: DECK_BAD_PERSON };
  const saved = await recordCardEvent({ orgId: ctx.who.orgId, queueItemId: id, kind: "handoff", targetUserId: target, note: cardNoteOf(rawNote) || null });
  if (!saved.ok) return { ok: false, error: saved.reason === "not-set-up" ? NOT_SWITCHED_ON : DECK_FAILED };
  // The bell tells them it is on their cards (best-effort: notify never throws and a failed notice never undoes the hand-off).
  await noticeHandedTo({ target, actorId: ctx.who.userId, item: ctx.item });
  revalidate();
  return { ok: true, message: DECK_HANDED_OFF };
}

export async function laterCardAction(rawId: unknown): Promise<DeckResult> {
  await gate();
  const id = cardIdOf(rawId);
  if (!id) return { ok: false, error: DECK_FAILED };
  const ctx = await cardContext(id);
  if (!ctx.ok) return ctx;
  if (!ctx.mayDecide && ctx.holder?.userId !== ctx.who.userId) return { ok: false, error: DECK_NOT_YOURS };
  const until = dealFor(new Date(), await getFirmTimeZone()).next.at.toISOString();
  const saved = await recordCardEvent({ orgId: ctx.who.orgId, queueItemId: id, kind: "later", until });
  if (!saved.ok) return { ok: false, error: saved.reason === "not-set-up" ? NOT_SWITCHED_ON : DECK_FAILED };
  revalidate();
  return { ok: true, message: DECK_LATER_DONE };
}

/** Send back: the colleague holding a handed-off card returns it to the usual approvers. */
export async function returnCardAction(rawId: unknown, rawNote: unknown): Promise<DeckResult> {
  await gate();
  const id = cardIdOf(rawId);
  if (!id) return { ok: false, error: DECK_FAILED };
  // The same core the approval page's Send back uses; the deck also lets whoever handed the card recall it.
  const sent = await sendCardBack({ id, note: cardNoteOf(rawNote), allowHander: true });
  if (!sent.ok) return sent;
  revalidate();
  return { ok: true, message: DECK_SENT_BACK };
}

/**
 * "Send from Outlook now": pressed by the approver herself, after the approval. Checks, in order: the switch, the
 * caller, the item (approved, a client email, approved by THIS signed-in person), then the caller's own Outlook (the
 * send permission granted), and finally the draft itself (still a draft, addressed to the item's recipient).
 */
export async function sendDraftNowAction(rawId: unknown, rawDraftId: unknown): Promise<DeckResult> {
  await gate();
  const id = cardIdOf(rawId);
  const draftId = typeof rawDraftId === "string" ? rawDraftId : "";
  if (!id || !draftId) return { ok: false, error: DECK_FAILED };
  const who = await cardCaller();
  if (!who || !who.email) return { ok: false, error: DECK_NOT_YOURS };
  const item = await readCardItem(id);
  if (!item) return { ok: false, error: DECK_FAILED };
  const approvedByMe = item.status === "approved" && (item.resolved_by ?? "").trim().toLowerCase() === who.email.trim().toLowerCase();
  if (!approvedByMe || item.type !== "CLIENT_EMAIL" || !item.recipient) return { ok: false, error: DECK_NOT_YOURS };
  // The subject the approve path drafted with (core: item.subject ?? item.headline) and the approval time tie the draft to this item.
  const sent = await sendFromMyOutlook({ draftId, recipient: item.recipient, subject: item.subject ?? item.headline, approvedAt: item.resolved_at });
  if (!sent.ok) {
    if (sent.reason === "needs-permission" || sent.reason === "reauth") return { ok: false, error: DECK_SEND_RECONNECT };
    if (sent.reason === "switched-off" || sent.reason === "not-outlook" || sent.reason === "no-mailbox") return { ok: false, error: DECK_SEND_OFF };
    if (sent.reason === "not-a-draft" || sent.reason === "gone") return { ok: false, error: "That draft isn't in your Outlook Drafts any more, so nothing was sent from here." };
    if (sent.reason === "not-this-approval") return { ok: false, error: "That isn't the draft made for this approval, so nothing was sent. Check it in Outlook." };
    if (sent.reason === "wrong-recipient") return { ok: false, error: "That draft is no longer addressed to this client, so nothing was sent. Check it in Outlook." };
    return { ok: false, error: "Couldn't send from here, so nothing was sent. Open the draft in Outlook and press Send there." };
  }
  const time = new Intl.DateTimeFormat("en-US", { timeZone: await getFirmTimeZone(), hour: "numeric", minute: "2-digit" }).format(new Date());
  revalidate();
  return { ok: true, message: deckSentAt(time) };
}
