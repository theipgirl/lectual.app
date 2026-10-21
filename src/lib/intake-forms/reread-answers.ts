import { boothVariant, type BoothVariantId } from "@/lib/assessment-card/variants";
import type { BoothOption, BoothQuestion } from "@/lib/assessment-card/questions";
import type { BoothAnswers, BoothScore } from "@/lib/assessment-card/score";
import type { IntakeAnswer } from "./submission";

/**
 * Reading a stored intake-assessment submission back through its card.
 *
 * The submission row keeps `score`, `band` and `temperature` but not the gaps,
 * and its answers are `{id, question, answer}` with the chosen option LABELS
 * (`scoreAssessmentAnswers` in ./assessment.ts writes them). To show the gaps
 * and the most common gaps, the labels are matched back to the card's own
 * options and the card's scorer is run again.
 *
 * It is exact for answers the card produced, and it says so when it is not:
 * any answer that cannot be matched to the card makes the whole re-read
 * `unavailable`, so a guess is never shown as a gap. The stored score is the
 * one displayed; a re-read only ever supplies the gaps.
 */

/** The IP card's ids start at 101; the Brand & Business card's end at 8. */
export const IP_CARD_MIN_ID = 100;

/** Which card an answer set was given on, read from its ids. Null when the ids mix cards or none is numeric. */
export function variantFromIds(ids: readonly (string | number)[]): BoothVariantId | null {
  const nums = ids.map((i) => Number(i)).filter((n) => Number.isInteger(n) && n > 0);
  if (nums.length === 0) return null;
  const ip = nums.filter((n) => n >= IP_CARD_MIN_ID).length;
  if (ip === 0) return "business";
  return ip === nums.length ? "ip" : null;
}

/**
 * The option values a stored label string stands for, or null when it does not
 * match. A label is matched against the question's own option list, never by
 * splitting on commas alone (a label may contain one). A multi-select answer
 * is its labels joined with ", ".
 */
export function matchOptionLabels(text: string, options: readonly BoothOption[], multiSelect: boolean): string[] | null {
  const whole = options.find((o) => o.label === text);
  if (whole) return [whole.value];
  if (!multiSelect) return null;
  const walk = (rest: string, used: string[]): string[] | null => {
    for (const o of options) {
      if (used.includes(o.value)) continue;
      if (rest === o.label) return [...used, o.value];
      if (rest.startsWith(`${o.label}, `)) {
        const found = walk(rest.slice(o.label.length + 2), [...used, o.value]);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(text, []);
}

export type RereadFailure = "no_answers" | "mixed_cards" | "unknown_question" | "duplicate_answer" | "unmatched_label" | "no_track_answer";

export type Reread =
  | { ok: true; variant: BoothVariantId; answers: BoothAnswers; score: BoothScore }
  | { ok: false; reason: RereadFailure };

/** Matches stored answers to a question list; the card-independent half of the re-read. */
export function answerValues(list: readonly IntakeAnswer[], questions: readonly BoothQuestion[]): { ok: true; answers: BoothAnswers } | { ok: false; reason: RereadFailure } {
  const answers: BoothAnswers = {};
  for (const a of list) {
    const q = questions.find((x) => String(x.id) === a.id);
    if (!q) return { ok: false, reason: "unknown_question" };
    if (answers[q.id] !== undefined) return { ok: false, reason: "duplicate_answer" };
    const values = matchOptionLabels(a.answer, q.options, !!q.multiSelect);
    if (!values) return { ok: false, reason: "unmatched_label" };
    answers[q.id] = q.multiSelect ? values : values[0];
  }
  return { ok: true, answers };
}

export function rereadAnswers(list: readonly IntakeAnswer[]): Reread {
  if (list.length === 0) return { ok: false, reason: "no_answers" };
  const variant = variantFromIds(list.map((a) => a.id ?? ""));
  if (!variant) return { ok: false, reason: list.some((a) => a.id === null) ? "unknown_question" : "mixed_cards" };
  const card = boothVariant(variant);
  const read = answerValues(list, card.questions);
  if (!read.ok) return read;
  // The track decides which questions are asked; without it the score would be a guess at the business track.
  if (read.answers[card.trackQuestionId] === undefined) return { ok: false, reason: "no_track_answer" };
  return { ok: true, variant, answers: read.answers, score: card.score(read.answers) };
}
