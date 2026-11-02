import type { ProposalContent } from "@/lib/proposals/types";
import { sevetri } from "./fixture";
import { CONCIERGE, ENHANCED, ESSENTIAL } from "./danielle-fixture";

/* ── Spec 7 (Taylor 2026-10-29): a package per mark. The word mark offers Essential / Enhanced / Concierge (default
 * Enhanced); the design mark is an add-on offering Essential / Enhanced (default Essential), unticked to start. ── */

export const WORD_OPTIONS = ["Essential", "Enhanced", "Concierge"];
export const DESIGN_OPTIONS = ["Essential", "Enhanced"];

export function fold(): ProposalContent {
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
        marks: [
          { id: "fold-word", kind: "word", desc: "Protects the words.", preselected: true, package_choice: { options: [...WORD_OPTIONS], default: "Enhanced" } },
          { id: "fold-logo", kind: "logo", desc: "Protects the design.", preselected: false, package_choice: { options: [...DESIGN_OPTIONS], default: "Essential" } },
        ],
        classes: [
          { id: "fold-c1", label: "Clothing", preselected: true },
          { id: "fold-c2", label: "Online retail", preselected: true },
        ],
      },
    ],
    adjustments: [],
  };
}
