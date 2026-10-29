import type { PackageOffer, ProposalContent } from "@/lib/proposals/types";
import { sevetri } from "./fixture";

/* ── Danielle Milton's proposal (Spec 6, Taylor 2026-10-29) ─────────────────────────────────────────── */

export const ESSENTIAL: PackageOffer = { package: "Essential", base_cents: 195_000, per_class_cents: 82_500, included_classes: 1, gov_per_class_cents: 35_000, second_mark_discount_pct: 20 };
export const ENHANCED: PackageOffer = { package: "Enhanced", base_cents: 325_000, per_class_cents: 82_500, included_classes: 2, gov_per_class_cents: 35_000, second_mark_discount_pct: 20 };
export const CONCIERGE: PackageOffer = { package: "Concierge", base_cents: 495_000, per_class_cents: 82_500, included_classes: 3, gov_per_class_cents: 35_000, second_mark_discount_pct: 20 };
export const OPTIONS = ["Essential", "Enhanced", "Concierge"];

export function danielle(): ProposalContent {
  const base = sevetri();
  return {
    ...base,
    client: { first_name: "Danielle", full_name: "Danielle Milton" },
    pricing: { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
    packages: [ESSENTIAL, ENHANCED, CONCIERGE],
    names: [
      {
        id: "fold",
        name: "The Fold",
        package_choice: { options: [...OPTIONS], default: "Enhanced" },
        marks: [{ id: "fold-word", kind: "word", desc: "Protects the words.", preselected: true }],
        classes: [
          { id: "fold-c1", label: "Clothing", preselected: true },
          { id: "fold-c2", label: "Online retail", preselected: true },
          { id: "fold-c3", label: "Events", preselected: true },
        ],
      },
      {
        id: "ci",
        name: "The Confidence Interval",
        package_choice: { options: [...OPTIONS], default: "Enhanced" },
        discount_pct: 10,
        marks: [{ id: "ci-word", kind: "word", desc: "Protects the words.", preselected: true }],
        classes: [
          { id: "ci-c1", label: "Podcasts", preselected: true },
          { id: "ci-c2", label: "Coaching", preselected: true },
        ],
      },
    ],
    adjustments: [],
  };
}

