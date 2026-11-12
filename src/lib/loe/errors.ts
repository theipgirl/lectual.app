/**
 * Database refusals for the engagement letter, as fixed sentences (lectual 0106's stable prefixes).
 * Pure. No raw database text, constraint name or SQL ever reaches a screen: an unmapped error gets
 * the generic sentence.
 */

import { isMissingTableError } from "@/lib/files/errors";
import { notReadyYet } from "@/lib/ui/words";

export const LETTER_NOT_ALLOWED = "Your role can't change the engagement letter.";
export const LETTER_GENERIC_ERROR = "Couldn't save the letter. Try again.";
export const LETTER_NOT_SET_UP = notReadyYet("The engagement letter");

const BY_PREFIX: ReadonlyArray<readonly [prefix: string, sentence: string]> = [
  ["loe_template_not_approver", "Only the firm's named approvers can approve the engagement letter."],
  ["loe_template_edit_admin_only", "Only an owner, admin or senior admin can edit the engagement letter."],
  ["loe_template_frozen", "An approved letter can't be changed. Start a new draft from it instead."],
  ["loe_template_bad_transition", "Save your edits first, then approve the letter on its own."],
  ["loe_template_body_invalid", "The letter uses a merge field that doesn't exist, or has a brace that doesn't close. Fix it, then approve."],
];

type DbErrorLike = { code?: unknown; message?: unknown; details?: unknown } | null | undefined;

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** The sentence for a database error. The message is only matched, never returned. */
export function letterErrorSentence(error: DbErrorLike): string {
  if (!error) return LETTER_GENERIC_ERROR;
  if (isMissingTableError(error as never)) return LETTER_NOT_SET_UP;
  const message = text(error.message);
  for (const [prefix, sentence] of BY_PREFIX) if (message.includes(prefix)) return sentence;
  const code = text(error.code);
  if (code === "23505") return "There is already a draft of this letter. Open it to keep editing.";
  if (/client_proposal_loe_template_body_len/.test(message) || /client_proposal_loe_template_title_len/.test(message)) {
    return "The title and the letter text must not be empty, and the letter is at most 60,000 characters.";
  }
  if (code === "42501" || /row-level security|permission denied/i.test(message)) return LETTER_NOT_ALLOWED;
  return LETTER_GENERIC_ERROR;
}
