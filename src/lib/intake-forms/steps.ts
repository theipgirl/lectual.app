import { boothVariant } from "@/lib/assessment-card/variants";
import { assessmentExtras, assessmentQuestions } from "./assessment";
import { questionType, type QuestionType } from "./choice";
import type { IntakeFormConfig } from "./config";

/**
 * Per-step tracking (Sprint 10, lectual 0096), the pure half: which questions
 * a form really asks, what a step call may carry, and what progress is kept.
 * The database half is `recordIntakeStep` in public.ts; the browser half is
 * `step-tracking.ts`. Nothing here reads a database or the environment.
 *
 * ── THE BROWSER IS NOT TRUSTED ──────────────────────────────────────────────
 * A step call names a question id and an index; the server accepts the id only
 * if it is a question of the LIVE form (a config question, a card question the
 * firm has not hidden, or one of the firm's own extras), and the index only if
 * it is a whole number from 0 to 60. Progress is rebuilt from scratch from the
 * live questions: an id the form doesn't ask, an option it doesn't offer, an
 * over-long value and anything past the size cap are dropped, never stored.
 */

export const STEP_INDEX_MAX = 60;

/** 0096's check: progress is at most 64 KB. The budget leaves room under it. */
export const PROGRESS_MAX_BYTES = 64 * 1024;
export const PROGRESS_BUDGET_BYTES = 60_000;

/** The longest value kept for one question's progress (same as a final answer). */
export const PROGRESS_VALUE_MAX = 4000;

/** Step calls allowed per client in the window: a 60-step run for one person must never trip it. */
export const STEP_LIMIT = { max: 300, windowMs: 10 * 60_000 } as const;

export function parseStepIndex(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= STEP_INDEX_MAX ? v : null;
}

export type StepQuestion = {
  id: string;
  text: string;
  type: QuestionType;
  /** Choice options. `value` is what the browser sends, `label` what is stored. Empty for text. */
  options: { value: string; label: string }[];
};

/**
 * The questions the live form asks, in order. An intake: its configured
 * questions. An assessment: the card's questions on either track (hidden ones
 * removed, the firm's wording applied), then the firm's own extras.
 */
export function stepQuestions(kind: "intake" | "assessment", config: IntakeFormConfig): StepQuestion[] {
  if (kind === "intake") {
    return config.questions
      .filter((q) => q.text.trim())
      .map((q) => ({
        id: q.id,
        text: q.text.trim(),
        type: questionType(q),
        options: (q.options ?? []).map((o) => ({ value: o, label: o })),
      }));
  }
  const out = new Map<string, StepQuestion>();
  for (const track of ["business", "brand"] as const) {
    for (const q of assessmentQuestions(config.assessment, track)) {
      const id = String(q.id);
      if (!out.has(id)) out.set(id, { id, text: q.question, type: q.multiSelect ? "multi" : "single", options: q.options.map((o) => ({ value: o.value, label: o.label })) });
    }
  }
  // Keep the card's own order (the business track lists every id).
  const cardOrder = boothVariant(config.assessment.variant).questions.map((q) => String(q.id));
  const card = [...out.values()].sort((a, b) => cardOrder.indexOf(a.id) - cardOrder.indexOf(b.id));
  const extras = assessmentExtras(config.assessment).map((e) => ({
    id: e.id,
    text: e.text,
    type: e.type,
    options: (e.options ?? []).map((o) => ({ value: o, label: o })),
  }));
  return [...card, ...extras];
}

const stripControl = (s: string) => s.replace(/\u0000/g, "").replace(/\r\n?/g, "\n");

function choiceProgress(q: StepQuestion, raw: unknown): string | null {
  const given = typeof raw === "string" ? [raw] : Array.isArray(raw) && raw.every((x) => typeof x === "string") ? (raw as string[]) : null;
  if (!given) return null;
  const known = new Set(q.options.filter((o) => given.includes(o.value)).map((o) => o.value));
  const chosen = q.options.filter((o) => known.has(o.value));
  if (chosen.length === 0) return null;
  // A single choice that names two options is not a state the form can be in.
  if (q.type !== "multi" && chosen.length > 1) return null;
  return chosen.map((o) => o.label).join(", ");
}

/**
 * What is kept of the answers so far: a plain object of question id to text,
 * in the form's question order, under the size budget. Values are text and
 * only text: they are never rendered as markup anywhere.
 */
export function sanitizeProgress(raw: unknown, questions: readonly StepQuestion[]): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const given = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const q of questions) {
    if (!Object.prototype.hasOwnProperty.call(given, q.id)) continue;
    let value: string | null;
    if (q.type === "text") {
      const v = given[q.id];
      value = typeof v === "string" ? stripControl(v).trim().slice(0, PROGRESS_VALUE_MAX) : null;
    } else value = choiceProgress(q, given[q.id]);
    if (value) out[q.id] = value;
  }
  // Past the budget the LATER answers go: the earlier ones are the ones a person finished first.
  const keys = Object.keys(out);
  while (keys.length > 0 && Buffer.byteLength(JSON.stringify(out), "utf8") > PROGRESS_BUDGET_BYTES) delete out[keys.pop() as string];
  return out;
}

/**
 * A write that failed because 0096 isn't in this database: an unknown column
 * (`42703`, or PostgREST's `PGRST204` for its schema cache), or a `step` kind
 * the event table doesn't allow yet (an enum `22P02`, or a check `23514`).
 * These read as "step data isn't recorded yet", never as an error.
 */
export function isStepSchemaError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code && ["42703", "PGRST204", "PGRST205", "22P02", "23514"].includes(err.code)) return true;
  return /schema cache|column .* does not exist|invalid input value for enum|violates check constraint/i.test(err.message ?? "");
}
