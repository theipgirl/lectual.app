import type { ContentCheck, ProposalContent } from "./types";

/**
 * The "engagement letter couldn't be attached" check, and the one question every reader asks of it.
 *
 * An assistant's or Copilot's draft carries this check (`content.checks`, `path: "loe"`) when the firm's approved letter
 * couldn't be read as the draft was made (`attach-letter.ts`). While it is on a content that has no letter, the default every
 * door applies (attach the firm's letter) has NOT been applied yet, and nobody has chosen otherwise. That state is PENDING:
 *   - the editor starts the Engagement letter switch ON for it, so an ordinary Save attaches the letter;
 *   - `validateContent(..., forApproval)` reports it as an error, so the checklist shows a "Fix" and the version cannot be saved
 *     for a link;
 *   - the make-live guard (`live-guard.ts`) refuses it;
 *   - the assistant's panel on the editor derives its line from it (nothing about it is stored as free text).
 * It ends in exactly three ways: a Save attached the letter; a person turned the switch off and saved; or a successful read
 * showed the firm has no approved letter to attach. A failed read never ends it.
 *
 * Pure, with no imports beyond types, so the validator, the editor and the guard can all use it.
 */

/** The path of the letter's check: `targetForPath` sends it to the editor's Engagement letter section. */
export const LETTER_CHECK_PATH = "loe";

/** The pending check itself, or null: the content has no letter and still carries the "couldn't be attached" check. */
export function pendingLetterCheck(content: Pick<ProposalContent, "loe" | "checks"> | null | undefined): ContentCheck | null {
  if (!content || content.loe) return null;
  const checks = Array.isArray(content.checks) ? content.checks : [];
  return checks.find((c) => c && typeof c === "object" && c.path === LETTER_CHECK_PATH && typeof c.text === "string") ?? null;
}

export function hasPendingLetterCheck(content: Pick<ProposalContent, "loe" | "checks"> | null | undefined): boolean {
  return pendingLetterCheck(content) !== null;
}
