import type { ProposalSegment } from "./segments";

/**
 * Words on the proposals list that are decided by a rule, not just copy (Sprint 33). Pure.
 */

/** The dollar tile's label (was "Out with clients"); the one-line explanation under it stays. */
export const OPEN_OFFERS_LABEL = "Open offers (lowest package each)";

/** Why a consult can't be drafted from yet. */
export const TRANSCRIPT_PROCESSING = "Transcript still processing";

/** The consults strip's collapsed summary: "Recent consults (2 ready to draft)". */
export function consultsSummary(input: { status: "ok" | "unavailable"; ready: number }): string {
  if (input.status === "unavailable") return "Recent consults (couldn't load)";
  return `Recent consults (${input.ready} ready to draft)`;
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
