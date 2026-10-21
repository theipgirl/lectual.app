import { answerText, labelsOf, questionType, type AnswerValue } from "@/lib/intake-forms/choice";
import { SUBMIT_LIMITS } from "@/lib/intake-forms/public-submit";
import type { PublicIntakeConfig } from "@/lib/intake-forms/config";
import { ChoiceControl } from "./ChoiceControl";

/**
 * The questions of the public form and of the matter request form (`/r/<token>`),
 * one list for both: a text question is the textarea it always was, a single
 * choice is a radio group, a multi choice is checkboxes. No hooks; the page
 * holds the answers and passes them in.
 */

export type FieldQuestion = PublicIntakeConfig["questions"][number];

export function QuestionFields(props: {
  questions: readonly FieldQuestion[];
  answers: Record<string, AnswerValue>;
  badFields: readonly string[];
  onChange: (id: string, value: AnswerValue) => void;
  /** The person first touched a question (focus or typing): per-step tracking. */
  onTouch?: (id: string, index: number) => void;
  /** A prefix that keeps radio group names unique when two lists share a page. */
  idPrefix?: string;
}) {
  const { questions, answers, badFields, onChange, onTouch, idPrefix = "q" } = props;
  return (
    <>
      {questions.map((q, i) => {
        const type = questionType(q);
        const required = q.required && <span className="ipub-req"> *</span>;
        if (type === "text") {
          return (
            <label key={q.id} className="ipub-field">
              <span className="ipub-label">
                {q.text}
                {required}
              </span>
              <textarea
                className="ipub-input"
                rows={3}
                maxLength={SUBMIT_LIMITS.answer}
                required={q.required}
                aria-invalid={badFields.includes(q.id) || undefined}
                value={answerText(answers[q.id])}
                onFocus={() => onTouch?.(q.id, i)}
                onChange={(e) => onChange(q.id, e.target.value)}
              />
            </label>
          );
        }
        return (
          <fieldset key={q.id} className="ipub-field ipub-choice-field" onFocus={() => onTouch?.(q.id, i)}>
            <legend className="ipub-label">
              {q.text}
              {required}
            </legend>
            <ChoiceControl
              name={`${idPrefix}-${q.id}`}
              type={type === "multi" ? "multi" : "single"}
              options={q.options ?? []}
              value={labelsOf(answers[q.id])}
              label={q.text}
              invalid={badFields.includes(q.id)}
              onChange={(next) => {
                onTouch?.(q.id, i);
                onChange(q.id, type === "multi" ? next : (next[0] ?? ""));
              }}
            />
          </fieldset>
        );
      })}
    </>
  );
}
