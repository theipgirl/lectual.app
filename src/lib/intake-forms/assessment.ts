import { boothVariant, isBoothVariantId, type BoothVariantId } from "@/lib/assessment-card/variants";
import { shouldAsk, trackFor, type BoothQuestion, type BoothTrack } from "@/lib/assessment-card/questions";
import { BAND_LABEL, type BoothAnswers, type BoothBand, type BoothScore, type BoothTemperature } from "@/lib/assessment-card/score";
import { isHideable, NOT_HIDEABLE_REASON } from "@/lib/assessment-card/hideable";
import { ANSWER_MAX_LENGTH, checkChoiceAnswer, choiceFields, isChoice, isQuestionType, questionType, validateChoiceFields, type QuestionType } from "./choice";
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
 *   showScore   whether the person sees their 0–100 score and gaps at the end;
 *   extras      the firm's own questions, asked after the card and NEVER scored
 *               (Sprint 10); stored beside the card's answers, shown to staff;
 *   hidden      card questions left out, only ones nothing reads (see
 *               `assessment-card/hideable.ts`), so the score, the band, the
 *               temperature and the Lawmatics tag come out the same.
 *
 * Scoring is the SERVER's (`scoreAssessmentAnswers`), from the stored card,
 * never from the browser. The temperature is for staff only and never leaves
 * the server towards the person who took it.
 */

export const ASSESSMENT_VARIANTS = ["business", "ip"] as const satisfies readonly BoothVariantId[];

export const ASSESSMENT_LIMITS = { question: 200, subtext: 300, extras: 10 } as const;

/**
 * An extra question's id: starts with a letter, so it can never be one of the
 * card's numeric ids (the re-read and the booth-or-submission detection tell
 * extras from card answers by this).
 */
export const EXTRA_ID = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
export const isExtraAnswerId = (id: string | null | undefined): boolean => typeof id === "string" && EXTRA_ID.test(id);

/** The firm's own question after the card: the same shape as an intake question, without pack bookkeeping. */
export type ExtraQuestion = { id: string; text: string; required: boolean; type: QuestionType; options?: string[] };

export type AssessmentWording = Record<string, { question: string; subtext: string }>;

export type AssessmentSettings = {
  variant: BoothVariantId;
  wording: AssessmentWording;
  showScore: boolean;
  /** Absent (not empty) when the firm has none, so older settings read back unchanged. */
  extras?: ExtraQuestion[];
  /** Card question ids left out; absent when none. */
  hidden?: string[];
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
  const settings: AssessmentSettings = {
    variant,
    wording,
    showScore: typeof raw.showScore === "boolean" ? raw.showScore : DEFAULT_ASSESSMENT.showScore,
  };
  const extras = readExtras(raw.extras);
  if (extras.length) settings.extras = extras;
  const hidden = readHidden(variant, raw.hidden);
  if (hidden.length) settings.hidden = hidden;
  return settings;
}

function readExtras(raw: unknown): ExtraQuestion[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ExtraQuestion[] = [];
  for (const e of raw) {
    if (!isRec(e) || typeof e.id !== "string" || !EXTRA_ID.test(e.id) || seen.has(e.id)) continue;
    const text = str(e.text, ASSESSMENT_LIMITS.question);
    // A blank row is editor scratch, not a question.
    if (!text) continue;
    seen.add(e.id);
    out.push({ id: e.id, text, required: e.required === true, type: questionType(e), ...(isChoice(e) ? { options: choiceFields(e).options } : {}) });
    if (out.length === ASSESSMENT_LIMITS.extras) break;
  }
  return out;
}

function readHidden(variant: BoothVariantId, raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const on = cardIds(variant);
  return [...new Set(raw.filter((x): x is string => typeof x === "string" && on.has(x) && isHideable(variant, x)))];
}

export const assessmentExtras = (settings: Pick<AssessmentSettings, "extras">): ExtraQuestion[] => settings.extras ?? [];

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
  if (raw.extras !== undefined) {
    if (!Array.isArray(raw.extras)) errors.push("Your own questions were not readable.");
    else {
      if (raw.extras.length > ASSESSMENT_LIMITS.extras) errors.push(`Keep your own questions to ${ASSESSMENT_LIMITS.extras}.`);
      const ids = new Set<string>();
      raw.extras.forEach((e, i) => {
        const label = `Your question ${i + 1}`;
        if (!isRec(e) || typeof e.id !== "string" || !EXTRA_ID.test(e.id) || typeof e.text !== "string" || typeof e.required !== "boolean") {
          errors.push(`${label} was not readable.`);
          return;
        }
        if (ids.has(e.id)) errors.push(`${label} is a duplicate.`);
        ids.add(e.id);
        // A blank row is editor scratch: it is dropped on save, so it is not checked.
        if (!e.text.trim()) return;
        if (e.text.length > ASSESSMENT_LIMITS.question) errors.push(`${label} is longer than ${ASSESSMENT_LIMITS.question} characters.`);
        if (e.type !== undefined && !isQuestionType(e.type)) errors.push(`${label} has a type we don't know. Choose text, single choice or multiple choice.`);
        else errors.push(...validateChoiceFields(e, label));
      });
    }
  }
  if (raw.hidden !== undefined) {
    if (!Array.isArray(raw.hidden) || raw.hidden.some((x) => typeof x !== "string")) errors.push("The hidden questions were not readable.");
    else if (isBoothVariantId(raw.variant)) {
      const on = cardIds(raw.variant);
      for (const id of raw.hidden as string[]) {
        if (!on.has(id)) errors.push("A hidden question isn't on this assessment.");
        else if (!isHideable(raw.variant, id)) errors.push(`That question affects the score and can't be hidden. ${NOT_HIDEABLE_REASON}`);
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

/** An extra question as the browser gets it: wording, type and option labels. Never scored, so nothing else. */
export type PublicExtraQuestion = { id: string; text: string; required: boolean; type: QuestionType; options: string[] };

export type PublicAssessment = {
  title: string;
  trackQuestionId: number;
  /** The questions for each track, with the firm's wording applied. */
  business: PublicAssessmentQuestion[];
  brand: PublicAssessmentQuestion[];
  /** The firm's own questions, asked after the card, in the firm's order. */
  extras: PublicExtraQuestion[];
  showScore: boolean;
};

function withWording(q: BoothQuestion, wording: AssessmentWording): BoothQuestion {
  const w = wording[String(q.id)];
  if (!w) return q;
  return { ...q, question: w.question || q.question, subtext: w.subtext || q.subtext };
}

/** The card's questions for a track, with the firm's wording, minus the ones the firm hid. */
export function assessmentQuestions(settings: AssessmentSettings, track: BoothTrack): BoothQuestion[] {
  const hidden = new Set(settings.hidden ?? []);
  return boothVariant(settings.variant)
    .questionsFor(track)
    .filter((q) => !hidden.has(String(q.id)))
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
    extras: assessmentExtras(settings).map((e) => ({ id: e.id, text: e.text, required: e.required, type: e.type, options: [...(e.options ?? [])] })),
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
  // The firm's own questions: checked and stored beside the card's answers, never scored.
  for (const e of assessmentExtras(settings)) {
    const checked = isChoice(e) ? checkChoiceAnswer(e, given[e.id]) : checkTextExtra(e, given[e.id]);
    if (!checked.ok) {
      errors.push(checked.error);
      continue;
    }
    if (checked.value) answerList.push({ id: e.id, question: e.text, answer: checked.value });
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

function checkTextExtra(e: ExtraQuestion, raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const v = typeof raw === "string" ? raw.replace(/\r\n?/g, "\n").trim() : "";
  if (v.length > ANSWER_MAX_LENGTH) return { ok: false, error: `Your answer to "${e.text}" is longer than ${ANSWER_MAX_LENGTH.toLocaleString("en-US")} characters.` };
  if (!v && e.required) return { ok: false, error: `Please answer: ${e.text}` };
  return { ok: true, value: v };
}

export const TEMPERATURE_TEXT: Record<BoothTemperature, string> = { hot: "Hot", warm: "Warm", cold: "Cold" };
export const BAND_TEXT: Record<BoothBand, string> = BAND_LABEL;

/** The staff-facing summary line on the lead's timeline. */
export function assessmentStaffLine(score: BoothScore): string {
  return `Score ${score.score}/100 (${BAND_LABEL[score.band]}) · ${TEMPERATURE_TEXT[score.temperature]}${score.staffPrompt ? ` · ${score.staffPrompt}` : ""}`;
}
