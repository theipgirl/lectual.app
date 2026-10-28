import { APPROVALS_NAME } from "@/lib/ui/words";

/** What the Leads page read besides the leads themselves. Each is `ok`, `unavailable`, or absent. */
export type DetailReads = {
  approvals?: { status: string } | null;
  agentMoves?: { status: "ok"; truncated: boolean } | { status: "unavailable" } | null;
  stageDecisions?: { status: "ok"; truncated: boolean } | { status: "unavailable" } | null;
};

export const DETAIL_NAMES = {
  approvals: APPROVALS_NAME.toLowerCase(),
  agentMoves: "automatic moves",
  stageDecisions: "stage decisions",
} as const;

/**
 * The ONE note the Leads page shows when a side read did not fully land (it replaces three separate
 * warning lines). It names only the parts that failed or were cut short, in a fixed order, and is null
 * when everything loaded. The state logic is untouched: the chips and filters that depend on a failed
 * read stay off exactly as before; this only says so, once, in plain words.
 */
export function detailsNote(reads: DetailReads): { names: string[]; text: string } | null {
  const names: string[] = [];
  if (reads.approvals?.status === "unavailable") names.push(DETAIL_NAMES.approvals);
  if (reads.agentMoves && (reads.agentMoves.status === "unavailable" || reads.agentMoves.truncated)) names.push(DETAIL_NAMES.agentMoves);
  if (reads.stageDecisions && (reads.stageDecisions.status === "unavailable" || reads.stageDecisions.truncated)) names.push(DETAIL_NAMES.stageDecisions);
  if (names.length === 0) return null;
  return { names, text: `Some details couldn't load (${names.join(", ")}). Refresh to try again.` };
}
