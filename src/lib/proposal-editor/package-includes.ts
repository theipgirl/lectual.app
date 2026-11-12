import { packageChoiceOptions, usesMarkPackages } from "@/lib/proposals/pricing";
import type { PackageOffer, ProposalContent, ProposalInclude } from "@/lib/proposals/types";
import { parseIncludes, rowIndexes, type Parsed } from "./form";

/**
 * Editor fixes (2026-11-12): the "What the package includes" table in the editor edits the table the CLIENT sees.
 *
 * When the packages a proposal offers carry their own rows (Settings -> Proposals -> Packages, 2026-11-10), the client
 * page draws one comparison table from `content.packages[].includes` (`includesComparison`) and never reads
 * `content.includes`. So the editor then offers one table per offered package, posted as `pkgInc.<n>.package` plus the
 * usual rows under `pkgInc.<n>.<row>.<field>` and the marker `pkgIncFields`, instead of the single table nobody sees.
 *
 * Pure, and importable from the server page (the client-proposal functions live in a "use client" module).
 */

const listed = (o: PackageOffer): ProposalInclude[] =>
  Array.isArray(o.includes) ? o.includes.filter((r) => r && typeof r.label === "string" && r.label.trim()) : [];

/** The packages the client is offered, once each, in the order the client page uses (`offeredPackages`). */
function offered(content: ProposalContent): PackageOffer[] {
  const seen = new Set<string>();
  const out: PackageOffer[] = [];
  for (const nm of content.names ?? []) {
    const owners: unknown[] = usesMarkPackages(content, nm) ? (nm.marks ?? []) : [nm];
    for (const owner of owners) {
      for (const offer of packageChoiceOptions(content, owner)) {
        if (seen.has(offer.package)) continue;
        seen.add(offer.package);
        out.push(offer);
      }
    }
  }
  return out;
}

/**
 * One editable table per offered package, or `null` when the client page shows the single `content.includes` table
 * (the same rule as `includesComparison`: no offered package has rows of its own).
 */
export function editorPackageIncludes(content: ProposalContent): { package: string; includes: ProposalInclude[] }[] | null {
  const offers = offered(content);
  if (!offers.some((o) => listed(o).length > 0)) return null;
  return offers.map((o) => ({ package: o.package, includes: listed(o).map((r) => ({ ...r })) }));
}

const rowKey = (r: ProposalInclude) =>
  JSON.stringify([r.label.trim(), (r.value ?? "").trim(), r.included.trim(), (r.note ?? "").trim(), r.highlight === true]);
const sameRows = (a: readonly ProposalInclude[], b: readonly ProposalInclude[]) => a.length === b.length && a.every((r, i) => rowKey(r) === rowKey(b[i]));

/**
 * The posted package tables, applied to `content` (already refreshed from the firm's list). A package whose posted rows
 * equal the rows the page was drawn with (`stored`, the saved proposal) is left alone, so the firm's own rows stay in
 * charge (#23) until a person edits them here. An edited table replaces that package's rows and is marked
 * `includes_edited`, which `withPackageSnapshot` then keeps on every later refresh. A package the proposal no longer
 * holds is ignored.
 */
export function applyPackageIncludes(content: ProposalContent, form: FormData, stored: ProposalContent): Parsed<ProposalContent> {
  if (!Array.isArray(content.packages)) return { ok: true, value: content };
  const packages = content.packages.map((p) => ({ ...p }));
  for (const n of rowIndexes(form, "pkgInc")) {
    const name = form.get(`pkgInc.${n}.package`);
    if (typeof name !== "string") continue;
    const at = packages.findIndex((p) => p.package === name);
    if (at < 0) continue;
    const rows = parseIncludes(form, `pkgInc.${n}`);
    if (!rows.ok) return rows;
    const before = (Array.isArray(stored.packages) ? stored.packages : []).find((p) => p && p.package === name);
    if (before && sameRows(rows.value, listed(before))) continue;
    const { includes: _old, ...rest } = packages[at];
    void _old;
    packages[at] = { ...rest, ...(rows.value.length > 0 ? { includes: rows.value } : {}), includes_edited: true };
  }
  return { ok: true, value: { ...content, packages } };
}
