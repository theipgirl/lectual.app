import { GENERAL_PRICING_STUB, type ProposalContent } from "@/lib/proposals/types";

/**
 * Spec 9's first real case: Faithe Williams. Review both management agreements and all correspondence and evidence,
 * then draft a notice of non-renewal and termination. Value 2.5 hrs x $500/hr = $1,250; the fee charged is $500 flat.
 */
export function faithe(): ProposalContent {
  return {
    kind: "general",
    general: {
      matter_title: "Management agreement: notice of non-renewal and termination",
      summary: "We will review both management agreements and all correspondence and evidence, then draft your notice of non-renewal and termination.",
      items: [
        { id: "w-contracts", label: "Review both management agreements", hours: 1, rate_cents: 50_000 },
        { id: "w-corr", label: "Review all correspondence and evidence", hours: 0.5, rate_cents: 50_000 },
        { id: "w-letter", label: "Draft the notice of non-renewal and termination", hours: 1, rate_cents: 50_000 },
      ],
      fee_cents: 50_000,
      excludes: ["Litigation or arbitration"],
      terms_note: "Limited to the work above. Anything further depending on how they respond: we'll talk first and agree a plan.",
    },
    client: { first_name: "Faithe", full_name: "Faithe Williams" },
    greeting: "Hi Faithe, thank you again for meeting with us. Your proposal is outlined below for your review and acceptance.",
    pricing: { ...GENERAL_PRICING_STUB },
    names: [],
    adjustments: [],
    includes: [],
  };
}
