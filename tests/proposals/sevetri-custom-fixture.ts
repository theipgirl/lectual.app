import type { PackageOffer, ProposalContent } from "@/lib/proposals/types";
import { sevetri } from "./fixture";

/* ── Custom discount on one package (Taylor, 2026-11-03, for Sevetri Wilson). Sevetri's proposal offers
 * Essential / Enhanced / Concierge per MARK (Spec 7), default Concierge, 2 classes per brand name. Concierge
 * alone carries a "Custom proposal discount": $825 off for each class under its 3 included classes. ── */

export const S_ESSENTIAL: PackageOffer = { package: "Essential", base_cents: 195_000, per_class_cents: 82_500, included_classes: 1, gov_per_class_cents: 35_000, second_mark_discount_pct: 20 };
export const S_ENHANCED: PackageOffer = { package: "Enhanced", base_cents: 325_000, per_class_cents: 82_500, included_classes: 2, gov_per_class_cents: 35_000, second_mark_discount_pct: 20 };
export const S_CONCIERGE: PackageOffer = {
  package: "Concierge",
  base_cents: 495_000,
  per_class_cents: 82_500,
  included_classes: 3,
  gov_per_class_cents: 35_000,
  second_mark_discount_pct: 20,
  custom_discount: { label: "Custom proposal discount", per_class_under_cents: 82_500 },
};
export const S_OPTIONS = ["Essential", "Enhanced", "Concierge"];

/** Sevetri's two brand names, every mark choosing Essential / Enhanced / Concierge (default Concierge), no global adjustment. */
export function sevetriCustom(): ProposalContent {
  const base = sevetri();
  return {
    ...base,
    packages: [{ ...S_ESSENTIAL }, { ...S_ENHANCED }, { ...S_CONCIERGE, custom_discount: { ...S_CONCIERGE.custom_discount! } }],
    names: base.names.map((n) => ({
      ...n,
      marks: n.marks.map((m) => ({ ...m, package_choice: { options: [...S_OPTIONS], default: "Concierge" } })),
    })),
    adjustments: [],
  };
}
