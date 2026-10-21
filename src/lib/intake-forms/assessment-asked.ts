import type { PublicAssessment, PublicAssessmentQuestion } from "./assessment";
import type { QuestionType } from "./choice";

/**
 * The list of questions a person on the public assessment is asked right now:
 * the card's questions for their track (the router question picks the track,
 * a question with a `showWhen` waits for its answer), then the firm's own
 * extras in the firm's order. Pure, so the order, the branching and the step
 * numbers the page reports are tested without a DOM. The step index recorded
 * for a question is its position in THIS list, so a hidden question, or one
 * skipped by branching, has no step.
 */

export type AssessmentAnswers = Record<string, string | string[]>;

export type AskedQuestion = {
  /** The key the answer is sent under: the card's numeric id, or the extra's own id. */
  key: string;
  question: string;
  subtext: string;
  type: QuestionType;
  required: boolean;
  /** `value` is what is sent; for an extra it is the label itself. */
  options: { label: string; value: string }[];
  grid: boolean;
  extra: boolean;
};

function cardAsked(q: PublicAssessmentQuestion, answers: AssessmentAnswers): boolean {
  if (!q.showWhen) return true;
  const a = answers[String(q.showWhen.qId)];
  if (Array.isArray(a)) return a.some((v) => q.showWhen!.anyOf.includes(v));
  return typeof a === "string" && q.showWhen.anyOf.includes(a);
}

export function askedQuestions(card: PublicAssessment, answers: AssessmentAnswers): AskedQuestion[] {
  const t = answers[String(card.trackQuestionId)];
  const list = (Array.isArray(t) ? t[0] : t) === "brand" ? card.brand : card.business;
  const cardQuestions: AskedQuestion[] = list
    .filter((q) => cardAsked(q, answers))
    .map((q) => ({
      key: String(q.id),
      question: q.question,
      subtext: q.subtext,
      type: q.multiSelect ? "multi" : "single",
      required: true,
      options: q.options,
      grid: q.grid,
      extra: false,
    }));
  const extras: AskedQuestion[] = card.extras.map((e) => ({
    key: e.id,
    question: e.text,
    subtext: "",
    type: e.type,
    required: e.required,
    options: e.options.map((o) => ({ label: o, value: o })),
    grid: false,
    extra: true,
  }));
  return [...cardQuestions, ...extras];
}
