/**
 * Choice questions (Sprint 10): a question is free text, a single choice or a
 * multi choice with 2 to 12 options. Pure: the config editor, the save check,
 * the public form, the request form and the step progress all read this one
 * module, so they cannot disagree about a limit, a label or what is stored.
 *
 * ── WHAT IS STORED ──────────────────────────────────────────────────────────
 * The option LABEL, as text. A later rename of an option does not rewrite old
 * answers, and everything that reads answers (timeline, Lawmatics note,
 * Results, CSV) keeps working because a stored answer is still plain text. A
 * multi answer is its labels joined with ", " in the question's option order
 * (the same way the assessment card stores one). Labels may contain commas,
 * so nothing splits a stored answer on commas.
 *
 * ── THE BROWSER SENDS LABELS, NOT POSITIONS ─────────────────────────────────
 * `checkChoiceAnswer` matches each submitted label against the STORED
 * question's options. An unknown label, a second label on a single choice, a
 * repeat in a multi, or a value that is not a string or a list of strings is
 * refused with a sentence that names the question.
 */

export const QUESTION_TYPES = ["text", "single", "multi"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** The longest stored answer to a text question (also `SUBMIT_LIMITS.answer`). */
export const ANSWER_MAX_LENGTH = 4000;

export const CHOICE_LIMITS = { option: 120, minOptions: 2, maxOptions: 12 } as const;

export type ChoiceFields = { type?: QuestionType; options?: string[] };

export const isQuestionType = (v: unknown): v is QuestionType => typeof v === "string" && (QUESTION_TYPES as readonly string[]).includes(v);

/** A question with no type is text, as every config written before Sprint 10. */
export function questionType(q: { type?: unknown }): QuestionType {
  return isQuestionType(q.type) ? q.type : "text";
}

export const isChoice = (q: { type?: unknown }): boolean => questionType(q) !== "text";

const oneLine = (s: string) => !/[\r\n\u2028\u2029]/.test(s);

/** Lenient read of stored options: trimmed, cut, blanks and repeats dropped, at most 12. Never throws. */
export function readOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of raw) {
    if (typeof o !== "string") continue;
    const label = o.replace(/[\r\n\u2028\u2029]+/g, " ").trim().slice(0, CHOICE_LIMITS.option);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.push(label);
    if (out.length === CHOICE_LIMITS.maxOptions) break;
  }
  return out;
}

/**
 * The stored shape of a question's choice fields. A text question carries
 * neither key, so an old config parses to exactly what it was and a saved text
 * question adds nothing to the JSON.
 */
export function choiceFields(raw: { type?: unknown; options?: unknown }): ChoiceFields {
  const type = questionType(raw);
  if (type === "text") return {};
  return { type, options: readOptions(raw.options) };
}

/**
 * The save check for one question's choice fields ("Question 3" is the label
 * the message names). Strict: nothing is trimmed silently, because a firm
 * should not find its option cut in half on the public page.
 */
export function validateChoiceFields(raw: { type?: unknown; options?: unknown }, label: string): string[] {
  const errors: string[] = [];
  if (raw.type !== undefined && !isQuestionType(raw.type)) {
    errors.push(`${label} has a type we don't know. Choose text, single choice or multiple choice.`);
    return errors;
  }
  const type = questionType(raw);
  if (type === "text") {
    if (Array.isArray(raw.options) ? raw.options.length > 0 : raw.options !== undefined && raw.options !== null) {
      errors.push(`${label} is a text question, so it can't have options.`);
    }
    return errors;
  }
  if (!Array.isArray(raw.options)) {
    errors.push(`${label} needs at least ${CHOICE_LIMITS.minOptions} options.`);
    return errors;
  }
  if (raw.options.length > CHOICE_LIMITS.maxOptions) errors.push(`${label} can have at most ${CHOICE_LIMITS.maxOptions} options.`);
  if (raw.options.length < CHOICE_LIMITS.minOptions) errors.push(`${label} needs at least ${CHOICE_LIMITS.minOptions} options.`);
  const seen = new Set<string>();
  raw.options.forEach((o, i) => {
    const n = i + 1;
    if (typeof o !== "string") {
      errors.push(`Option ${n} of ${label} was not readable.`);
      return;
    }
    const t = o.trim();
    if (!t) errors.push(`Option ${n} of ${label} is empty.`);
    else if (!oneLine(o)) errors.push(`Option ${n} of ${label} must be on one line.`);
    else if (t.length > CHOICE_LIMITS.option) errors.push(`Option ${n} of ${label} is longer than ${CHOICE_LIMITS.option} characters.`);
    else if (seen.has(t.toLowerCase())) errors.push(`${label} lists "${t}" more than once.`);
    seen.add(t.toLowerCase());
  });
  return errors;
}

// ── answers ──────────────────────────────────────────────────────────────────

export type ChoiceQuestion = { text: string; required: boolean; type?: QuestionType; options?: readonly string[] };

export type ChoiceAnswer = { ok: true; value: string; labels: string[] } | { ok: false; error: string };

/** The labels in a submitted value: a string is one label, a list of strings is many. Null when it is neither. */
function submittedLabels(raw: unknown): string[] | null {
  if (raw === undefined || raw === null) return [];
  if (typeof raw === "string") return raw.trim() ? [raw.trim()] : [];
  if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) return (raw as string[]).map((x) => x.trim()).filter(Boolean);
  return null;
}

/**
 * One choice answer, checked against the stored question. `value` is the text
 * to store ("" when unanswered and optional); `labels` are the chosen options
 * in the question's own order.
 */
export function checkChoiceAnswer(q: ChoiceQuestion, raw: unknown): ChoiceAnswer {
  const question = q.text.trim();
  const options = q.options ?? [];
  const given = submittedLabels(raw);
  if (given === null) return { ok: false, error: `We couldn't read your answer to: ${question}` };
  if (given.length === 0) {
    return q.required ? { ok: false, error: `Please answer: ${question}` } : { ok: true, value: "", labels: [] };
  }
  if (given.some((g) => !options.includes(g))) return { ok: false, error: `Please choose one of the listed answers for: ${question}` };
  if (new Set(given).size !== given.length) return { ok: false, error: `Each choice for "${question}" can be picked only once.` };
  if (q.type !== "multi" && given.length > 1) return { ok: false, error: `Please choose only one answer for: ${question}` };
  const labels = options.filter((o) => given.includes(o));
  return { ok: true, value: labels.join(", "), labels };
}

// ── the browser's answer state ───────────────────────────────────────────────

/** An answer as the page holds it: text, one label, or a list of labels for a multi choice. */
export type AnswerValue = string | string[];

/** The chosen labels in an answer value ("" and [] are none). */
export function labelsOf(value: AnswerValue | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

/** An answer value as one line of text: what the thread shows. */
export function answerText(value: AnswerValue | undefined): string {
  return Array.isArray(value) ? value.join(", ") : (value ?? "");
}

/** A multi choice with one label switched on or off, kept in the question's option order. */
export function toggleLabel(options: readonly string[], current: readonly string[], label: string): string[] {
  const next = current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
  return options.filter((o) => next.includes(o));
}

// ── editor helpers (pure, so they are tested) ────────────────────────────────

export const TYPE_LABEL: Record<QuestionType, string> = { text: "Free text", single: "Single choice", multi: "Multiple choice" };

/**
 * Switching a question's type. Text drops its options (nothing hidden stays in
 * the saved config); a choice question starts with two empty options so the
 * firm sees what to fill in; single and multi keep what was typed.
 */
export function withType(q: { type?: QuestionType; options?: string[] }, next: QuestionType): ChoiceFields {
  if (next === "text") return {};
  const options = q.options && q.options.length > 0 ? q.options : ["", ""];
  return { type: next, options };
}

/** Moves item `i` by `delta`; out of range is a no-op. */
export function moveItem<T>(list: readonly T[], i: number, delta: -1 | 1): T[] {
  const j = i + delta;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
