"use server";

import { revalidatePath } from "next/cache";
import { isRetryableStep } from "@/lib/proposals/paid";
import { markProposalPaid, retryProposalStep, undoProposalPaid, type FlowResult } from "@/lib/proposals/paid-flow";
import { reportText } from "@/lib/proposals/paid-view";
import { MARK_PAID_WORDS } from "@/lib/proposals/step-text";
import type { ActionState } from "../errors";
import { gatePaidAction } from "../gate";

/**
 * Mark paid, Undo, and Retry on an accepted proposal (Sprint 19). Every function is its own
 * POST entry point, so each calls `gatePaidAction()` FIRST (the proposals module with
 * notFound(), then owner / admin / senior_admin / intake). The flow re-reads the proposal
 * through the caller's scoped client, so another firm's id is "Proposal not found.".
 */

function field(form: FormData, key: string): string {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
}

function revalidate(id: string): void {
  revalidatePath(`/dashboard/proposals/${id}/`);
  revalidatePath("/dashboard/proposals/");
}

/** The flow's result as the sentence the person reads: a headline, then one clause per step that ran. */
function stateOf(result: FlowResult, headline: string | null): ActionState {
  if (!result.ok) return { error: result.error };
  const parts = [headline, ...result.reports.map(reportText), ...result.notes].filter((p): p is string => !!p);
  return { saved: true, notice: parts.join(" ") };
}

async function run(formData: FormData, flow: (id: string) => Promise<FlowResult>, headline: string | null, fallback: string): Promise<ActionState> {
  const refused = await gatePaidAction();
  if (refused) return refused;
  const id = field(formData, "proposalId");
  let result: FlowResult;
  try {
    result = await flow(id);
  } catch {
    return { error: fallback };
  }
  revalidate(id);
  return stateOf(result, headline);
}

export async function markPaidAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const refused = await gatePaidAction();
  if (refused) return refused;
  const id = field(formData, "proposalId");
  let result: FlowResult;
  try {
    result = await markProposalPaid(id);
  } catch {
    return { error: "Couldn't mark this proposal paid." };
  }
  revalidate(id);
  // An already-paid click says so and nothing else; a fresh mark leads with "Marked paid.".
  return stateOf(result, result.ok && result.alreadyPaid ? null : MARK_PAID_WORDS.markedNotice);
}

export async function undoPaidAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, undoProposalPaid, MARK_PAID_WORDS.undoneHeadline, "Couldn't undo the paid mark.");
}

/** Runs one failed or blocked step again (`step` names it). */
export async function retryUploadAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const refused = await gatePaidAction();
  if (refused) return refused;
  const id = field(formData, "proposalId");
  const step = field(formData, "step");
  if (!isRetryableStep(step)) return { error: "That step can't be run again." };
  let result: FlowResult;
  try {
    result = await retryProposalStep(id, step);
  } catch {
    return { error: "Couldn't run that step again." };
  }
  revalidate(id);
  return stateOf(result, null);
}
