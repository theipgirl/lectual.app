import { boothVariant, isBoothVariantId, type BoothVariantId } from "@/lib/assessment-card/variants";
import { shouldAsk, trackFor, type BoothQuestion, type BoothTrack } from "@/lib/assessment-card/questions";
import { BAND_LABEL, type BoothAnswers, type BoothBand, type BoothScore, type BoothTemperature } from "@/lib/assessment-card/score";
import type { IntakeAnswer } from "./submission";

/**
 * The event assessment as an intake kind (lectual 0095): RPB's booth card,
 * scored the same way, run from an intake's own link.
 *
 * The CARD (questions, options, points, the hot/warm/cold rules) lives in
 * `src/lib/assessment-card/`, ported from lectual's booth unchanged. What a
 * firm sets here is only:
 *   variant     which card: Brand & Business, or Trademark & Copyright;
 *   wording     its own words for a question's text or subtext. Options,
 *               points and order stay the card's: the score depends on them;
 *   showScore   whether the person sees their 0–100 score and gaps at the end.
 *
 * Scoring is the SERVER's (`scoreAssessmentAnswers`), from the stored card,
 * never from the browser. The temperature is for staff only and never leaves
 * the server towards the person who took it.
 */

export const ASSESSMENT_VARIANTS = ["business", "ip"] as const satisfies readonly BoothVariantId[];

export const ASSESSMENT_LIMITS = { question: 200, subtext: 300 } as const;

export type AssessmentWording = Record<string, { question: string; subtext: string }>;

export type AssessmentSettings = {
  variant: BoothVariantId;
  wording: AssessmentWording;
  showScore: boolean;
};

export const DEFAULT_ASSESSMENT: AssessmentSettings = { variant: "business", wording: {}, showScore: true };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function assessmentTitle(variant: BoothVariantId): string {
  return boothVariant(variant).title;
}

/** Every question id the card can ask (both tracks share ids). */
function cardIds(variant: BoothVariantId): Set<string> {
  return new Set(boothVariant(variant).questions.map((q) => String(q.id)));
}

/** Stored JSON → settings. Never throws; unknown ids and empty overrides are dropped. */
export function parseAssessmentSettings(raw: unknown): AssessmentSettings {
  if (!isRec(raw)) return { ...DEFAULT_ASSESSMENT, wording: {} };
  const variant = isBoothVariantId(raw.variant) ? raw.variant : DEFAULT_ASSESSMENT.variant;
  const ids = cardIds(variant);
  const wording: AssessmentWording = {};
  if (isRec(raw.wording)) {
    for (const [id, w] of Object.entries(raw.wording)) {
      if (!ids.has(id) || !isRec(w)) continue;
      const question = str(w.question, ASSESSMENT_LIMITS.question);
      const subtext = str(w.subtext, ASSESSMENT_LIMITS.subtext);
      if (question || subtext) wording[id] = { question, subtext };
    }
  }
  return { variant, wording, showScore: typeof raw.showScore === "boolean" ? raw.showScore : DEFAULT_ASSESSMENT.showScore };
}

/** A save's check: refused with a reason, never silently trimmed. */
export function validateAssessmentSettings(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!isRec(raw)) return ["The assessment settings were not readable."];
  const errors: string[] = [];
  if (!isBoothVariantId(raw.variant)) errors.push("Choose which assessment to run.");
  if (typeof raw.showScore !== "boolean") errors.push("A switch was not readable.");
  if (raw.wording !== undefined) {
    if (!isRec(raw.wording)) errors.push("The question wording was not readable.");
    else {
      const ids = isBoothVariantId(raw.variant) ? cardIds(raw.variant) : new Set<string>();
      for (const [id, w] of Object.entries(raw.wording)) {
        if (!ids.has(id) || !isRec(w)) {
          errors.push("A reworded question isn't on this assessment.");
          continue;
        }
        if (typeof w.question === "string" && w.question.length > ASSESSMENT_LIMITS.question) {
          errors.push(`A question is longer than ${ASSESSMENT_LIMITS.question} characters.`);
        }
        if (typeof w.subtext === "string" && w.subtext.length > ASSESSMENT_LIMITS.subtext) {
          errors.push(`A question's note is longer than ${ASSESSMENT_LIMITS.subtext} characters.`);
        }
      }
    }
  }
  return [...new Set(errors)];
}

/** What the browser gets per question: wording and choices, never points or categories. */
export type PublicAssessmentQuestion = {
  id: number;
  question: string;
  subtext: string;
  options: { label: string; value: string }[];
  multiSelect: boolean;
  grid: boolean;
  showWhen: { qId: number; anyOf: string[] } | null;
};

export type PublicAssessment = {
  title: string;
  trackQuestionId: number;
  /** The questions for each track, with the firm's wording applied. */
  business: PublicAssessmentQuestion[];
  brand: PublicAssessmentQuestion[];
  showScore: boolean;
};

function withWording(q: BoothQuestion, wording: AssessmentWording): BoothQuestion {
  const w = wording[String(q.id)];
  if (!w) return q;
  return { ...q, question: w.question || q.question, subtext: w.subtext || q.subtext };
}

/** The card's questions for a track, with the firm's wording. */
export function assessmentQuestions(settings: AssessmentSettings, track: BoothTrack): BoothQuestion[] {
  return boothVariant(settings.variant)
    .questionsFor(track)
    .map((q) => withWording(q, settings.wording));
}

export function publicAssessment(settings: AssessmentSettings): PublicAssessment {
  const toPublic = (q: BoothQuestion): PublicAssessmentQuestion => ({
    id: q.id,
    question: q.question,
    subtext: q.subtext ?? "",
    options: q.options.map((o) => ({ label: o.label, value: o.value })),
    multiSelect: !!q.multiSelect,
    grid: q.layout === "grid",
    showWhen: q.showWhen ? { qId: q.showWhen.qId, anyOf: [...q.showWhen.anyOf] } : null,
  });
  return {
    title: assessmentTitle(settings.variant),
    trackQuestionId: boothVariant(settings.variant).trackQuestionId,
    business: assessmentQuestions(settings, "business").map(toPublic),
    brand: assessmentQuestions(settings, "brand").map(toPublic),
    showScore: settings.showScore,
  };
}

// ── scoring (server) ─────────────────────────────────────────────────────────

/** What the person sees at the end. No temperature, no staff prompt. */
export type AssessmentResultView = {
  score: number;
  band: string;
  gaps: string[];
  nextStep: string;
};

export type ScoredAssessment = {
  score: BoothScore;
  answers: BoothAnswers;
  /** The answers as the timeline and Lawmatics note read them: question, chosen labels. */
  answerList: IntakeAnswer[];
  view: AssessmentResultView;
};

export type ScoreCheck = { ok: true; value: ScoredAssessment } | { ok: false; errors: string[] };

/**
 * The browser's answers (`{ "2": "yes", … }`) checked against the stored card:
 * every question the card would ask, given the answers so far, must have a
 * choice the card offers. Anything else is refused; an answer to a question
 * the card wouldn't ask is dropped. Then the card's own scorer runs.
 */
export function scoreAssessmentAnswers(settings: AssessmentSettings, raw: unknown): ScoreCheck {
  const given = isRec(raw) ? raw : {};
  const variant = boothVariant(settings.variant);
  const pick = (id: number): string | string[] | undefined => {
    const v = given[String(id)];
    if (typeof v === "string") return v;
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
    return undefined;
  };
  const track = trackFor(pick(variant.trackQuestionId));
  const questions = assessmentQuestions(settings, track);
  const answers: BoothAnswers = {};
  const answerList: IntakeAnswer[] = [];
  const errors: string[] = [];
  for (const q of questions) {
    if (!shouldAsk(q, answers)) continue;
    const v = pick(q.id);
    const allowed = new Set(q.options.map((o) => o.value));
    const chosen = v === undefined ? [] : Array.isArray(v) ? v : [v];
    if (chosen.length === 0 || chosen.some((c) => !allowed.has(c)) || (!q.multiSelect && chosen.length > 1)) {
      errors.push(`Please answer: ${q.question}`);
      continue;
    }
    answers[q.id] = q.multiSelect ? chosen : chosen[0];
    answerList.push({
      id: String(q.id),
      question: q.question,
      answer: chosen.map((c) => q.options.find((o) => o.value === c)?.label ?? c).join(", "),
    });
  }
  if (errors.length) return { ok: false, errors };
  const score = variant.score(answers);
  return {
    ok: true,
    value: {
      score,
      answers,
      answerList,
      view: { score: score.score, band: BAND_LABEL[score.band], gaps: score.gaps, nextStep: score.nextStep },
    },
  };
}

export const TEMPERATURE_TEXT: Record<BoothTemperature, string> = { hot: "Hot", warm: "Warm", cold: "Cold" };
export const BAND_TEXT: Record<BoothBand, string> = BAND_LABEL;

/** The staff-facing summary line on the lead's timeline. */
export function assessmentStaffLine(score: BoothScore): string {
  return `Score ${score.score}/100 (${BAND_LABEL[score.band]}) · ${TEMPERATURE_TEXT[score.temperature]}${score.staffPrompt ? ` · ${score.staffPrompt}` : ""}`;
}
