/**
 * "For the reviewer": the queue item's `summary` as a list. Pure.
 *
 * The drafters write the summary as one block: lines, bullets ("-", "*", a bullet dot, "1."), and "CHECK FIRST" notes
 * that sometimes run inline in a single paragraph. This splits it into items, marks the CHECK FIRST ones and puts them
 * first, so what an approver must look at before anything else is at the top. Nothing is rewritten: an item is the
 * writer's own words, trimmed, with only its list marker and its "CHECK FIRST:" label taken off.
 */

export type ReviewerItem = { text: string; checkFirst: boolean };

export const REVIEWER_COLLAPSE_AFTER = 5;

const BULLET = /^\s*(?:[-*•·–—]|\d{1,2}[.)])\s+/;
const CHECK_FIRST = /^CHECK FIRST\b[\s:.–—-]*/i;
/** A bullet dot with spaces round it inside a line. */
const INLINE_BULLET = /\s+[•·]\s+/;

/** One line split into pieces: at inline bullets, and just before each "CHECK FIRST" that is not at its start. */
function pieces(line: string): string[] {
  return line
    .split(INLINE_BULLET)
    .flatMap((part) => part.split(/(?<=\S)\s+(?=CHECK FIRST\b)/))
    .map((part) => part.trim())
    .filter(Boolean);
}

export function parseReviewerSummary(summary: string | null | undefined): ReviewerItem[] {
  if (!summary || !summary.trim()) return [];
  const items: ReviewerItem[] = [];
  // A bare "CHECK FIRST" line marks the items under it, until the next blank line.
  let inCheckSection = false;
  for (const rawLine of summary.replace(/\r\n?/g, "\n").split("\n")) {
    if (!rawLine.trim()) {
      inCheckSection = false;
      continue;
    }
    for (const piece of pieces(rawLine.replace(BULLET, ""))) {
      const marked = CHECK_FIRST.test(piece);
      const text = marked ? piece.replace(CHECK_FIRST, "").trim() : piece;
      if (marked && !text) {
        inCheckSection = true;
        continue;
      }
      if (!text) continue;
      items.push({ text, checkFirst: marked || inCheckSection });
    }
  }
  // CHECK FIRST first; the writer's order inside each group.
  return [...items.filter((i) => i.checkFirst), ...items.filter((i) => !i.checkFirst)];
}

/** The first N items, and how many are held behind "Show all". */
export function splitForDisplay(items: readonly ReviewerItem[], limit = REVIEWER_COLLAPSE_AFTER): { shown: ReviewerItem[]; hidden: ReviewerItem[] } {
  return { shown: items.slice(0, limit), hidden: items.slice(limit) };
}
