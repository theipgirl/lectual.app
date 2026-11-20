import type { StructuredCall } from "@/lib/ai/claude";
import type { ConsultProposalExtract } from "@/lib/consult-proposal/draft";
import type { ConsultSource, ConsultTranscriptTurn, DraftConsultProposalInput } from "@/lib/consult-proposal/types";
import { standardProposalPricing } from "@/lib/proposals/types";

/**
 * A Callum-like consult (lectual-plugin's Larkmoor / Open4Everyone call,
 * condensed): two brands, a word mark and a logo mark each, two classes each,
 * the Concierge package, a word-mark risk and the logo as the fallback for
 * Open4Everyone.
 */
export const CALLUM_TURNS: ConsultTranscriptTurn[] = [
  { speaker: "Rebecca", text: "Thanks for joining. Tell me about Larkmoor and Open4Everyone." },
  {
    speaker: "Callum Ferreira",
    text: "Larkmoor is our cloud software platform for cities, and we also do consulting. Open4Everyone is our nonprofit initiative that runs AI upskilling workshops.",
  },
  { speaker: "Rebecca", text: "Generally speaking, getting both a word mark and a logo for each brand is best practice." },
  {
    speaker: "Rebecca",
    text: "For Larkmoor I recommend the word mark and the logo, covering your cloud-based software as a service and your consulting and professional services.",
  },
  {
    speaker: "Rebecca",
    text: "For Open4Everyone I recommend the logo and the word mark, for your charitable services and your educational workshops and AI upskilling programs.",
  },
  { speaker: "Rebecca", text: "Based on the preliminary search, the word mark for Open4Everyone may be difficult to register." },
  { speaker: "Rebecca", text: "If you only pick one for Open4Everyone, the logo is probably the stronger path." },
  { speaker: "Rebecca", text: "I think the Concierge package makes sense for you." },
  { speaker: "Callum Ferreira", text: "Great, that sounds good." },
];

export function meetingSource(turns: ConsultTranscriptTurn[] = CALLUM_TURNS, summary: string | null = null): ConsultSource {
  return {
    kind: "meeting",
    meetingId: "mtg-1",
    title: "Strategy call: Callum Ferreira",
    startedAt: "2026-10-15T15:00:00Z",
    summary,
    transcript: turns,
  };
}

export function callumOutput(): ConsultProposalExtract {
  return {
    is_trademark_matter: true,
    recommendation_found: true,
    brands: [
      {
        name: "Larkmoor",
        what: "Your company name",
        note_from_attorney: null,
        marks: [
          { kind: "word", preselected: true, why_quote: "For Larkmoor I recommend the word mark and the logo" },
          { kind: "logo", preselected: true, why_quote: "For Larkmoor I recommend the word mark and the logo" },
        ],
        classes: [
          { label: "Cloud-Based Software as a Service (SaaS)", preselected: true, why_quote: "covering your cloud-based software as a service" },
          { label: "Consulting & Professional Services", preselected: true, why_quote: "your consulting and professional services" },
        ],
      },
      {
        name: "Open4Everyone",
        what: "Your nonprofit initiative",
        note_from_attorney: "Word mark may be hard to register; logo is the stronger single option.",
        marks: [
          { kind: "logo", preselected: true, why_quote: "For Open4Everyone I recommend the logo and the word mark" },
          { kind: "word", preselected: true, why_quote: "For Open4Everyone I recommend the logo and the word mark" },
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
    second_mark_discount: null,
    reduced_package: null,
    price_changes: [],
    credits: [],
    recommendation_summary: "Rebecca recommended word and logo marks for Larkmoor and Open4Everyone, two classes each, Concierge.",
    reasoning_parts: {
      principle: true,
      risk_brand: "Open4Everyone",
      risk_quote: "the word mark for Open4Everyone may be difficult to register",
      fallback_brand: "Open4Everyone",
      fallback_quote: "If you only pick one for Open4Everyone, the logo is probably the stronger path",
    },
  };
}

export function draftInput(llm: StructuredCall, over: Partial<DraftConsultProposalInput> = {}): DraftConsultProposalInput {
  return {
    source: meetingSource(),
    lead: { id: "lead-1", firstName: "Callum", lastName: "Ferreira", email: "callum@example.com", businessName: "Larkmoor" },
    firm: { name: "RPB Law", slug: "rpb-law", teamSignOff: "The RPB Law Team" },
    pricing: standardProposalPricing({}),
    today: "2026-10-16",
    llm,
    ...over,
  };
}
