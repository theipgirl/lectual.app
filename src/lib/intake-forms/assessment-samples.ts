import { boothVariant } from "@/lib/assessment-card/variants";
import type { AssessmentSample } from "./results";
import { matchOptionLabels, rereadAnswers, variantFromIds } from "./reread-answers";
import { parseAnswers } from "./submission";

/**
 * One intake-assessment submission as an `AssessmentSample` (the shape the
 * distribution blocks are built from). The row stores score, band and
 * temperature; the chosen options are matched back from the stored labels, and
 * the gaps come from re-scoring them on the card (see ./reread-answers.ts).
 */

export type AssessmentSubmissionRow = {
  submitted_at: string | null;
  score: number | null;
  band: string | null;
  temperature: string | null;
  answers: unknown;
};

export function sampleFromSubmission(row: AssessmentSubmissionRow): AssessmentSample {
  const list = parseAnswers(row.answers);
  const variant = variantFromIds(list.map((a) => a.id ?? ""));
  const choices: Record<number, string[]> = {};
  if (variant) {
    const questions = boothVariant(variant).questions;
    for (const a of list) {
      const q = questions.find((x) => String(x.id) === a.id);
      const values = q ? matchOptionLabels(a.answer, q.options, !!q.multiSelect) : null;
      if (q && values) choices[q.id] = values;
    }
  }
  const reread = rereadAnswers(list);
  // Gaps are shown only when the re-score agrees with what was stored: a card that has changed since
  // would otherwise attach today's gaps to yesterday's score.
  const agrees =
    reread.ok &&
    (typeof row.score !== "number" || reread.score.score === row.score) &&
    (!row.temperature || reread.score.temperature === row.temperature);
  return {
    finished: row.submitted_at !== null,
    score: row.score,
    band: row.band,
    temperature: row.temperature,
    choices,
    gaps: reread.ok && agrees ? reread.score.gaps : null,
  };
}
