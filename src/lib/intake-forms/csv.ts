import { answerKey, type FormQuestionRef } from "./results";
import { parseAnswers, parseContact } from "./submission";

/**
 * The Results tab's "Export CSV", as pure functions: the encoding rules, and
 * the table built from submissions already read. The route
 * (`/dashboard/forms/export`) does the access checks and the read.
 *
 * Two rules protect the person who opens the file:
 *  - a field with a comma, a double quote or a line break is quoted, with
 *    quotes doubled, so a standard CSV parser gives the original text back;
 *  - a cell that would start with `=`, `+`, `-` or `@` (or a tab or carriage
 *    return) gets a single quote in front, so a spreadsheet shows it as text
 *    instead of running it as a formula. Answers are typed by strangers.
 */

export const CSV_BOM = "﻿";
export const CSV_MAX_ROWS = 50_000;

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function csvLine(cells: readonly string[]): string {
  return cells.map(csvCell).join(",");
}

export type CsvSubmission = {
  contact: unknown;
  answers: unknown;
  started_at: string;
  submitted_at: string | null;
};

/**
 * Name, Email, Started, Finished, then one column per question: the form's
 * questions in order, then any question found in the rows that the form no
 * longer has, in first-seen order. One row per person, including people who
 * did not finish (blank Finished, blank answers). Times are ISO 8601 (UTC).
 */
export function buildCsv(rows: readonly CsvSubmission[], questions: readonly FormQuestionRef[]): string {
  const columns: { key: string; title: string }[] = questions.map((q) => ({ key: `id:${q.id}`, title: q.text }));
  const known = new Set(columns.map((c) => c.key));
  const parsed = rows.map((r) => {
    const byKey = new Map<string, string>();
    for (const a of r.submitted_at ? parseAnswers(r.answers) : []) {
      if (!a.answer.trim()) continue;
      const key = answerKey(a);
      if (!known.has(key)) {
        known.add(key);
        columns.push({ key, title: a.question || "Question" });
      }
      byKey.set(key, a.answer);
    }
    return byKey;
  });
  const lines = [csvLine(["Name", "Email", "Started", "Finished", ...columns.map((c) => c.title)])];
  rows.forEach((r, i) => {
    const c = parseContact(r.contact);
    lines.push(csvLine([c.name, c.email, r.started_at, r.submitted_at ?? "", ...columns.map((col) => parsed[i].get(col.key) ?? "")]));
  });
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}
