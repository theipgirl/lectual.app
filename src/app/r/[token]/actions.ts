"use server";

import { completePublicRequest, readPublicRequest } from "@/lib/intake-forms/public";
import { validateAnswers } from "@/lib/intake-forms/public-submit";

/**
 * The client's submit on `/r/<token>`: its own unauthenticated POST entry
 * point, so it re-reads the request by token (status 'sent' only) and trusts
 * nothing else. The answers are matched against the firm's stored questions;
 * the write is fenced on the request's own id and org (public.ts).
 */
export type SubmitRequestResult = { ok: true } | { ok: false; error: string; fields?: string[] };

export async function submitIntakeRequestAction(token: string, answers: unknown): Promise<SubmitRequestResult> {
  if (typeof token !== "string") return { ok: false, error: "This link isn't available." };
  const read = await readPublicRequest(token);
  if (read.status === "not_found") return { ok: false, error: "This link is no longer taking answers. Ask the firm for a new one." };
  if (read.status !== "ok") return { ok: false, error: "We couldn't reach the firm just now. Nothing was sent. Please try again in a minute." };

  const checked = validateAnswers(answers, read.handle.questions);
  if (checked.errors.length) return { ok: false, error: checked.errors.join("\n"), fields: checked.fields };
  if (!checked.answers.length) return { ok: false, error: "Please answer at least one question." };

  const result = await completePublicRequest(read.handle, checked.answers, new Date());
  if (result === "gone") return { ok: false, error: "These answers were already sent, or the firm withdrew this link." };
  if (result === "failed") return { ok: false, error: "We couldn't send your answers just now. Please try again in a minute." };
  return { ok: true };
}
