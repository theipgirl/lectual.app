"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { resolveQueueItem } from "@/lib/queue/api";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { QUEUE_EDIT_ROLES } from "@/lib/queue/roles";
import { ROUTING_ADMIN_ROLES } from "@/lib/queue/routing";
import { requireFirmReviewer, ReviewerRefusal, runQueueReview } from "@/lib/queue/review-core";
import { loadApprovalRouting } from "@/lib/queue/routing-load";
import { loadActiveQueue } from "@/lib/queue/load";
import { dismissStale, dismissableFollowups, type DismissResult } from "@/lib/queue/dismiss";
import type { Role } from "@/lib/auth/roles";
import { cardIdOf, cardNoteOf, sendCardBack } from "@/lib/queue/card-moves";
import { sendBackNoteTooLong } from "@/lib/queue/handed";
import { isDoneNote } from "@/lib/queue/done";
import { clearOpenClaim, makeDraftInMyOutlook, retryPassToDrafter } from "@/lib/queue/make-draft";
import { DECK_FAILED, REJECT_NOTE_IS_DONE_MARKER, SEND_BACK_NOTE_TOO_LONG } from "@/lib/ui/words";

export type ReviewState = { error?: string };

/**
 * Approve / save / reject one queue item from the full approval page. A thin wrapper: every check lives in
 * `runQueueReview` (src/lib/queue/review-core.ts), which the approval deck calls too. Here the result becomes the
 * page's revalidate + redirect, exactly as before the split.
 */
export async function reviewQueueAction(_prev: ReviewState, formData: FormData): Promise<ReviewState> {
  const id = String(formData.get("id") ?? "");
  const intent = String(formData.get("intent") ?? "");
  const body = formData.get("body");
  // A person's own reject note may not be the Done marker (doneCardAction is the only thing that writes it).
  if (intent === "reject" && isDoneNote(String(formData.get("note") ?? ""))) return { error: REJECT_NOTE_IS_DONE_MARKER };
  const outcome = await runQueueReview({
    id,
    intent,
    body: typeof body === "string" ? body : null,
    note: String(formData.get("note") ?? ""),
    confirmStale: formData.get("confirm_stale") === "yes",
  });
  if (outcome.kind === "error") return { error: outcome.error };
  if (outcome.kind === "saved") {
    revalidatePath(`/dashboard/queue/${id}/`);
    return {};
  }

  revalidatePath("/dashboard/queue/");
  revalidatePath(`/dashboard/queue/${id}/`);
  const sendParam = outcome.send ? `&send=${encodeURIComponent(outcome.send)}` : "";
  // Sprint 4: before lectual 0112 the email went to the approver's own mailbox instead of the drafter; the page says so.
  const passParam = outcome.kind === "resolved" && outcome.handoff?.status === "not-switched-on" ? "&pass=off" : outcome.handoff?.status === "queue-drafted" ? "&pass=queue" : "";
  redirect(`/dashboard/queue/${id}/?resolved=${outcome.intent}${sendParam}${passParam}`);
}

export type DismissState = { message?: string; error?: string };

/**
 * "Dismiss follow-ups older than 7 days": rejects the stale stalled-lead follow-ups the caller owns (any, for the
 * admin tier). The form posts a confirm flag and nothing else; the list is re-read and the eligible set chosen here.
 */
export async function dismissStaleFollowupsAction(_prev: DismissState, formData: FormData): Promise<DismissState> {
  if (formData.get("confirm") !== "yes") return { error: "Confirm first, then try again." };
  const qKey = await activeQueueOrgKey();
  if (!qKey) return { error: "No approval queue is configured for this firm." };

  let reviewer: { email: string; userId: string; role: Role };
  try {
    reviewer = await requireFirmReviewer(QUEUE_EDIT_ROLES, "dismiss");
  } catch (err) {
    return { error: err instanceof ReviewerRefusal ? err.message : "You must be signed in." };
  }

  const load = await loadActiveQueue("pending");
  if (load.status !== "ok") return { error: "The approval queue can't be reached right now, so nothing was dismissed. Refresh to try again." };
  const routed = await loadApprovalRouting();
  const routing = routed.status === "ok" ? routed.routing : {};
  const viewer = { userId: reviewer.userId, role: reviewer.role };

  // Stale follow-ups exist but none are this caller's: say so rather than "Nothing to dismiss."
  if (!ROUTING_ADMIN_ROLES.includes(reviewer.role)) {
    const now = Date.now();
    const exist = dismissableFollowups(load.items, { routing, viewer: { ...viewer, role: "owner" }, now });
    const mine = dismissableFollowups(load.items, { routing, viewer, now });
    if (exist.length > 0 && mine.length === 0) return { error: "These follow-ups are for someone else. Ask them, or an owner or admin." };
  }

  const result = await dismissStale({
    items: load.items,
    routing,
    viewer,
    now: Date.now(),
    reject: async (itemId, note) => {
      await resolveQueueItem({ orgKey: qKey, id: itemId, action: "reject", resolvedBy: reviewer.email, note });
    },
  });
  revalidatePath("/dashboard/queue/");
  return dismissMessage(result);
}

function dismissMessage(r: DismissResult): DismissState {
  const rest = r.remaining > 0 ? ` ${r.remaining} more are left. Run it again to clear them.` : "";
  if (r.attempted === 0) return { message: "Nothing to dismiss." };
  if (r.failed > 0) return { error: `Dismissed ${r.done}, ${r.failed} couldn't be dismissed. Refresh to try again.${rest}` };
  return { message: `Dismissed ${r.done} ${r.done === 1 ? "follow-up" : "follow-ups"}.${rest}` };
}

export type SendBackState = { error?: string };

/**
 * "Send back to <name>" on the approval page, for the colleague a card was handed to. The same core as the deck's Send
 * back (`sendCardBack`): role and user re-resolved from the session, the item re-read (must be pending), the card events
 * re-read, refused unless the caller is the CURRENT hand-off target. It records a `returned` event and tells the person who
 * handed it (bell only). It never changes who may approve and sends nothing. The form posts the id and an optional note only.
 */
export async function sendBackAction(_prev: SendBackState, formData: FormData): Promise<SendBackState> {
  const id = cardIdOf(formData.get("id"));
  if (!id) return { error: DECK_FAILED };
  const rawNote = formData.get("note");
  if (sendBackNoteTooLong(rawNote)) return { error: SEND_BACK_NOTE_TOO_LONG };
  const sent = await sendCardBack({ id, note: cardNoteOf(rawNote), allowHander: false });
  if (!sent.ok) return { error: sent.error };
  revalidatePath("/dashboard/queue/");
  revalidatePath("/dashboard/queue/deck/");
  revalidatePath(`/dashboard/queue/${id}/`);
  redirect(`/dashboard/queue/${id}/?returned=1`);
}

export type MakeDraftState = { error?: string; message?: string; webLink?: string | null };

/**
 * "Make the draft in my Outlook" (Sprint 4). The form posts the item id; a posted `connection_id`, if any, is only ever
 * compared with the caller's own connection (`makeDraftInMyOutlook`), never used. Every check is in the core.
 */
export async function makeDraftAction(_prev: MakeDraftState, formData: FormData): Promise<MakeDraftState> {
  const id = cardIdOf(formData.get("id"));
  if (!id) return { error: DECK_FAILED };
  const made = await makeDraftInMyOutlook({ id, postedConnectionId: formData.get("connection_id") ?? undefined });
  if (!made.ok) return { error: made.error };
  revalidatePath("/dashboard/queue/");
  revalidatePath(`/dashboard/queue/${id}/`);
  return { message: made.message, webLink: made.webLink };
}

/** "Pass to <drafter>" (S3): the approver passes an approved email on again after a pass that didn't go through. */
export async function retryPassAction(_prev: MakeDraftState, formData: FormData): Promise<MakeDraftState> {
  const id = cardIdOf(formData.get("id"));
  if (!id) return { error: DECK_FAILED };
  const passed = await retryPassToDrafter({ id });
  if (!passed.ok) return { error: passed.error };
  revalidatePath("/dashboard/queue/");
  revalidatePath(`/dashboard/queue/${id}/`);
  return { message: passed.message };
}

/** "It isn't in my Drafts, try again": the drafter clears an open claim (the item id only; every check is in the core). */
export async function clearClaimAction(_prev: MakeDraftState, formData: FormData): Promise<MakeDraftState> {
  const id = cardIdOf(formData.get("id"));
  if (!id) return { error: DECK_FAILED };
  const cleared = await clearOpenClaim({ id });
  if (!cleared.ok) return { error: cleared.error };
  revalidatePath("/dashboard/queue/");
  revalidatePath(`/dashboard/queue/${id}/`);
  return { message: cleared.message };
}
