import { questionsFor, shouldAsk, trackFor, type BoothQuestion, type BoothTrack } from "@/lib/assessment-card/questions";
import { ipQuestionsFor } from "@/lib/assessment-card/ip-questions";
import { boothVariant, type BoothVariantId } from "@/lib/assessment-card/variants";
import type { BoothAnswers } from "@/lib/assessment-card/score";
import { variantFromIds } from "./reread-answers";
import { durationBetween, medianOf, percent } from "./performance";
import type { AssessmentSample } from "./results";

/**
 * Booth scorecards (`crm_booth_scorecard`, lectual 0086–0088) read as the
 * second source for the shared Results blocks, plus the event rows of the
 * Forms list.
 *
 * Two facts about the data shape everything here:
 *  - the row stores no card variant, only `track`. The variant is read from
 *    the answer ids (an id of 100 or more is the Trademark & Copyright card,
 *    otherwise Brand & Business; the id ranges are disjoint, so this is exact);
 *  - the contact step inserts the row with `answers = {}` and the finish
 *    patches it once, so an unfinished card has no recorded answers at all.
 *    The drop-off calculation is correct for partial answers and says
 *    "not recorded" when there are none, rather than presenting that as a finding.
 */

export type BoothResultRow = {
  id: string;
  event_code: string;
  track: string | null;
  score: number | null;
  band: string | null;
  temperature: string | null;
  answers: unknown;
  gaps: string[] | null;
  created_at: string;
  completed_at: string | null;
};

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);

/** Stored answers as `{ id: [values] }`: a string is one value, an array is several; anything else is dropped. */
export function boothChoices(answers: unknown): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  if (!isRec(answers)) return out;
  for (const [key, v] of Object.entries(answers)) {
    const id = Number(key);
    if (!Number.isInteger(id)) continue;
    const values = typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    const nonEmpty = values.filter((x) => x.trim() !== "");
    if (nonEmpty.length > 0) out[id] = nonEmpty;
  }
  return out;
}

export function boothAnswerIds(answers: unknown): string[] {
  return isRec(answers) ? Object.keys(answers).filter((k) => Number.isInteger(Number(k))) : [];
}

/** The card a scorecard's answers were given on; null when there are none (or the ids mix cards). */
export function boothVariantOf(answers: unknown): BoothVariantId | null {
  return variantFromIds(boothAnswerIds(answers));
}

/** The variant of an event: the one its rows' answers say; Business when no row has any. */
export function eventVariant(rows: readonly Pick<BoothResultRow, "answers">[]): BoothVariantId {
  const counts = { business: 0, ip: 0 };
  for (const r of rows) {
    const v = boothVariantOf(r.answers);
    if (v) counts[v]++;
  }
  return counts.ip > counts.business ? "ip" : "business";
}

/** The card's questions for a variant and track, with the personal-brand wording on the brand track. */
export function boothCardQuestions(variant: BoothVariantId, track: BoothTrack): BoothQuestion[] {
  return variant === "ip" ? ipQuestionsFor(track) : questionsFor(track);
}

export type LabelledAnswer = { question: string; answer: string };

/**
 * A scorecard's answers as question and chosen-option-label pairs, in the
 * card's order. Multi-select shows every chosen label. An id or value the card
 * does not know is shown as stored, never dropped.
 */
export function boothAnswerPairs(answers: unknown, track: string | null): LabelledAnswer[] {
  const choices = boothChoices(answers);
  const ids = Object.keys(choices).map(Number);
  if (ids.length === 0) return [];
  const variant = variantFromIds(ids) ?? "business";
  const card = boothVariant(variant);
  const trackAnswer = choices[card.trackQuestionId]?.[0];
  const useTrack: BoothTrack = track === "brand" || track === "business" ? track : trackFor(trackAnswer);
  const questions = boothCardQuestions(variant, useTrack);
  const known = new Set(questions.map((q) => q.id));
  const pairs: LabelledAnswer[] = [];
  for (const q of questions) {
    const chosen = choices[q.id];
    if (!chosen) continue;
    pairs.push({ question: q.question, answer: chosen.map((v) => q.options.find((o) => o.value === v)?.label ?? v).join(", ") });
  }
  for (const id of ids.filter((i) => !known.has(i)).sort((a, b) => a - b)) {
    pairs.push({ question: `Question ${id}`, answer: choices[id].join(", ") });
  }
  return pairs;
}

export function sampleFromBooth(row: BoothResultRow): AssessmentSample {
  return {
    finished: row.completed_at !== null,
    score: row.score,
    band: row.band,
    temperature: row.temperature,
    choices: boothChoices(row.answers),
    // Frozen at capture: what the attendee was shown.
    gaps: Array.isArray(row.gaps) ? row.gaps : [],
  };
}

// ── drop-off ─────────────────────────────────────────────────────────────────

export type DropOffStep = { id: number; question: string; count: number };

export type DropOff = {
  /** Cards with contact details and no finish. */
  unfinished: number;
  /** True when at least one unfinished card has a recorded answer, so stopping points mean something. */
  recorded: boolean;
  /** Every question of the card in card order, with how many unfinished cards stopped there. */
  steps: DropOffStep[];
  /** Unfinished cards with every asked question answered (nothing to name as the stop). */
  atEnd: number;
};

/**
 * For unfinished cards, the first question in the card's order with no recorded
 * answer. Questions the card does not ask for these answers (a `showWhen` that
 * is not met) are skipped, so a question that was never asked is never the stop.
 */
export function dropOffByQuestion(rows: readonly Pick<BoothResultRow, "answers" | "completed_at" | "track">[], variant: BoothVariantId): DropOff {
  const card = boothVariant(variant);
  const counts = new Map<number, number>(card.questions.map((q) => [q.id, 0]));
  let unfinished = 0;
  let recorded = false;
  let atEnd = 0;
  for (const r of rows) {
    if (r.completed_at !== null) continue;
    unfinished++;
    const choices = boothChoices(r.answers);
    if (Object.keys(choices).length > 0) recorded = true;
    const answers: BoothAnswers = {};
    for (const [id, values] of Object.entries(choices)) answers[Number(id)] = values.length === 1 ? values[0] : values;
    const stop = card.questions.find((q) => shouldAsk(q, answers) && choices[q.id] === undefined);
    if (stop) counts.set(stop.id, (counts.get(stop.id) ?? 0) + 1);
    else atEnd++;
  }
  return {
    unfinished,
    recorded,
    steps: card.questions.map((q) => ({ id: q.id, question: q.question, count: counts.get(q.id) ?? 0 })),
    atEnd,
  };
}

// ── started / finished / median ──────────────────────────────────────────────

export type EventStats = {
  started: number;
  finished: number;
  /** "54.5%", or "—". */
  completionRate: string;
  /** Milliseconds from contact details to finish, over finished cards; null when none. */
  medianMs: number | null;
};

export function boothMedianMs(rows: readonly Pick<BoothResultRow, "created_at" | "completed_at">[]): number | null {
  const durations: number[] = [];
  for (const r of rows) {
    const d = durationBetween(r.created_at, r.completed_at);
    if (d !== null) durations.push(d);
  }
  return medianOf(durations);
}

export function eventStats(rows: readonly Pick<BoothResultRow, "created_at" | "completed_at">[]): EventStats {
  const finished = rows.filter((r) => r.completed_at !== null).length;
  return { started: rows.length, finished, completionRate: percent(finished, rows.length), medianMs: boothMedianMs(rows) };
}

export type EventSummary = EventStats & { code: string; latest: string };

/** One summary per event code, most recently active first. */
export function eventSummaries(rows: readonly Pick<BoothResultRow, "event_code" | "created_at" | "completed_at">[]): EventSummary[] {
  const groups = new Map<string, typeof rows[number][]>();
  for (const r of rows) {
    const g = groups.get(r.event_code);
    if (g) g.push(r);
    else groups.set(r.event_code, [r]);
  }
  return [...groups]
    .map(([code, g]) => ({
      code,
      latest: g.reduce((max, r) => (r.created_at > max ? r.created_at : max), ""),
      ...eventStats(g),
    }))
    .sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : a.code.localeCompare(b.code)));
}

/** "All time" or a number of days; the event page's range. */
export const EVENT_RANGES = ["all", 7, 30, 90] as const;
export type EventRange = (typeof EVENT_RANGES)[number];

export function parseEventRange(v: unknown): EventRange {
  if (v === "all") return "all";
  const n = Number(v);
  return n === 7 || n === 30 || n === 90 ? n : "all";
}

export function inEventRange<T extends Pick<BoothResultRow, "created_at">>(rows: readonly T[], range: EventRange, now: Date): T[] {
  if (range === "all") return [...rows];
  const since = now.getTime() - range * 86_400_000;
  return rows.filter((r) => Date.parse(r.created_at) >= since);
}
