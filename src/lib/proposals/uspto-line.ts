import type { ProposalQuote } from "./types";

/**
 * The USPTO line under the totals, in plain words: "3 classes × 2 marks × $350". It only formats the
 * quote the engine returned (the counts and the fee come from `quoteProposal`); it never recomputes a
 * price (the check compares the engine's own counts and totals, with no money arithmetic here). When the figures are not a clean "classes × marks × fee" (several brand names, a second-mark
 * difference), it falls back to the plain total with the per-class rate.
 */
export function usptoLine(quote: ProposalQuote, perClassCents: number, money: (cents: number) => string): string {
  const included = quote.names.filter((n) => n.included);
  if (included.length === 1) {
    const only = included[0];
    const classes = only.classes.length;
    const marks = only.marks.length;
    if (classes > 0 && marks > 0 && classes * marks === only.class_count && only.gov_cents === quote.gov_total_cents) {
      return `${classes} ${classes === 1 ? "class" : "classes"} × ${marks} ${marks === 1 ? "mark" : "marks"} × ${money(perClassCents)}`;
    }
  }
  return `USPTO fees: ${money(quote.gov_total_cents)} (${money(perClassCents)} per class per mark)`;
}
