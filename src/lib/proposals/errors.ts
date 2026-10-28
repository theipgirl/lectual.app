/**
 * Proposal errors a person can read.
 *
 * Pure. The store throws `ProposalError` for every refusal it makes itself and
 * converts database errors with `friendlyProposalError`, so no raw Postgres or
 * PostgREST message (which names tables, constraints and trigger internals)
 * ever reaches a screen. Callers branch on `code`, never on message text.
 */

import type { ValidationIssue } from "./validate";

export type ProposalErrorCode =
  /** The content or a column failed a firm rule; `issues` says which. */
  | "validation"
  /** Wrong role, or not one of the firm's named approvers. */
  | "forbidden"
  | "not_found"
  /** The version is sent / accepted / superseded / withdrawn: change it by revising. */
  | "frozen"
  /** The row moved under the caller (status changed, another draft exists, version taken). */
  | "conflict"
  /** Anything else the database refused or could not do. */
  | "unavailable";

export class ProposalError extends Error {
  readonly code: ProposalErrorCode;
  readonly issues: ValidationIssue[];
  constructor(code: ProposalErrorCode, message: string, issues: ValidationIssue[] = []) {
    super(message);
    this.name = "ProposalError";
    this.code = code;
    this.issues = issues;
  }
}

type DbErrorLike = { code?: string; message?: string } | null | undefined;

/**
 * The lifecycle trigger's and `client_proposal_send`'s stable message prefixes
 * (lectual 0089), each with what a person should read instead. Matched FIRST:
 * several of these share a SQLSTATE (42501 for both "not an approver" and "only
 * the service role accepts", 23514 for every refused move), so the code alone
 * would collapse them into one generic sentence.
 */
const TRIGGER_MESSAGES: ReadonlyArray<readonly [prefix: string, code: ProposalErrorCode, message: string]> = [
  ["client_proposal_not_approver", "forbidden", "Only the firm's named approvers can create a client link."],
  ["client_proposal_accept_service_only", "forbidden", "Only the client can accept a proposal, from their own link."],
  // lectual 0100: the pay link of a live (sent) version is the one field that may change.
  ["client_proposal_pay_link_frozen", "frozen", "Only a proposal whose link is live can have its pay link changed, and only on its own."],
  ["client_proposal_pay_link_staff_only", "forbidden", "Only a signed-in staff member can change a live proposal's pay link."],
  ["client_proposal_pay_link_required", "validation", "Enter the pay link."],
  ["client_proposal_frozen", "frozen", "This version has already gone out and can't be changed. Start a new version instead."],
  ["client_proposal_immutable", "frozen", "This version has already gone out and can't be changed. Start a new version instead."],
  ["client_proposal_acceptance_final", "frozen", "The client's acceptance is a record and can't be changed."],
  [
    "client_proposal_edit_and_move",
    "conflict",
    "Save your changes and change the status in separate steps. Refresh and try again.",
  ],
  [
    "client_proposal_bad_transition",
    "conflict",
    "This proposal can't move to that status from where it is now. Refresh and check its status.",
  ],
  ["client_proposal_approval_incomplete", "validation", "Set an expiry date and a pay link before creating the link."],
  [
    "client_proposal_send_not_approved",
    "conflict",
    "The link can only be turned on for a saved version. Refresh: it may have been taken back to editing.",
  ],
  [
    "client_proposal_family_accepted",
    "conflict",
    "The client has already accepted a version of this proposal, so another version can't be sent.",
  ],
  ["client_proposal_not_found", "not_found", "Proposal not found."],
];

/**
 * Turn whatever the database said into a `ProposalError` with a sentence a
 * person can act on. Matches the trigger's stable message prefixes first, then
 * Postgres SQLSTATE codes and a few keywords; anything unrecognised becomes a
 * generic "could not" that never repeats the original text.
 */
export function friendlyProposalError(error: DbErrorLike, doing = "save the proposal"): ProposalError {
  const code = error?.code ?? "";
  const message = (error?.message ?? "").toLowerCase();

  for (const [prefix, kind, text] of TRIGGER_MESSAGES) {
    if (message.includes(prefix)) return new ProposalError(kind, text);
  }

  if (message.includes("approver")) {
    return new ProposalError("forbidden", "Only the firm's named approvers can create a client link.");
  }
  if (message.includes("service role") || message.includes("service_role")) {
    return new ProposalError("forbidden", "Only the client can accept a proposal, from their own link.");
  }
  if (code === "42501" || message.includes("row-level security") || message.includes("permission denied")) {
    return new ProposalError("forbidden", `You don't have permission to ${doing}.`);
  }
  if (message.includes("frozen") || message.includes("immutable") || message.includes("cannot be edited") || message.includes("can no longer")) {
    return new ProposalError("frozen", "This version has already gone out and can't be changed. Start a new version instead.");
  }
  if (message.includes("transition")) {
    return new ProposalError("conflict", "This proposal can't move to that status from where it is now. Refresh and check its status.");
  }
  if (code === "P0002") {
    return new ProposalError("not_found", "Proposal not found.");
  }
  if (code === "23505") {
    return new ProposalError("conflict", "Someone else changed this proposal at the same time (for example, another draft of it already exists). Refresh and try again.");
  }
  if (code === "23503") {
    return new ProposalError("validation", "The linked lead or matter isn't one of this firm's records.");
  }
  if (code === "23514" || code === "22001" || code === "22P02") {
    return new ProposalError("validation", "One of the fields is out of range or the wrong shape. Check the dates, links and lengths.");
  }
  return new ProposalError("unavailable", `Couldn't ${doing}. Try again, and tell us if it keeps happening.`);
}
