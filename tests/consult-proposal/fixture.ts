import type { StructuredCall } from "@/lib/ai/claude";
import type { ConsultProposalExtract } from "@/lib/consult-proposal/draft";
import type { ConsultSource, ConsultTranscriptTurn, DraftConsultProposalInput } from "@/lib/consult-proposal/types";
import { standardProposalPricing } from "@/lib/proposals/types";

/**
 * A Sevetri-like consult (lectual-plugin's Prosperall / Tech4PublicGood call,
 * condensed): two brands, a word mark and a logo mark each, two classes each,
 * the Concierge package, a word-mark risk and the logo as the fallback for
 * Tech4PublicGood.
 */
export const SEVETRI_TURNS: ConsultTranscriptTurn[] = [
  { speaker: "Rebecca", text: "Thanks for joining. Tell me about Prosperall and Tech4PublicGood." },
  {
    speaker: "Sevetri Wilson",
    text: "Prosperall is our cloud software platform for cities, and we also do consulting. Tech4PublicGood is our nonprofit initiative that runs AI upskilling workshops.",
  },
  { speaker: "Rebecca", text: "Generally speaking, getting both a word mark and a logo for each brand is best practice." },
  {
    speaker: "Rebecca",
    text: "For Prosperall I recommend the word mark and the logo, covering your cloud-based software as a service and your consulting and professional services.",
  },
  {
    speaker: "Rebecca",
    text: "For Tech4PublicGood I recommend the logo and the word mark, for your charitable services and your educational workshops and AI upskilling programs.",
  },
  { speaker: "Rebecca", text: "Based on the preliminary search, the word mark for Tech4PublicGood may be difficult to register." },
  { speaker: "Rebecca", text: "If you only pick one for Tech4PublicGood, the logo is probably the stronger path." },
  { speaker: "Rebecca", text: "I think the Concierge package makes sense for you." },
  { speaker: "Sevetri Wilson", text: "Great, that sounds good." },
];

export function meetingSource(turns: ConsultTranscriptTurn[] = SEVETRI_TURNS, summary: string | null = null): ConsultSource {
  return {
    kind: "meeting",
    meetingId: "mtg-1",
    title: "Strategy call: Sevetri Wilson",
    startedAt: "2026-10-15T15:00:00Z",
    summary,
    transcript: turns,
  };
}

export function sevetriOutput(): ConsultProposalExtract {
  return {
    is_trademark_matter: true,
    recommendation_found: true,
    brands: [
      {
        name: "Prosperall",
        what: "Your company name",
        note_from_attorney: null,
        marks: [
          { kind: "word", preselected: true, why_quote: "For Prosperall I recommend the word mark and the logo" },
          { kind: "logo", preselected: true, why_quote: "For Prosperall I recommend the word mark and the logo" },
        ],
        classes: [
          { label: "Cloud-Based Software as a Service (SaaS)", preselected: true, why_quote: "covering your cloud-based software as a service" },
          { label: "Consulting & Professional Services", preselected: true, why_quote: "your consulting and professional services" },
        ],
      },
      {
        name: "Tech4PublicGood",
        what: "Your nonprofit initiative",
        note_from_attorney: "Word mark may be hard to register; logo is the stronger single option.",
        marks: [
          { kind: "logo", preselected: true, why_quote: "For Tech4PublicGood I recommend the logo and the word mark" },
          { kind: "word", preselected: true, why_quote: "For Tech4PublicGood I recommend the logo and the word mark" },
        ],
        classes: [
          { label: "Charitable Services", preselected: true, why_quote: "for your charitable services" },
          {
            label: "Educational Workshops & AI Upskilling Programs",
            preselected: true,
            why_quote: "your educational workshops and AI upskilling programs",
          },
        ],
      },
    ],
    recommended_package: "Concierge",
    price_changes: [],
    credits: [],
    recommendation_summary: "Rebecca recommended word and logo marks for Prosperall and Tech4PublicGood, two classes each, Concierge.",
    reasoning_parts: {
      principle: true,
      risk_brand: "Tech4PublicGood",
      risk_quote: "the word mark for Tech4PublicGood may be difficult to register",
      fallback_brand: "Tech4PublicGood",
      fallback_quote: "If you only pick one for Tech4PublicGood, the logo is probably the stronger path",
    },
  };
}

export function draftInput(llm: StructuredCall, over: Partial<DraftConsultProposalInput> = {}): DraftConsultProposalInput {
  return {
    source: meetingSource(),
    lead: { id: "lead-1", firstName: "Sevetri", lastName: "Wilson", email: "sevetri@example.com", businessName: "Prosperall" },
    firm: { name: "RPB Law", slug: "rpb-law", teamSignOff: "The RPB Law Team" },
    pricing: standardProposalPricing({}),
    today: "2026-10-16",
    llm,
    ...over,
  };
}
