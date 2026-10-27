// Plain module (NOT "use server"): a "use server" file may only export async
// functions, so the shared state shape and error mapping live here.

import { ProposalError } from "@/lib/proposals/errors";
import type { ValidationIssue } from "@/lib/proposals/validate";

export type ActionState = {
  error?: string;
  saved?: boolean;
  notice?: string;
  /** Firm-rule problems the store listed when it refused (approval). */
  issues?: ValidationIssue[];
  /** The approval-queue item "Create post-consult email" made, so the page can link to it. */
  queueId?: string;
};

export const NOT_ALLOWED: ActionState = {
  error: "Your role can view proposals but not change them.",
};

/**
 * A thrown failure -> something safe to show. The data layer's own refusals
 * (`ProposalError`) are sentences written to be read, and carry the list of
 * problems when approval was refused; anything else (an unexpected throw) never
 * passes its message through.
 */
export function proposalActionError(err: unknown, fallback: string): ActionState {
  if (err instanceof ProposalError) return { error: err.message, ...(err.issues.length > 0 ? { issues: err.issues } : {}) };
  return { error: fallback };
}
