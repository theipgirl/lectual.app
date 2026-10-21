import { assessmentExtras, assessmentQuestions } from "./assessment";
import type { IntakeFormConfig } from "./config";
import type { FormQuestionRef } from "./results";

/**
 * The questions an intake asks now, in order, as `{id, text}`: its own list, or
 * the assessment card's (the firm's wording applied). Results and the CSV group
 * and name their columns from this. An assessment's own extra questions follow the card's.
 */
export function formQuestions(kind: "intake" | "assessment", config: IntakeFormConfig): FormQuestionRef[] {
  if (kind === "assessment") {
    // The card's questions (hidden ones removed), then the firm's own, in the firm's order: the CSV's column order.
    return [
      ...assessmentQuestions(config.assessment, "business").map((q) => ({ id: String(q.id), text: q.question })),
      ...assessmentExtras(config.assessment).map((e) => ({ id: e.id, text: e.text })),
    ];
  }
  return config.questions.filter((q) => q.text.trim()).map((q) => ({ id: q.id, text: q.text }));
}
