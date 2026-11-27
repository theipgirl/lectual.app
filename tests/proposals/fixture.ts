import type { ProposalContent } from "@/lib/proposals/types";

/**
 * `lectual-plugin/firm/templates/proposal-page/callum-ferreira.example.json`
 * converted to the database content shape: money in cents, kinds as 'word' /
 * 'logo', pct as 0..100. Two brand names, two marks and two classes each.
 * Larkmoor's marks are word then logo; Open4Everyone's are logo then word,
 * so "the second mark" depends on content order, not on kind.
 */
export function callum(): ProposalContent {
  return {
    client: { first_name: "Callum", full_name: "Callum Ferreira", company: "Larkmoor" },
    greeting:
      "Hi Callum, thank you again for meeting with us for your strategy call. Your proposal is outlined below for your review and acceptance.",
    recommendation:
      "Getting a word mark and a design mark (logo) for each of your trademarks is best practice and provides comprehensive protection.",
    pricing: {
      package: "Concierge",
      base_cents: 495_000,
      included_classes: 3,
      per_class_cents: 82_500,
      second_mark_discount_pct: 20,
      gov_per_class_cents: 35_000,
    },
    names: [
      {
        id: "p",
        name: "Larkmoor",
        what: "Your company name",
        marks: [
          { id: "p-word", kind: "word", desc: "Protects the name Larkmoor. Does not protect its font or style.", preselected: true },
          { id: "p-logo", kind: "logo", desc: "Protects your Larkmoor logo design, including its fonts, styles and colors.", preselected: true },
        ],
        classes: [
          { id: "p-c1", label: "Cloud-Based Software as a Service (SaaS)", preselected: true },
          { id: "p-c2", label: "Consulting & Professional Services", preselected: true },
        ],
      },
      {
        id: "t",
        name: "Open4Everyone",
        what: "Your nonprofit initiative",
        note: "**A note from Rebecca.** Both are included.",
        marks: [
          { id: "t-logo", kind: "logo", desc: "Protects the Open4Everyone design.", preselected: true },
          { id: "t-word", kind: "word", desc: "Protects the name Open4Everyone. Optional.", preselected: true },
        ],
        classes: [
          { id: "t-c1", label: "Charitable Services", preselected: true },
          { id: "t-c2", label: "Educational Workshops & AI Upskilling Programs", preselected: true },
        ],
      },
    ],
    adjustments: [],
    includes: [
      { label: "Classes included", included: "Your choice (up to 3)", highlight: true },
      { label: "Non-Substantive Office Action Response", value: "$450 each", included: "Unlimited" },
      {
        label: "Substantive Office Action Legal Strategy Review",
        value: "$675",
        note: "Does not include the response itself",
        included: "✓",
      },
    ],
    office_action_note: "The response itself is quoted separately.",
  };
}
