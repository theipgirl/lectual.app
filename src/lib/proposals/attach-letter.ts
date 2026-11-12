import { loeIssues } from "@/lib/loe/validate";
import type { ApprovedRead } from "@/lib/loe/templates-store";
import { LETTER_NOT_ATTACHED_CHECK } from "@/lib/ui/words";
import { withLoeSnapshot } from "./loe-snapshot";
import { MAX_CONTENT_CHECKS, isGeneralContent, type CheckSource, type ContentCheck, type ProposalContent } from "./types";

/**
 * Attaching the firm's approved engagement letter to a draft that an ASSISTANT or COPILOT made.
 *
 * Every door attaches the firm's approved letter by default when one exists. The from-scratch door hands the letter to
 * the one builder, which calls `withLoeSnapshot`. The two doors that involve a model must not do that: the letter is the
 * firm's privileged text and it never enters a prompt, a tool definition or a tool result. So their builders are called
 * with `letter: null`, and the letter is attached HERE, by the same `withLoeSnapshot`, in the run / executor layer:
 *   - AFTER the last model call of the run, and
 *   - into a content object that goes ONLY to the database insert (never back to the model, a queue item, an email or a log).
 * `tests/proposals/letter-never-in-prompts.test.ts` holds both halves.
 *
 * A read that FAILED never produces a draft that silently lacks its letter. The draft is still made (an assistant's work is
 * not thrown away over a read that will work a minute later), and it carries a "Check" item, drawn in the editor's
 * "Ready to send?" list with a link to the Engagement letter section, saying the letter couldn't be attached. A person at
 * the keyboard gets the stricter answer (the from-scratch door creates nothing and says "Couldn't read your engagement
 * letter"); the check below says the same thing in the same words.
 *
 * Pure: the caller does the read (`getApprovedLetter`, fenced on the org when it may be on the service role) and passes it in.
 */

/** The path of the letter's check: `targetForPath` sends it to the editor's Engagement letter section. */
export const LETTER_CHECK_PATH = "loe";

/** The check's words live with the other words a person reads (`words.ts`); re-exported here for the doors that write it. */
export { LETTER_NOT_ATTACHED_CHECK };

export type LetterAttach =
  /** The firm's approved letter of this kind is now on the content. */
  | "attached"
  /** The firm has no approved letter of this kind (or no letter table yet): nothing to attach, nothing to check. */
  | "none"
  /** The read failed, or the letter read is not one a proposal can carry: not attached, and the content carries the check. */
  | "unreadable";

export function attachFirmLetter(content: ProposalContent, read: ApprovedRead, source: CheckSource): { content: ProposalContent; letter: LetterAttach } {
  const kind = isGeneralContent(content) ? "general" : "trademark";
  if (read.status === "not-set-up") return { content, letter: "none" };
  if (read.status === "ok") {
    if (!read.letter || read.letter.kind !== kind) return { content, letter: "none" };
    const attached = withLoeSnapshot(content, read.letter, true);
    if (attached.loe && loeIssues(attached.loe, kind).length === 0) return { content: attached, letter: "attached" };
  }
  return { content: withLetterCheck(content, source), letter: "unreadable" };
}

/** The check goes FIRST (it is the one that changes what the client is asked to sign) and the list stays within its cap. */
function withLetterCheck(content: ProposalContent, source: CheckSource): ProposalContent {
  const others = (Array.isArray(content.checks) ? content.checks : []).filter((c) => c?.path !== LETTER_CHECK_PATH);
  const check: ContentCheck = { text: LETTER_NOT_ATTACHED_CHECK, source, path: LETTER_CHECK_PATH };
  return { ...content, checks: [check, ...others].slice(0, MAX_CONTENT_CHECKS) };
}

/**
 * Removes the "couldn't be attached" check. Called by the editor's Save once a person has saved with the firm's letter readable
 * and the Engagement letter switch on the page: they have then seen the switch and chosen, so the note has done its job.
 * Returns the same object when there is nothing to remove.
 */
export function withoutLetterCheck(content: ProposalContent): ProposalContent {
  if (!Array.isArray(content.checks) || !content.checks.some((c) => c?.path === LETTER_CHECK_PATH)) return content;
  const rest = content.checks.filter((c) => c?.path !== LETTER_CHECK_PATH);
  const { checks: _old, ...without } = content;
  void _old;
  return (rest.length > 0 ? { ...without, checks: rest } : without) as ProposalContent;
}
