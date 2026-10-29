/**
 * Spec 6: how a brand name priced under a package the client chose is named, everywhere it is shown: the client's
 * review panel and receipt, the staff proposal page, the accept notice and the Lawmatics note. Pure. Package names
 * are the firm's own text (never client-typed), so they may travel; the client's class words never do.
 */

/** "The Fold — Enhanced" for a brand name priced under a chosen package; the plain name otherwise. */
export function packageLineTitle(qn: { name: string; package?: string }): string {
  return qn.package ? `${qn.name} — ${qn.package}` : qn.name;
}

/** "The Fold — Enhanced; The Confidence Interval — Concierge" for the INCLUDED names that carry a package, or "". */
export function chosenPackagesText(names: ReadonlyArray<{ name: string; package?: string; included: boolean }> | null | undefined): string {
  return (names ?? [])
    .filter((n) => n.included && typeof n.package === "string" && n.package)
    .map(packageLineTitle)
    .join("; ");
}
