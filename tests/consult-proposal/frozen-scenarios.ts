import { draftProposalFromConsult, type ConsultProposalExtract } from "@/lib/consult-proposal/draft";
import type { ConsultProposalDraft, ConsultTranscriptTurn } from "@/lib/consult-proposal/types";
import type { ProposalPricing } from "@/lib/proposals/types";
import { standardProposalPricing } from "@/lib/proposals/types";
import { fakeLlm } from "../agents/helpers";
import { draftInput, meetingSource, SEVETRI_TURNS, sevetriOutput } from "./fixture";

/**
 * Scenarios whose output was captured from the pre-Sprint-5 drafter (commit 81cb513) into `frozen/pre-sprint.json`.
 * F4: with no "New proposals offer" saved, today's code must give the same content (apart from made_by, made_from, checks).
 */
const CONCIERGE: ProposalPricing = { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 };
const ESSENTIAL: ProposalPricing = { package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 };
const ENHANCED: ProposalPricing = { package: "Enhanced", base_cents: 295_000, included_classes: 2, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 };
export const FROZEN_LIST = [CONCIERGE, ESSENTIAL, ENHANCED];

const MELVIN: ConsultTranscriptTurn[] = [
  { speaker: "Rebecca", text: "For Larrytech I recommend the word mark and the logo, covering your online coaching services." },
  { speaker: "Rebecca", text: "I think the Essential package is the right fit for you." },
  { speaker: "Rebecca", text: "Because you booked the consult I'll give you a $150 credit toward the legal fee." },
  { speaker: "Rebecca", text: "And I can do 10% off the second mark since you are filing both." },
  { speaker: "Melvin Larry", text: "That sounds great, thank you." },
];

function melvinOutput(over: Partial<ConsultProposalExtract> = {}): ConsultProposalExtract {
  const base = sevetriOutput();
  return {
    ...base,
    brands: [
      {
        name: "Larrytech",
        what: "Your company name",
        note_from_attorney: null,
        marks: [
          { kind: "word", preselected: true, why_quote: "For Larrytech I recommend the word mark and the logo" },
          { kind: "logo", preselected: true, why_quote: "For Larrytech I recommend the word mark and the logo" },
        ],
        classes: [{ label: "Online Coaching Services", preselected: true, why_quote: "covering your online coaching services" }],
      },
    ],
    recommended_package: "Essential",
    credits: [{ label: "$150 credit", amount_usd: 150, percent: null, quote: "I'll give you a $150 credit toward the legal fee" }],
    second_mark_discount: { percent: 10, quote: "I can do 10% off the second mark" },
    reasoning_parts: { principle: false, risk_brand: null, risk_quote: null, fallback_brand: null, fallback_quote: null },
    ...over,
  };
}
const melvinLead = { id: "lead-melvin", firstName: "Melvin", lastName: "Larry", email: "melvin@example.com", businessName: "Larrytech" };

export { melvinOutput, MELVIN, melvinLead };

export const SCENARIOS: Record<string, () => Promise<ConsultProposalDraft>> = {
  sevetri_default: () => draftProposalFromConsult(draftInput(fakeLlm(sevetriOutput()).llm)),
  sevetri_price_override: () => {
    const out = sevetriOutput();
    out.price_changes = [{ brand: "Prosperall", amount_usd: 4000, quote: "I can do Prosperall for $4,000 instead" }];
    return draftProposalFromConsult(
      draftInput(fakeLlm(out).llm, { source: meetingSource([...SEVETRI_TURNS, { speaker: "Rebecca", text: "I can do Prosperall for $4,000 instead." }]) }),
    );
  },
  melvin_list_credit_second_mark: () =>
    draftProposalFromConsult(
      draftInput(fakeLlm(melvinOutput()).llm, { source: meetingSource(MELVIN), lead: melvinLead, packages: FROZEN_LIST, pricing: { ...standardProposalPricing({}), pricing: CONCIERGE } }),
    ),
  melvin_reduced_package: () =>
    draftProposalFromConsult(
      draftInput(
        fakeLlm(melvinOutput({ recommended_package: "Enhanced", reduced_package: { quote: "If you only want one class I can reduce the package price for you" } })).llm,
        {
          source: meetingSource([...MELVIN, { speaker: "Rebecca", text: "If you only want one class I can reduce the package price for you." }, { speaker: "Rebecca", text: "Enhanced is the one for you." }]),
          lead: melvinLead,
          packages: FROZEN_LIST,
          pricing: { ...standardProposalPricing({}), pricing: CONCIERGE },
        },
      ),
    ),
  melvin_unlisted_package: () =>
    draftProposalFromConsult(
      draftInput(fakeLlm(melvinOutput({ recommended_package: "Platinum" })).llm, {
        source: meetingSource(MELVIN),
        lead: melvinLead,
        packages: FROZEN_LIST,
        pricing: { ...standardProposalPricing({}), pricing: CONCIERGE },
      }),
    ),
};
