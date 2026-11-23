/**
 * Database refusals for the firm's signing words, as fixed sentences (lectual 0117's stable prefixes). Pure. No raw database
 * text, constraint name or SQL ever reaches a screen: an unmapped error gets the generic sentence.
 */

import { isMissingObjectError } from "./email-signing/codes";
import { notReadyYet } from "@/lib/ui/words";

export const WORDS_NOT_ALLOWED = "Your role can't change the signing words.";
export const WORDS_GENERIC_ERROR = "Couldn't save the signing words. Try again.";
export const WORDS_NOT_SET_UP = notReadyYet("Emailed signing links");

const BY_PREFIX: ReadonlyArray<readonly [prefix: string, sentence: string]> = [
  ["signing_words_not_approver", "Only the firm's named approvers can approve the signing words."],
  ["signing_words_edit_admin_only", "Only an owner, admin or senior admin can edit the signing words."],
  ["signing_words_frozen", "Approved signing words can't be changed. Start a new draft from them instead."],
  ["signing_words_bad_transition", "Save your edits first, then approve the signing words on their own."],
  ["signing_words_fields_invalid", "A field uses a merge field it may not use, or the signing link email doesn't use {{signing_link}} exactly once. Fix it, then approve."],
];

type DbErrorLike = { code?: unknown; message?: unknown } | null | undefined;

const text = (v: unknown): string => (typeof v === "string" ? v : "");

export function wordsErrorSentence(error: DbErrorLike): string {
  if (!error) return WORDS_GENERIC_ERROR;
  if (isMissingObjectError(error)) return WORDS_NOT_SET_UP;
  const message = text(error.message);
  for (const [prefix, sentence] of BY_PREFIX) if (message.includes(prefix)) return sentence;
  const code = text(error.code);
  if (code === "23505") return "There is already a draft of the signing words. Open it to keep editing.";
  if (code === "42501" || /row-level security|permission denied/i.test(message)) return WORDS_NOT_ALLOWED;
  return WORDS_GENERIC_ERROR;
}
