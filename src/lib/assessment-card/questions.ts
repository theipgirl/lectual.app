/**
 * The Brand & Business Assessment — RPB Law Firm's booth card.
 *
 * Deliberately SEPARATE from `src/lib/assessment/questions.ts`. That set is the
 * live founder funnel: 15+ IP-readiness questions, trademark-heavy, several
 * minutes long, self-serve. This one is Rebecca's list, dictated on the Aug 28
 * call — eight questions, sixty seconds, run by a staff member standing beside
 * the attendee. Changing one must never change the other.
 *
 * ORDER IS DELIBERATE AND HERS. Revenue does not lead:
 *   "You need to warm them up before you ask an annual revenue question.
 *    That's why you don't come out the gate asking that."
 * Entity comes first because it is the cheapest yes/no and the true baseline —
 * "if you don't have an entity formed, that's the baseline."
 *
 * SCORING CONTRACT (see ./score.ts)
 * Questions carrying a `category` are scored, each worth the same 10 points:
 * "if they have things in place they get a 10, if they don't they get a zero in
 * that category." Questions without a category are routers or qualifiers — they
 * steer the result and the hot/warm/cold call but never move the number.
 *
 * REMOVED Aug 28: the ownership question ("take out 'it's complicated'… I'm not
 * seeing the value that this question brings"), and the separate team-IP
 * question, which folds into the contracts one — her byline for contracts
 * already names employee contracts and NDAs.
 *
 * REMOVED Sept 2: the revenue-gated "do you have a primary attorney?" question
 * ("skip attorney question"). The general-counsel signal it fed now rests on
 * revenue alone — see ./score.ts — and the attorney question moves from the
 * card to the conversation: the staff prompt tells the staffer to ask it.
 */

export type BoothTrack = "business" | "brand";

/** The scored dimensions. Each is worth 10 points; see ./score.ts. */
export const BOOTH_CATEGORIES = [
  "entity",
  "trademark",
  "ip_assets",
  "agreements",
] as const;

export type BoothCategory = (typeof BOOTH_CATEGORIES)[number];

/** The Trademark & Copyright card's scored dimensions; see ./ip-questions.ts. */
export const BOOTH_IP_CATEGORIES = [
  "trademark",
  "clearance",
  "copyright",
  "ownership",
] as const;

export type BoothIpCategory = (typeof BOOTH_IP_CATEGORIES)[number];

/** Any category either card scores. */
export type BoothScoreCategory = BoothCategory | BoothIpCategory;

export interface BoothOption {
  label: string;
  value: string;
  /** 10 = in place, 5 = partial, 0 = gap. Omitted on unscored questions. */
  points?: 0 | 5 | 10;
}

export interface BoothQuestion {
  id: number;
  question: string;
  subtext?: string;
  options: BoothOption[];
  multiSelect?: boolean;
  layout?: "stack" | "grid";
  /** Present => scored. Absent => router/qualifier. */
  category?: BoothScoreCategory;
  /** Copy overrides for the personal-brand track. */
  brand?: { question?: string; subtext?: string };
  /** Only asked when the named question already holds one of these values. */
  showWhen?: { qId: number; anyOf: string[] };
}

export const Q_TRACK = 1;
export const Q_ENTITY = 2;
export const Q_TEAM = 3;
export const Q_REVENUE = 4;
export const Q_TRADEMARK = 5;
export const Q_COPYRIGHT = 6;
export const Q_CONTRACTS = 7;
export const Q_TIMELINE = 8;

/**
 * Revenue answers at or above $150k.
 *
 * Rebecca's rule: "if they answer that their revenue is more than 150,000…"
 * that is the general-counsel prospect. Her spoken bands broke at 100k, which
 * would have put 150k *inside* a band — so the bands carry a 150k boundary
 * instead, making the rule exact rather than approximate. This set is what
 * marks a general-counsel prospect in ./score.ts.
 */
export const SUBSTANTIAL_REVENUE = [
  "150k_250k",
  "250k_500k",
  "500k_1m",
  "over_1m",
] as const;

export const boothQuestions: BoothQuestion[] = [
  // ── 1. Router. Decides which copy the rest of the card uses. ──
  //    Subtext removed on Aug 28: "you could take that line off."
  {
    id: Q_TRACK,
    question: "Do you have a business, a personal brand, or both?",
    options: [
      { label: "A business", value: "business" },
      { label: "A personal brand", value: "brand" },
      { label: "Both", value: "both" },
    ],
  },

  // ── 2. Scored: entity. First because it is the baseline. ──
  {
    id: Q_ENTITY,
    question: "Have you formed an entity with the state?",
    subtext: "(An LLC, a corporation, or a partnership)",
    category: "entity",
    brand: {
      question: "Is there an entity behind the brand?",
      subtext: "Or does the income run through you personally?",
    },
    options: [
      { label: "Yes", value: "yes", points: 10 },
      { label: "No", value: "no", points: 0 },
      { label: "Not sure", value: "unsure", points: 0 },
    ],
  },

  // ── 3. Qualifier. ──
  {
    id: Q_TEAM,
    question: "How many employees or independent contractors do you have?",
    layout: "grid",
    options: [
      { label: "0–3", value: "0_3" },
      { label: "4–10", value: "4_10" },
      { label: "11–25", value: "11_25" },
      { label: "25+", value: "over_25" },
    ],
  },

  // ── 4. Qualifier. Feeds the value band and the hot/warm/cold call.
  //      Deliberately not first — see the module header. ──
  {
    id: Q_REVENUE,
    question: "What is your annual revenue?",
    layout: "grid",
    options: [
      { label: "Under $150k", value: "under_150k" },
      { label: "$150k – $250k", value: "150k_250k" },
      { label: "$250k – $500k", value: "250k_500k" },
      { label: "$500k – $1M", value: "500k_1m" },
      { label: "$1M+", value: "over_1m" },
    ],
  },

  // ── 5. Scored: trademark ──
  {
    id: Q_TRADEMARK,
    question: "Is your business name or logo federally registered?",
    category: "trademark",
    brand: { question: "Is your brand name or logo federally registered?" },
    options: [
      { label: "Yes, registered", value: "registered", points: 10 },
      { label: "Application pending", value: "applied", points: 5 },
      { label: "No", value: "no", points: 0 },
      { label: "Not sure", value: "unsure", points: 0 },
    ],
  },

  // ── 6. Scored: copyright.
  //      Examples rather than a count — the Copyright Act's categories number
  //      eight today (architectural works were added in 1990; the 1976 Act
  //      listed seven), so naming a number invites a correction the booth does
  //      not need. ──
  {
    id: Q_COPYRIGHT,
    question: "Does your business own its intellectual property?",
    subtext: "Copyrights — software, courses, content, music, video, photography, design.",
    category: "ip_assets",
    brand: {
      question: "Do you own your intellectual property?",
      subtext: "Copyrights — courses, content, music, video, photography, design.",
    },
    options: [
      { label: "Yes, it is all documented", value: "documented", points: 10 },
      { label: "Some of it", value: "partial", points: 5 },
      { label: "No", value: "no", points: 0 },
      { label: "I have not considered it", value: "unsure", points: 0 },
    ],
  },

  // ── 7. Scored: contracts. Absorbs the old team-IP question. ──
  {
    id: Q_CONTRACTS,
    question: "Is your revenue protected by contracts?",
    subtext:
      "Vendor and supplier contracts, employee contracts, non-disclosure agreements.",
    category: "agreements",
    brand: {
      question: "Is your income protected by contracts?",
      subtext:
        "Brand and collaboration agreements, contractor contracts, non-disclosure agreements.",
    },
    options: [
      { label: "Yes, everything is in writing", value: "all", points: 10 },
      { label: "Yes, some of it is in writing", value: "some", points: 5 },
      { label: "No, nothing is in writing", value: "none", points: 0 },
      { label: "Not sure", value: "unsure", points: 0 },
    ],
  },

  // ── 8. Timing. Replaced the old "anything in motion right now?" question on
  //      Aug 28 — note this means the card no longer detects a live dispute or
  //      demand letter, so nothing forces a walk-to-the-attorney any more. ──
  {
    id: Q_TIMELINE,
    question: "How quickly are you looking to engage legal assistance?",
    options: [
      { label: "Right away", value: "right_away" },
      { label: "In 1–2 months", value: "1_2_months" },
      { label: "In 3+ months", value: "3_plus_months" },
    ],
  },
];

/** Timeline answers that mean "now". */
export const IMMEDIATE_TIMELINE = "right_away";

/** Resolves the track from the router answer. "Both" is treated as a business. */
export function trackFor(answer: string | string[] | undefined): BoothTrack {
  const value = Array.isArray(answer) ? answer[0] : answer;
  return value === "brand" ? "brand" : "business";
}

/** True when a question should be asked given the answers so far. */
export function shouldAsk(
  q: BoothQuestion,
  answers: Record<number, string | string[] | undefined>,
): boolean {
  if (!q.showWhen) return true;
  const answer = answers[q.showWhen.qId];
  if (Array.isArray(answer)) return answer.some((v) => q.showWhen!.anyOf.includes(v));
  if (typeof answer === "string") return q.showWhen.anyOf.includes(answer);
  return false;
}

/** The question list for a track, with any brand-specific copy applied. */
export function questionsFor(track: BoothTrack): BoothQuestion[] {
  return withTrackCopy(boothQuestions, track);
}

/** Applies a card's personal-brand copy overrides when the track is "brand". */
export function withTrackCopy(questions: BoothQuestion[], track: BoothTrack): BoothQuestion[] {
  if (track === "business") return questions;
  return questions.map((q) =>
    q.brand
      ? {
          ...q,
          question: q.brand.question ?? q.question,
          subtext: q.brand.subtext ?? q.subtext,
        }
      : q,
  );
}
