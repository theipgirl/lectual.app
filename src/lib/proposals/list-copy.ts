import type { ProposalSegment } from "./segments";

/**
 * Words on the proposals list that are decided by a rule, not just copy (Sprint 33). Pure.
 */

/** The dollar tile's label (was "Out with clients"); the one-line explanation under it stays. */
export const OPEN_OFFERS_LABEL = "Open offers (lowest package each)";

/** Why a consult can't be drafted from yet. */
export const TRANSCRIPT_PROCESSING = "Transcript still processing";

export const CONSULTS_SECTION_TITLE = "Consults and client meetings";
export const CONSULTS_UNAVAILABLE = "Can't show meetings right now. Refresh to try again.";
export const CONSULTS_EMPTY = "No consults or client meetings yet.";

/** Shown when the list holds only the newest meetings: "Showing the newest 30." */
export function consultsCapNote(shown: number): string {
  return `Showing the newest ${shown}.`;
}

/** A filtered list with nothing in it: the sentence for that segment. */
export function emptySegmentSentence(segment: ProposalSegment): string {
  switch (segment) {
    case "out":
      return "No proposals are out with a client yet.";
    case "drafts":
      return "No drafts or blocked proposals right now.";
    case "accepted":
      return "No accepted proposals yet.";
    case "expired":
      return "No expired proposals.";
    default:
      return "No proposals yet.";
  }
}
