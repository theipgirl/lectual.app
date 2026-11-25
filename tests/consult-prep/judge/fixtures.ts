// Fake data for the judge tests: every name and mark here is invented. No network, no model.

import type { StructuredCall } from "@/lib/ai/claude";
import type { JudgeFacts } from "@/lib/consult-prep/judge/facts";
import type { Judgment, RoutePlan } from "@/lib/consult-prep/judge/schemas";
import { RoutePlanSchema } from "@/lib/consult-prep/judge/schemas";
import type { ProposalPricing } from "@/lib/proposals/types";

/** One firm's list (the names RPB happens to use, as DATA: the judge never knows them). Cents. */
export const PACKAGES: ProposalPricing[] = [
  { package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
  { package: "Enhanced", base_cents: 325_000, included_classes: 2, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
  { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
];

/** A different firm, with different names and prices. */
export const OTHER_PACKAGES: ProposalPricing[] = [
  { package: "Launch", base_cents: 120_000, included_classes: 1, per_class_cents: 90_000, second_mark_discount_pct: 10, gov_per_class_cents: 40_000 },
  { package: "Premier Plus", base_cents: 410_000, included_classes: 3, per_class_cents: 90_000, second_mark_discount_pct: 10, gov_per_class_cents: 40_000 },
];

export const FIRM = { name: "Harbor IP, PLLC" };

const INQUIRY =
  "I run LegacyCon, an annual conference for Black professionals, and want to register the name before we expand to Atlanta next year. We also sell a recorded course from the event.";

export const TRADEMARK_FACTS: JudgeFacts = {
  clientName: "Ms. Kenasha Paul",
  company: "Black Professionals Network",
  sessionTime: "Wed Oct 21, 2:00 PM EDT",
  practiceArea: "Trademark",
  inquiry: INQUIRY,
  mark: "LegacyCon",
  useInCommerce: "Yes, since June 2023",
  productsServices: "Annual professional-development conference, networking events, a recorded online course",
  website: "https://legacycon.example",
  referralSource: "Instagram",
  intake: [
    { label: "Please describe your legal matter", value: INQUIRY },
    { label: "BRAND NAME you want to protect", value: "LegacyCon" },
    { label: "Is the mark currently in use in commerce?", value: "Yes, since June 2023" },
    { label: "Products / Services", value: "Annual professional-development conference, networking events, a recorded online course" },
    { label: "Website", value: "https://legacycon.example" },
    { label: "How did you hear about us?", value: "Instagram" },
  ],
};

export const TRADEMARK_PLAN: RoutePlan = {
  route: "TRADEMARK",
  routeReason: "The client asks the firm to register the conference name LegacyCon; that is a filing.",
  secondaryMatter: null,
  markStatus: "confirmed",
  mark: "LegacyCon",
  stem: "legacy",
  variants: ["legacy con", "legacy conference"],
  likelyClasses: [
    { classNumber: 41, rationale: "Organizing conferences and professional-development events; the recorded course." },
    { classNumber: 35, rationale: "Business networking events for professionals." },
  ],
};

export const TRADEMARK_JUDGMENT: Judgment = {
  clientSnapshot:
    "Ms. Paul runs LegacyCon, an annual professional-development conference under Black Professionals Network. She has used the name since June 2023, sells a recorded course, and plans to expand to Atlanta next year. Found the firm through Instagram.",
  markSubmitted: "LegacyCon — word mark for the conference, networking events and the recorded course.",
  natureOfMatter: 'She wants to register LegacyCon before expanding: "want to register the name before we expand to Atlanta next year."',
  flagsToProbe: [
    "Who owns the name: Ms. Paul personally or Black Professionals Network? The intake lists both.",
    "The recorded course may need its own class coverage; confirm how it is sold.",
  ],
  questions: [
    "Is there anything else you intend to use this mark with beyond the conference and the course?",
    "How married are you to the name LegacyCon if the search turns up a close conflict?",
    "Which of these uses is going to bring in the most revenue first: the conference or the course?",
    "Should the application be filed by you personally or by Black Professionals Network?",
  ],
  trademark: {
    likelyClasses: [
      { classNumber: 41, rationale: "Conferences, summits and professional-development events; the recorded course." },
      { classNumber: 35, rationale: "Business networking events and services for professionals." },
    ],
    noClassesReason: null,
    riskRead: "Word mark. The knockout list shows a live LEGACYCON in Classes 41 and 35, a near-identical hit in the same classes. These signals lean toward a yellow-to-red read, for the attorney to confirm via TESS.",
    package: {
      choice: "Enhanced",
      reasoning: "One priority mark across two classes, and the client creates content (the recorded course). Start with Class 41, where the revenue is.",
      classesToFileNow: [41, 35],
      priorityClass: 41,
      pending: null,
      pdfMarks: [
        {
          mark: "LegacyCon",
          categories: [
            { text: "Conferences, summits and professional-development events; recorded courses", classNumber: 41, priority: true },
            { text: "Business networking events for professionals", classNumber: 35, priority: false },
          ],
        },
      ],
    },
  },
  general: null,
  dispute: null,
};

export const GENERAL_PLAN: RoutePlan = {
  route: "GENERAL",
  routeReason: 'The client asks for a contract redline; the word "trademarks" describes the subject of the license, not a filing.',
  secondaryMatter: null,
  markStatus: "none",
  mark: null,
  stem: null,
  variants: [],
  likelyClasses: [],
};

export const GENERAL_JUDGMENT: Judgment = {
  clientSnapshot: "Mr. Reyes owns Reyes Threads LLC, a streetwear clothing line, and is licensing his brand to a licensee who sent their own draft agreement.",
  markSubmitted: "None; not a trademark filing.",
  natureOfMatter: 'A contract review: "I need it redlined before we sign at the end of the month."',
  flagsToProbe: ["Deadline: signing is planned for the end of the month."],
  questions: [
    "Can you send the licensee's draft and any term sheet before the call?",
    "Which clauses worry you most: royalties, quality control, territory or term?",
    "Are your brand names registered, or only in use?",
  ],
  trademark: null,
  general: {
    scopeAndEngagement: "First deliverable: a redline of the licensee's draft trademark-license agreement. A General LOE engagement scoped in the proposal.",
    documentsNeeded: ["The licensee's draft agreement", "Any term sheet or emails setting the deal terms"],
    jurisdictionNote: null,
  },
  dispute: null,
};

export const DISPUTE_JUDGMENT: Judgment = {
  ...GENERAL_JUDGMENT,
  dispute: { disputeSnapshot: "Earliest deadline: 14 days from receipt of the letter (date to confirm). Demands: stop using the name; transfer the domain." },
};

export type LlmCall = { system: string; user: string; effort: string; maxTokens?: number; agent?: string; hasSignal: boolean };

const reply = (output: unknown) => ({
  output,
  model: "claude-sonnet-5-5",
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  costUsd: 0.01,
});

/** An `llm` answering call 1 and call 2 from canned output, recording every request. Call 1 is told apart by its schema. */
export function scriptedLlm(route: unknown, judgment: unknown): StructuredCall & { calls: LlmCall[] } {
  const calls: LlmCall[] = [];
  const fn = (async (req) => {
    calls.push({ system: req.system, user: req.user, effort: req.effort, maxTokens: req.maxTokens, agent: req.agent, hasSignal: !!req.signal });
    return reply((req.schema as unknown) === RoutePlanSchema ? route : judgment);
  }) as StructuredCall;
  return Object.assign(fn, { calls });
}

/** An `llm` that answers every call with one canned value. */
export function llmReturning(output: unknown): StructuredCall {
  return (async () => reply(output)) as StructuredCall;
}

export function llmThrowing(err: unknown): StructuredCall {
  return (async () => {
    throw err;
  }) as StructuredCall;
}
