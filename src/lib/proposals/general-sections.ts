/**
 * Flat-fee work shown as NUMBERED SECTIONS (the attorney's layout for contract work): "1. One-Off Client Service Agreement
 * (5 Hours | $2,475)", an optional intro paragraph, then the item's bullet points; and, with two or more items, a "Legal Fee
 * Summary" table. PURE: no React, no database. It formats figures `quoteProposal` already made (each item's `value_cents`,
 * the quote's `value_cents` total); it prices nothing, and `pricing.ts` is untouched.
 *
 * The sections layout is used only when some item carries an intro or bullet points (`usesWorkSections`). A proposal without
 * either keeps its old one-line list, byte for byte.
 */

import type { GeneralItem, ProposalContent, ProposalQuote } from "./types";
import { FEE_SUMMARY_TOTAL } from "@/lib/loe/client-words";

export const NO_FIGURE = "—";

function cleanLines(lines: unknown): string[] {
  return Array.isArray(lines) ? lines.filter((l): l is string => typeof l === "string").map((l) => l.trim()).filter(Boolean) : [];
}

/** The item's intro paragraph, trimmed, or "". */
export function itemIntro(item: GeneralItem | undefined): string {
  return typeof item?.intro === "string" ? item.intro.trim() : "";
}

/** The item's bullet points, blank lines dropped. */
export function itemDetails(item: GeneralItem | undefined): string[] {
  return cleanLines(item?.details);
}

/** True when some work item has an intro or bullet points: the page then draws numbered sections. */
export function usesWorkSections(content: Pick<ProposalContent, "general"> | null | undefined): boolean {
  const items = Array.isArray(content?.general?.items) ? content!.general!.items : [];
  return items.some((it) => itemIntro(it).length > 0 || itemDetails(it).length > 0);
}

/** "5 Hours", "1 Hour", "2.5 Hours" (a unit word next to a number, so it lives here, not in a words file). */
export function hoursWords(hours: number): string {
  return `${hours} ${hours === 1 ? "Hour" : "Hours"}`;
}

/** "(5 Hours | $2,475)", "(5 Hours)", "($2,475)", or "" when the item has neither. */
export function sectionFigures(item: { hours?: number; value_cents: number }, money: (cents: number) => string): string {
  const parts: string[] = [];
  if (typeof item.hours === "number") parts.push(hoursWords(item.hours));
  if (item.value_cents > 0) parts.push(money(item.value_cents));
  return parts.length > 0 ? `(${parts.join(" | ")})` : "";
}

export type FeeSummaryRow = { label: string; hours: string; fees: string };

/**
 * The "Legal Fee Summary" rows and the bold Total row, from the quote's own items. Null with fewer than two items. The total
 * hours are added only when every item has hours (else "—"); the total fee is the quote's `value_cents` (the sum the engine
 * made), never added up here.
 */
export function feeSummary(
  quote: Pick<ProposalQuote, "general">,
  money: (cents: number) => string,
): { rows: FeeSummaryRow[]; total: FeeSummaryRow } | null {
  const items = quote.general?.items ?? [];
  if (items.length < 2) return null;
  const rows = items.map((it) => ({
    label: it.label,
    hours: typeof it.hours === "number" ? String(it.hours) : NO_FIGURE,
    fees: it.value_cents > 0 ? money(it.value_cents) : NO_FIGURE,
  }));
  const allHours = items.every((it) => typeof it.hours === "number");
  const totalHours = allHours ? items.reduce((sum, it) => sum + (it.hours ?? 0), 0) : null;
  return {
    rows,
    total: {
      label: FEE_SUMMARY_TOTAL,
      hours: totalHours === null ? NO_FIGURE : String(totalHours),
      fees: money(quote.general?.value_cents ?? 0),
    },
  };
}
