/**
 * Brand & Business Assessment scoring — pure, no DB, no network.
 *
 * Produces TWO outputs for ONE screen, which is the whole point of this module:
 *
 *   - the ATTENDEE side: a 0–100 score, a band, and the biggest gaps in plain
 *     English;
 *   - the STAFF side: `hot` / `warm` / `cold`, which is what Rebecca asked for
 *     — "it's going to say hot, warm, or cold, and you know right away, if this
 *     person's hot, we let the person that's helping them know".
 *
 * Temperature is deliberately NOT a restatement of the score. A well-protected
 * business with money is a relationship, not a sale; an exposed hobbyist is a
 * trademark, not a retainer.
 *
 * WHAT CHANGED ON AUG 28, AND WHAT IT COST
 * The old urgency question ("is anything in motion right now?" — infringement,
 * demand letter, dispute) was REPLACED by the timeline question, not
 * supplemented by it. So this scorer no longer detects a live legal matter, and
 * nothing forces a walk-to-the-attorney the way a cease-and-desist used to.
 * Buying intent (timeline) now carries urgency; fit (revenue, since the
 * attorney question was cut Sept 2) carries who to route to Rebecca. Fit alone
 * is never enough to force HOT — see the temperature branches below.
 */

import {
  boothQuestions,
  trackFor,
  shouldAsk,
  IMMEDIATE_TIMELINE,
  SUBSTANTIAL_REVENUE,
  Q_REVENUE,
  Q_TIMELINE,
  Q_TRACK,
  BOOTH_CATEGORIES,
  type BoothCategory,
  type BoothScoreCategory,
  type BoothTrack,
} from "./questions";

export type BoothAnswers = Record<number, string | string[] | undefined>;

export type BoothBand = "exposed" | "partial" | "protected";
export type BoothTemperature = "hot" | "warm" | "cold";
export type ValueBand = "LOW" | "MID" | "HIGH" | "PREMIUM" | "UNKNOWN";

export interface BoothScore {
  track: BoothTrack;
  /** 0–100, normalised over the categories that actually applied. */
  score: number;
  band: BoothBand;
  temperature: BoothTemperature;
  /** Up to three, worst first, written for the attendee to read. */
  gaps: string[];
  /** One line the attendee sees. */
  nextStep: string;
  /** One line only the staffer sees. */
  staffPrompt: string;
  valueBand: ValueBand;
  /** Which categories were scored, and what each earned. */
  breakdown: { category: BoothScoreCategory; earned: number; possible: number }[];
  /** True when they want help right away. */
  readyNow: boolean;
  /**
   * True when revenue is $150k+ — the general-counsel prospect this whole
   * booth exists to find. Until Sept 2 this also required "no primary
   * attorney"; that question was cut from the card, so the flag is now a
   * revenue signal and the staff prompt asks the staffer to put the attorney
   * question in person.
   */
  gcProspect: boolean;
}

export const POINTS_PER_CATEGORY = 10;

export const SUBSTANTIAL = new Set<string>(SUBSTANTIAL_REVENUE);

const VALUE_BY_REVENUE: Record<string, ValueBand> = {
  under_150k: "LOW",
  "150k_250k": "MID",
  "250k_500k": "HIGH",
  "500k_1m": "HIGH",
  over_1m: "PREMIUM",
};

export function valueBandFor(revenue: string): ValueBand {
  return VALUE_BY_REVENUE[revenue] ?? "UNKNOWN";
}

/** The staff line for a $150k+ prospect. Shared by both cards. */
export const GC_STAFF_PROMPT =
  "GENERAL COUNSEL FIT — revenue at $150k+. Ask if they have an attorney; get Rebecca to them.";

/** The one line the attendee sees. Shared by both cards. */
export function nextStepFor(temperature: BoothTemperature, band: BoothBand): string {
  return temperature === "hot"
    ? "This merits a proper conversation. Reserve a consultation while you are here."
    : band === "protected"
      ? "Your foundation is strong. Keep this for your next renewal."
      : "The full analysis will be in your inbox. Schedule a consultation when you are ready.";
}

/**
 * Gap copy, keyed by category. The first string is for a zero (nothing in
 * place), the second for a partial. Written to be read aloud by a staffer who
 * is not a lawyer — descriptive, never a recommendation.
 */
const GAP_COPY: Record<BoothCategory, { none: string; partial: string }> = {
  entity: {
    none: "No entity holds this — at present, the business is you personally.",
    partial: "The entity exists, but its records need attention.",
  },
  trademark: {
    none: "Your name and logo are not federally registered.",
    partial: "Your trademark application is filed and awaiting registration.",
  },
  ip_assets: {
    none: "Your intellectual property is not documented as the business's.",
    partial: "Only part of your intellectual property is documented as yours.",
  },
  agreements: {
    none: "Your revenue is not protected by written contracts.",
    partial: "Only part of your revenue is protected by written contracts.",
  },
};

/** Worst-first ordering when more than three gaps are open. */
const GAP_PRIORITY: BoothCategory[] = ["entity", "ip_assets", "trademark", "agreements"];

function asArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

const BUSINESS_CATEGORIES = new Set<string>(BOOTH_CATEGORIES);

function isBusinessCategory(c: BoothScoreCategory): c is BoothCategory {
  return BUSINESS_CATEGORIES.has(c);
}

export function first(value: string | string[] | undefined): string {
  return asArray(value)[0] ?? "";
}

export function bandFor(score: number): BoothBand {
  if (score >= 70) return "protected";
  if (score >= 40) return "partial";
  return "exposed";
}

export function calculateBoothScore(answers: BoothAnswers): BoothScore {
  const track = trackFor(answers[Q_TRACK]);
  const revenue = first(answers[Q_REVENUE]);
  const timeline = first(answers[Q_TIMELINE]);

  // ── The number ────────────────────────────────────────────────────────
  // Only categories whose question was actually ASKED count toward the
  // denominator, so a question hidden by branching never counts against
  // someone it could not apply to.
  const breakdown: { category: BoothCategory; earned: number; possible: number }[] = [];
  let earned = 0;
  let possible = 0;

  for (const q of boothQuestions) {
    if (!q.category || !isBusinessCategory(q.category)) continue;
    if (!shouldAsk(q, answers)) continue;

    const option = q.options.find((o) => o.value === first(answers[q.id]));
    // Unanswered scores zero but still counts — a skipped question is a gap,
    // not a discount. (The runner requires an answer, so this is defensive.)
    const points = option?.points ?? 0;

    earned += points;
    possible += POINTS_PER_CATEGORY;
    breakdown.push({ category: q.category, earned: points, possible: POINTS_PER_CATEGORY });
  }

  const score = possible === 0 ? 0 : Math.round((earned / possible) * 100);
  const band = bandFor(score);

  // ── The gaps ──────────────────────────────────────────────────────────
  const open = breakdown.filter((b) => b.earned < b.possible);
  open.sort((a, b) => {
    // Zeroes before partials, then by the fixed priority order.
    if (a.earned !== b.earned) return a.earned - b.earned;
    return GAP_PRIORITY.indexOf(a.category) - GAP_PRIORITY.indexOf(b.category);
  });
  const gaps = open
    .slice(0, 3)
    .map((b) => (b.earned === 0 ? GAP_COPY[b.category].none : GAP_COPY[b.category].partial));

  // ── The temperature ───────────────────────────────────────────────────
  const readyNow = timeline === IMMEDIATE_TIMELINE;
  const substantial = SUBSTANTIAL.has(revenue);
  const hasGaps = score < 70;
  // The retainer prospect. Revenue alone, since the attorney question left
  // the card — so this no longer forces HOT on its own: a $500k business with
  // everything in place and no hurry is a relationship to open, not a slot
  // to spend today. It surfaces through the staff prompt instead.
  const gcProspect = substantial;

  let temperature: BoothTemperature;
  if (readyNow && (substantial || hasGaps)) {
    // They said now, and there is something to actually do. Intent alone is
    // not enough — someone fully protected with no revenue who says "right
    // away" has nothing to be sold, and treating that as hot would spend a
    // staffer's best slot on the wrong person.
    //
    // The symmetric case matters just as much: fit or gaps WITHOUT urgency is
    // never enough on its own to force hot either. A $150k+ business with a
    // mid-range score who says "3+ months" is a relationship to open, not a
    // slot to spend today — that population still reaches Rebecca via
    // `gcProspect` in staffPrompt below, just without an artificial rush.
    temperature = "hot";
  } else if (readyNow || substantial || hasGaps) {
    temperature = "warm";
  } else {
    temperature = "cold";
  }

  // ── What each side is told ────────────────────────────────────────────
  const nextStep = nextStepFor(temperature, band);

  const staffPrompt = gcProspect
    ? GC_STAFF_PROMPT
    : readyNow && temperature === "hot"
      ? "They said right away. Book the consultation before they walk away."
      : temperature === "hot"
        ? "Strong fit. Book the consultation before they walk away."
        : temperature === "warm"
          ? "Capture cleanly. The follow-up does the work."
          : "Hand them their merch ticket. Don't spend the slot.";

  return {
    track,
    score,
    band,
    temperature,
    gaps,
    nextStep,
    staffPrompt,
    valueBand: valueBandFor(revenue),
    breakdown,
    readyNow,
    gcProspect,
  };
}

export type UrgencyBand = "2d" | "3d" | "5d" | "7d" | "14d" | "none";

/**
 * Follow-up window for the lead record. `crm_urgency_band` is a follow-up
 * clock, not a severity label (see 0016_pipeline.sql), so the mapping is "how
 * fast must someone touch this", not "how bad is it".
 */
export function urgencyBandFor(
  temperature: BoothTemperature,
  readyNow: boolean,
): UrgencyBand {
  if (readyNow) return "2d";
  if (temperature === "hot") return "3d";
  if (temperature === "warm") return "7d";
  return "none";
}

/**
 * A 0–1 qualification score for `crm_lead.qualification_score`. Inverted
 * against the protection score on purpose: a business with MORE gaps is a
 * better prospect for the firm, not a worse one. Temperature dominates, and
 * the protection score only breaks ties within a band.
 */
export function qualificationScoreFor(result: BoothScore): number {
  const base = result.temperature === "hot" ? 0.7 : result.temperature === "warm" ? 0.4 : 0.1;
  const exposure = ((100 - result.score) / 100) * 0.2;
  const bump = result.gcProspect ? 0.1 : 0;
  return Math.min(1, Number((base + exposure + bump).toFixed(3)));
}

/** Where the team can see this at a glance on the floor. */
export const TEMPERATURE_LABEL: Record<BoothTemperature, string> = {
  hot: "HOT",
  warm: "WARM",
  cold: "COLD",
};

export const BAND_LABEL: Record<BoothBand, string> = {
  exposed: "Exposed",
  partial: "Partially protected",
  protected: "Protected",
};
