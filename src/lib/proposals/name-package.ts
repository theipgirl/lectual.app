/**
 * Spec 6: how a brand name priced under a package the client chose is named, everywhere it is shown: the client's
 * review panel and receipt, the staff proposal page, the accept notice and the Lawmatics note. Pure. Package names
 * are the firm's own text (never client-typed), so they may travel; the client's class words never do.
 *
 * Spec 7: a brand name whose MARKS carry their own packages names each one: "The Fold — word mark, Enhanced; design
 * mark, Essential".
 */

import type { MarkKind } from "./types";

/** Spec 7: the lower-case words a mark is called by in a package line. */
export const MARK_PACKAGE_WORDS: Record<MarkKind, string> = {
  word: "word mark",
  logo: "design mark",
};

type LineMark = { kind: MarkKind; package?: string };
type LineName = { name: string; package?: string; marks?: ReadonlyArray<LineMark> };

/** "word mark, Enhanced; design mark, Essential" for the marks priced under their own package, or "". */
export function markPackagesText(marks: ReadonlyArray<LineMark> | null | undefined): string {
  return (marks ?? [])
    .filter((m) => typeof m.package === "string" && m.package)
    .map((m) => `${MARK_PACKAGE_WORDS[m.kind] ?? m.kind}, ${m.package}`)
    .join("; ");
}

/**
 * "The Fold — Enhanced" for a brand name priced under a chosen package; "The Fold — word mark, Enhanced; design mark,
 * Essential" for one whose marks carry their own; the plain name otherwise.
 */
export function packageLineTitle(qn: LineName): string {
  if (qn.package) return `${qn.name} — ${qn.package}`;
  const marks = markPackagesText(qn.marks);
  return marks ? `${qn.name} — ${marks}` : qn.name;
}

/** "The Fold — Enhanced; The Confidence Interval — Concierge" for the INCLUDED names that carry a package, or "". */
export function chosenPackagesText(names: ReadonlyArray<LineName & { included: boolean }> | null | undefined): string {
  return (names ?? [])
    .filter((n) => n.included && ((typeof n.package === "string" && n.package) || markPackagesText(n.marks)))
    .map(packageLineTitle)
    .join("; ");
}
