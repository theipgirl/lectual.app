import { quoteProposal } from "@/lib/proposals/pricing";
import type { ProposalContent, Selection } from "@/lib/proposals/types";

/**
 * What to show next to each mark's checkbox, derived ONLY from `quoteProposal`
 * (this file does no price arithmetic of its own).
 *
 *  - A ticked mark shows the price the quote gave it (struck-through base when
 *    it is a second mark).
 *  - An unticked mark shows what ticking it would ADD, found by quoting the
 *    selection with that mark on and taking the difference for its brand name.
 *    That is right whichever mark is "first", because first is decided by
 *    content order, not by click order.
 *  - A brand name with no class ticked is priced as if all of its classes were
 *    (quoteProposal's own `n || total classes` rule), so the card is never a
 *    column of $0.
 */
export type MarkDisplay = {
  /** Cents this mark costs (or would add). */
  price_cents: number;
  /** Shown as a second mark: discounted, with the base struck through. */
  second: boolean;
  /** The brand name's first-mark price, for the struck-through figure. */
  base_cents: number;
  /** Classes the price assumes, for "3 classes included". */
  class_count: number;
  /** Spec 7: the package this mark is (or would be) priced under, when it has its own choice. */
  package?: string;
};

export function markDisplayPrices(content: ProposalContent, selection: Selection): Record<string, MarkDisplay> {
  const priced: Selection = { ...selection };
  for (const nm of content.names ?? []) {
    const anyClass = (nm.classes ?? []).some((c) => selection[c.id] === true);
    if (!anyClass) for (const c of nm.classes ?? []) priced[c.id] = true;
  }
  const base = quoteProposal(content, priced);
  const out: Record<string, MarkDisplay> = {};
  (content.names ?? []).forEach((nm, i) => {
    const qn = base.names[i];
    const classCount = (nm.classes ?? []).filter((c) => priced[c.id] === true).length;
    for (const m of nm.marks ?? []) {
      const ticked = priced[m.id] === true;
      let price = qn.base_cents;
      let second = false;
      // Spec 7: a mark priced under its own package strikes through ITS package price, not the name's.
      let markBase = qn.base_cents;
      let pkg: string | undefined;
      if (ticked && qn.included) {
        const found = qn.marks.find((x) => x.id === m.id);
        if (found) {
          price = found.price_cents;
          second = found.second;
          if (found.base_cents !== undefined) markBase = found.base_cents;
          pkg = found.package;
        }
      } else if (!ticked) {
        const withMark = quoteProposal(content, { ...priced, [m.id]: true }).names[i];
        const asQuoted = withMark.marks.find((x) => x.id === m.id);
        if (asQuoted?.base_cents !== undefined) {
          markBase = asQuoted.base_cents;
          price = asQuoted.base_cents;
        }
        pkg = asQuoted?.package;
        if (withMark.included) {
          price = withMark.legal_cents - (qn.included ? qn.legal_cents : 0);
          second = qn.included;
        }
      }
      out[m.id] = { price_cents: price, second, base_cents: markBase, class_count: classCount, ...(pkg ? { package: pkg } : {}) };
    }
  });
  return out;
}
