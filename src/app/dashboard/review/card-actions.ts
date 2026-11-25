"use server";

import { previewSafe } from "@/lib/views/preview-safe";
import { redirect } from "next/navigation";
import { assignRecordAction, completeNextStepAction, logWhatHappenedAction, snoozeNextStepAction, updateNextStepAction, type ReviewActionState } from "./actions";
import { noticeCodeFor } from "@/lib/review/notice";
import { parseReviewParams, reviewHref } from "@/lib/review/params";

/**
 * The Cards view's buttons are plain forms, so they work without JavaScript: each runs the SAME action the opened record card
 * uses (role, record and member checks all happen there), then redirects back to the deck at the same place. The
 * return address is rebuilt from the posted view fields through `parseReviewParams`, never taken as a URL from the form.
 */
function backTo(fd: FormData, code: string | null): string {
  const field = (k: string) => String(fd.get(k) ?? "");
  const params = parseReviewParams({ who: field("vwho"), kind: field("vkind"), q: field("vq"), since: field("vsince"), person: field("vperson"), i: field("vi"), view: "cards" });
  const href = reviewHref(params);
  return code ? `${href}${href.includes("?") ? "&" : "?"}notice=${code}` : href;
}

function finish(fd: FormData, res: ReviewActionState): never {
  redirect(backTo(fd, noticeCodeFor(res.error)));
}

export const deckDoneAction = previewSafe(async function deckDoneAction(fd: FormData): Promise<void> {
  finish(fd, await completeNextStepAction({}, fd));
}, "redirect");

export const deckSnoozeAction = previewSafe(async function deckSnoozeAction(fd: FormData): Promise<void> {
  finish(fd, await snoozeNextStepAction({}, fd));
}, "redirect");

/** With a next step the step is handed over; without one the record itself is. */
export const deckHandToAction = previewSafe(async function deckHandToAction(fd: FormData): Promise<void> {
  if (String(fd.get("taskId") ?? "")) {
    const step = new FormData();
    step.set("taskId", String(fd.get("taskId")));
    step.set("assigneeId", String(fd.get("assigneeId") ?? ""));
    finish(fd, await updateNextStepAction({}, step));
  }
  const rec = new FormData();
  rec.set("kind", String(fd.get("kind") ?? ""));
  rec.set("id", String(fd.get("id") ?? ""));
  rec.set("userId", String(fd.get("assigneeId") ?? ""));
  finish(fd, await assignRecordAction({}, rec));
}, "redirect");

export const deckNoteAction = previewSafe(async function deckNoteAction(fd: FormData): Promise<void> {
  finish(fd, await logWhatHappenedAction({}, fd));
}, "redirect");
