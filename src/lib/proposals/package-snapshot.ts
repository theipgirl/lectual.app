/**
 * Spec 6: the packages a proposal may let a client choose between, snapshotted from the firm's CURRENT list.
 *
 * Pure (no database): the server actions read `client_proposal_setting.pricing` through the scoped client and pass
 * it in. The snapshot is taken whenever a brand name uses `package_choice`, so a later change to the firm's list
 * never re-prices a proposal that is already live or accepted (those are frozen anyway). A package already in the
 * proposal's snapshot that has since left the firm's list is kept, so a choice that names it stays valid.
 */

import { normalisePackages } from "./package-list";
import type { PackageOffer, ProposalContent, ProposalInclude } from "./types";

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function includeRows(value: unknown): ProposalInclude[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .filter((r): r is Record<string, unknown> => isObj(r) && typeof r.label === "string" && !!r.label.trim() && typeof r.included === "string")
    .map((r) => ({
      label: r.label as string,
      included: r.included as string,
      ...(typeof r.value === "string" ? { value: r.value } : {}),
      ...(typeof r.note === "string" ? { note: r.note } : {}),
      ...(r.highlight === true ? { highlight: true } : {}),
    }));
  return rows.length > 0 ? rows : undefined;
}

/** The firm's packages as offers: `normalisePackages`' numbers, plus a package's own `includes` rows when the setting holds some. */
export function packageOffersFromSetting(settingPricing: unknown): PackageOffer[] {
  const raw = isObj(settingPricing) && Array.isArray(settingPricing.packages) ? settingPricing.packages : [];
  return normalisePackages(settingPricing).map((p) => {
    const source = raw.find((r) => isObj(r) && typeof r.package === "string" && r.package.trim() === p.package);
    const includes = isObj(source) ? includeRows(source.includes) : undefined;
    return {
      package: p.package,
      base_cents: p.base_cents,
      per_class_cents: p.per_class_cents,
      included_classes: p.included_classes,
      gov_per_class_cents: p.gov_per_class_cents,
      second_mark_discount_pct: p.second_mark_discount_pct,
      ...(includes ? { includes } : {}),
    };
  });
}

/** True when some brand name (Spec 7: or one of its marks) lets the client choose its package. */
export function usesPackageChoice(content: ProposalContent): boolean {
  return (content.names ?? []).some((n) => isObj(n?.package_choice) || (Array.isArray(n?.marks) && n.marks.some((m) => isObj(m?.package_choice))));
}

/**
 * `content` with `packages` set to the firm's current list (plus any earlier snapshot entry no longer on it), when a
 * brand name uses `package_choice`. Unchanged otherwise.
 */
export function withPackageSnapshot(content: ProposalContent, settingPricing: unknown): ProposalContent {
  if (!usesPackageChoice(content)) return content;
  const current = packageOffersFromSetting(settingPricing);
  const names = new Set(current.map((p) => p.package));
  const kept = (Array.isArray(content.packages) ? content.packages : []).filter((p) => isObj(p) && typeof p.package === "string" && !names.has(p.package));
  return { ...content, packages: [...current, ...kept] };
}
