/**
 * Which packages the client has CHOSEN right now, for the "what's included" table on the client page.
 *
 * Pure (no React): the page calls it with its live selection (or the accepted selection on a receipt), so the
 * table follows the dropdowns. A brand name's own choice (Spec 6) counts only while one of its marks is ticked; a
 * mark's choice (Spec 7) counts only while that mark is ticked. Names are de-duplicated and ordered as in
 * `content.packages`. Display only: prices still come from `quoteProposal`.
 */

import { chosenMarkPackage, chosenPackage, usesMarkPackages } from "./pricing";
import type { ProposalContent, Selection } from "./types";

export function chosenPackageNames(content: ProposalContent, selection: Selection | null | undefined): string[] {
  const picked = new Set<string>();
  for (const nm of content.names ?? []) {
    const marks = Array.isArray(nm?.marks) ? nm.marks : [];
    const ticked = marks.filter((m) => selection?.[m.id] === true);
    if (ticked.length === 0) continue;
    if (usesMarkPackages(content, nm)) {
      for (const m of ticked) {
        const offer = chosenMarkPackage(content, nm, m, selection);
        if (offer) picked.add(offer.package);
      }
    } else {
      const offer = chosenPackage(content, nm, selection);
      if (offer) picked.add(offer.package);
    }
  }
  const order = (Array.isArray(content.packages) ? content.packages : []).map((p) => p?.package);
  const rank = (name: string) => {
    const i = order.indexOf(name);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...picked].sort((a, b) => rank(a) - rank(b));
}
