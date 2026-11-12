import type { ProposalRow } from "@/lib/proposals/types";
import type { ActionState } from "@/app/dashboard/proposals/errors";
import type { LetterCopyCheck } from "@/lib/loe/editor-state";
import { LETTER_PENDING_FIX } from "@/lib/ui/words";
import { LETTER_CHANGED_SENTENCE, LETTER_UNREADABLE_SENTENCE, LINK_CREATED, LINK_NOT_TURNED_ON } from "./vocabulary";

/**
 * "Save and create link": the existing approve transition, then the existing send
 * transition (`client_proposal_send`, which only makes the client link live; no client is
 * contacted). Dependencies are passed in so the order and the failure between the two steps are
 * tested without a database. Nothing else is reachable from here.
 */
export type CreateLinkDeps = {
  /** The module gate and staff-role check; a refusal is returned as is. */
  gate: () => Promise<ActionState | null>;
  /** Saves the posted form first (the one Save). Only called when the page said it has unsaved changes. */
  save?: (form: FormData) => Promise<ActionState>;
  /**
   * Sprint 6: is the engagement letter copy on the (just saved) proposal the firm's current approved version? Read AFTER the save, so
   * a Save that refreshed the copy passes. Optional: absent = no check (callers that carry no letter).
   */
  letterCurrent?: (id: string) => Promise<LetterCopyCheck>;
  approve: (id: string) => Promise<ProposalRow>;
  makeLive: (id: string) => Promise<ProposalRow>;
  /** Maps a thrown failure to the fixed sentence the person reads. */
  describe: (err: unknown, fallback: string) => ActionState;
  revalidate: (id: string) => void;
};

export async function runCreateLink(
  deps: CreateLinkDeps,
  id: string,
  options: { dirty?: boolean; form?: FormData } = {},
): Promise<ActionState> {
  const refused = await deps.gate();
  if (refused) return refused;

  // Unsaved changes are saved first. A refused save stops here: nothing is approved and no link is turned on.
  if (options.dirty && deps.save && options.form) {
    const saved = await deps.save(options.form);
    if (saved.error) return saved;
  }

  // A stale copy, or a failed read of the firm's letter, stops here with a fixed sentence: nothing is approved and no link is made.
  if (deps.letterCurrent) {
    let check: LetterCopyCheck;
    try {
      check = await deps.letterCurrent(id);
    } catch {
      check = "unreadable";
    }
    if (check === "stale") return { error: LETTER_CHANGED_SENTENCE };
    if (check === "unreadable") return { error: LETTER_UNREADABLE_SENTENCE };
    if (check === "unattached") return { error: LETTER_PENDING_FIX };
  }

  try {
    await deps.approve(id);
  } catch (err) {
    // Not an approver, blocking errors, a row that moved: the send step is never tried.
    return deps.describe(err, "Couldn't save this proposal.");
  }

  try {
    await deps.makeLive(id);
  } catch {
    // The approval persisted, so the page now reads "Saved" and offers "Turn on the link".
    deps.revalidate(id);
    return { error: LINK_NOT_TURNED_ON };
  }

  deps.revalidate(id);
  return { saved: true, notice: LINK_CREATED };
}
