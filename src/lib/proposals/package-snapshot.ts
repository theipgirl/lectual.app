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
 * `content` with `packages` refreshed from the firm's current list, when a brand name uses `package_choice`. Unchanged
 * otherwise.
 *
 * The firm's list supplies the PRICES only. What belongs to this proposal is kept on the refreshed copy (2026-11-09):
 * - an entry's `custom_discount` (2026-11-03);
 * - an entry's `includes` rows, always (2026-11-10, the firm owner: "let each proposal keep its own rows"). Taking the
 *   firm's (then empty) rows wiped every package's "What each package includes" table on the first editor save, and a
 *   later edit in Settings -> Proposals must not rewrite proposals already made. Only an entry with no rows of its own
 *   takes the firm's rows, if the firm's list holds some;
 * - the proposal's own ORDER: its entries stay where they were (an entry no longer on the firm's list keeps its
 *   place, unpriced by the refresh), and a package new to the proposal is added after them, in the firm's order.
 *
 * `content` is always the STORED proposal's content (plus the server-parsed brand name), never browser input, so
 * nothing here is taken from the browser.
 */
export function withPackageSnapshot(content: ProposalContent, settingPricing: unknown): ProposalContent {
  if (!usesPackageChoice(content)) return content;
  const earlier = (Array.isArray(content.packages) ? content.packages : []).filter((p) => isObj(p) && typeof p.package === "string");
  const offers = packageOffersFromSetting(settingPricing);
  const refresh = (before: PackageOffer, offer: PackageOffer): PackageOffer => {
    const { includes: firmIncludes, ...prices } = offer;
    const includes = includeRows(before.includes) ?? firmIncludes;
    return {
      ...prices,
      ...(includes ? { includes } : {}),
      ...(isObj(before.custom_discount) ? { custom_discount: before.custom_discount } : {}),
    };
  };
  const kept = earlier.map((before) => {
    const offer = offers.find((o) => o.package === before.package);
    return offer ? refresh(before, offer) : before;
  });
  const had = new Set(earlier.map((p) => p.package));
  return { ...content, packages: [...kept, ...offers.filter((o) => !had.has(o.package))] };
}
