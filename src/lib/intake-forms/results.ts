import { bandFor, BAND_LABEL, type BoothBand } from "@/lib/assessment-card/score";
import type { BoothQuestion } from "@/lib/assessment-card/questions";
import { parseAnswers, parseContact, type IntakeAnswer } from "./submission";

/**
 * The Results tab and the event page, as pure functions over rows already read
 * (the reads, with their three states, are in `load-results.ts`).
 *
 * Two shapes:
 *   per question   an intake's answers, who / when / what, newest first;
 *   distributions  an assessment's scores, bands, temperature, option counts
 *                  and most common gaps, from either an intake assessment's
 *                  submissions or a booth event's scorecards. Both sources are
 *                  turned into `AssessmentSample`s first, so the blocks that
 *                  draw them are the same components.
 */

export const ANSWERS_PER_QUESTION = 50;
export const TOP_GAPS = 5;

// ── intake forms: per question ───────────────────────────────────────────────

export type ResultSubmission = {
  id: string;
  contact: unknown;
  answers: unknown;
  started_at: string;
  submitted_at: string | null;
  lead_id: string | null;
};

export type FormQuestionRef = { id: string; text: string };

export type QuestionAnswerRow = {
  submissionId: string;
  leadId: string | null;
  who: string;
  /** ISO; the finished time, else the started time. */
  at: string;
  answer: string;
};

export type QuestionResult = {
  key: string;
  question: string;
  /** False for a question the form no longer asks (removed, or only known by its old text). */
  inForm: boolean;
  total: number;
  /** Newest first, at most ANSWERS_PER_QUESTION. */
  rows: QuestionAnswerRow[];
  capped: boolean;
};

/** Answers group by the question's id, falling back to its stored text (older rows have no id). */
export function answerKey(a: Pick<IntakeAnswer, "id" | "question">): string {
  return a.id ? `id:${a.id}` : `text:${a.question.trim().toLowerCase()}`;
}

function whoOf(contact: unknown): string {
  const c = parseContact(contact);
  return c.name || c.email || "No name given";
}

const time = (iso: string) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
};

/**
 * Per-question answers for an intake. The form's own questions come first, in
 * order (with no answers they say so); a question the form has since removed
 * follows, in first-seen order, under the text it was asked with. A reworded
 * question groups with its old answers because the id is the same. Only
 * submissions that sent answers contribute, and a blank answer is no answer.
 */
export function intakeQuestionResults(rows: readonly ResultSubmission[], questions: readonly FormQuestionRef[]): QuestionResult[] {
  const groups = new Map<string, { question: string; inForm: boolean; rows: QuestionAnswerRow[] }>();
  for (const q of questions) groups.set(`id:${q.id}`, { question: q.text, inForm: true, rows: [] });

  // Newest first so a removed question is labelled with its latest wording.
  const ordered = [...rows].sort((a, b) => time(b.submitted_at ?? b.started_at) - time(a.submitted_at ?? a.started_at));
  const seen: string[] = [];
  for (const r of ordered) {
    if (!r.submitted_at) continue;
    const who = whoOf(r.contact);
    for (const a of parseAnswers(r.answers)) {
      if (!a.answer.trim()) continue;
      const key = answerKey(a);
      let g = groups.get(key);
      if (!g) {
        g = { question: a.question || "Question", inForm: false, rows: [] };
        groups.set(key, g);
        seen.push(key);
      }
      g.rows.push({ submissionId: r.id, leadId: r.lead_id, who, at: r.submitted_at, answer: a.answer });
    }
  }
  const order = [...questions.map((q) => `id:${q.id}`), ...seen];
  return order.map((key) => {
    const g = groups.get(key)!;
    return {
      key,
      question: g.question,
      inForm: g.inForm,
      total: g.rows.length,
      rows: g.rows.slice(0, ANSWERS_PER_QUESTION),
      capped: g.rows.length > ANSWERS_PER_QUESTION,
    };
  });
}

// ── assessments: distributions ───────────────────────────────────────────────

export type AssessmentSample = {
  finished: boolean;
  score: number | null;
  band: string | null;
  temperature: string | null;
  /** Option values chosen, per question id. */
  choices: Record<number, string[]>;
  /** Null when the gaps could not be read for this person (intake re-read failed). */
  gaps: string[] | null;
};

export const SCORE_BUCKET_COUNT = 10;

/** 0–9 → 0, 10–19 → 1, … 90–100 → 9 (100 belongs to the last bucket). */
export function scoreBucket(score: number): number {
  return Math.min(SCORE_BUCKET_COUNT - 1, Math.max(0, Math.floor(score / 10)));
}

export function bucketLabel(i: number): string {
  return i === SCORE_BUCKET_COUNT - 1 ? "90–100" : `${i * 10}–${i * 10 + 9}`;
}

const BANDS: BoothBand[] = ["exposed", "partial", "protected"];

export type OptionCount = { value: string; label: string; count: number };
export type QuestionOptionCounts = {
  id: number;
  question: string;
  /** People who answered this question. */
  answered: number;
  options: OptionCount[];
  /** Values chosen that the card has no option for, shown as stored. */
  other: { value: string; count: number }[];
};

export type AssessmentResults = {
  finished: number;
  unfinished: number;
  bands: { key: BoothBand; label: string; count: number }[];
  buckets: { label: string; count: number }[];
  temperatures: { hot: number; warm: number; cold: number };
  questions: QuestionOptionCounts[];
  gaps: { text: string; count: number }[];
  /** Finished people whose gaps could be read, and those whose could not. */
  gapsRead: number;
  gapsUnread: number;
};

export function assessmentResults(samples: readonly AssessmentSample[], questions: readonly BoothQuestion[]): AssessmentResults {
  const done = samples.filter((s) => s.finished);
  const bands = new Map<BoothBand, number>(BANDS.map((b) => [b, 0]));
  const buckets = Array.from({ length: SCORE_BUCKET_COUNT }, () => 0);
  const temperatures = { hot: 0, warm: 0, cold: 0 };
  const gapCounts = new Map<string, number>();
  let gapsRead = 0;

  for (const s of done) {
    if (typeof s.score === "number" && Number.isFinite(s.score)) {
      buckets[scoreBucket(s.score)]++;
      const band = BANDS.includes(s.band as BoothBand) ? (s.band as BoothBand) : bandFor(s.score);
      bands.set(band, (bands.get(band) ?? 0) + 1);
    }
    if (s.temperature === "hot" || s.temperature === "warm" || s.temperature === "cold") temperatures[s.temperature]++;
    if (s.gaps) {
      gapsRead++;
      for (const g of new Set(s.gaps)) gapCounts.set(g, (gapCounts.get(g) ?? 0) + 1);
    }
  }

  const questionCounts: QuestionOptionCounts[] = questions.map((q) => {
    const counts = new Map<string, number>(q.options.map((o) => [o.value, 0]));
    const other = new Map<string, number>();
    let answered = 0;
    for (const s of done) {
      const chosen = s.choices[q.id];
      if (!chosen || chosen.length === 0) continue;
      answered++;
      for (const v of new Set(chosen)) {
        if (counts.has(v)) counts.set(v, (counts.get(v) ?? 0) + 1);
        else other.set(v, (other.get(v) ?? 0) + 1);
      }
    }
    return {
      id: q.id,
      question: q.question,
      answered,
      options: q.options.map((o) => ({ value: o.value, label: o.label, count: counts.get(o.value) ?? 0 })),
      other: [...other].map(([value, count]) => ({ value, count })),
    };
  });

  return {
    finished: done.length,
    unfinished: samples.length - done.length,
    bands: BANDS.map((key) => ({ key, label: BAND_LABEL[key], count: bands.get(key) ?? 0 })),
    buckets: buckets.map((count, i) => ({ label: bucketLabel(i), count })),
    temperatures,
    questions: questionCounts,
    gaps: [...gapCounts]
      .map(([text, count]) => ({ text, count }))
      .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text))
      .slice(0, TOP_GAPS),
    gapsRead,
    gapsUnread: done.length - gapsRead,
  };
}
