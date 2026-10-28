import type { SegmentKey } from "./worklist";
import { matterStatusLabel } from "./status";

/**
 * Pure rules for the Matters list page (Sprint 33). The bands stay as headings; the chips are four.
 */

/** The chips, in order. The other segment keys still work in a URL; they are bands, not chips. */
export const LIST_CHIPS: readonly { key: SegmentKey; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "review", label: "Needs your review" },
  { key: "unassigned", label: "Unassigned" },
  { key: "closed", label: "Closed" },
];

/** "3. Filed" -> "Filed". The code is an ordering aid, not part of the stage's name. */
export function stageDisplayName(label: string): string {
  return label.replace(/^\s*\d+\s*[.)]\s*/, "").trim() || label;
}

export function mattersSubtitle(view: "table" | "board"): string {
  return view === "board"
    ? "Every open matter in its docket stage. Use Move on a card to change its stage."
    : "Every engaged matter, grouped by whose move it is. Longest in its stage first.";
}

/** Status belongs in the sub-line only when it is not the ordinary "Open". */
export function statusNote(status: string): string | null {
  return status === "open" ? null : matterStatusLabel(status);
}

/** The id the board gives a card, so a move can bring that card back into view. */
export function matterCardId(matterId: string): string {
  return `matter-card-${matterId}`;
}

/** matter id -> the first pending queue item tied to it (the Review pill's link target). */
export function reviewItemByMatter(items: ReadonlyArray<{ id: string; matter_id: string | null }>): Map<string, string> {
  const out = new Map<string, string>();
  for (const item of items) {
    if (item.matter_id && !out.has(item.matter_id)) out.set(item.matter_id, item.id);
  }
  return out;
}

export function reviewHref(queueItemId: string): string {
  return `/dashboard/queue/${encodeURIComponent(queueItemId)}/`;
}

export const MOVED_CARD_KEY = "lx_moved_matter";
