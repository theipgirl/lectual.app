import { parseCivilDate } from "./ip-fields";

/**
 * Pure rules for editing a docket entry's date and title. No DB, no
 * server-only imports.
 */

export const DEADLINE_TITLE_MAX = 200;

export type DeadlineEditInput = {
  /** YYYY-MM-DD from a date input. Required: an entry always has a date. */
  dueDate?: string | null;
  /** Blank clears the title (the kind's name shows instead). */
  title?: string | null;
};

export type DeadlineEditResult =
  | {
      ok: true;
      /** Columns to write. Empty when nothing changed. */
      patch: { due_date?: string; title?: string | null };
      /** True when the date moved: the attorney confirmation must not survive it. */
      dateMoved: boolean;
      fields: ("due_date" | "title")[];
    }
  | { ok: false; error: string };

export function validateDeadlineEdit(
  input: DeadlineEditInput,
  current: { due_date: string; title: string | null },
): DeadlineEditResult {
  const patch: { due_date?: string; title?: string | null } = {};

  if (input.dueDate !== undefined) {
    let due: string | null;
    try {
      due = parseCivilDate(input.dueDate);
    } catch {
      return { ok: false, error: "Enter a real calendar date for the deadline." };
    }
    if (due === null) return { ok: false, error: "Enter the due date." };
    if (due !== current.due_date) patch.due_date = due;
  }

  if (input.title !== undefined) {
    const trimmed = (input.title ?? "").trim();
    if (trimmed.length > DEADLINE_TITLE_MAX) {
      return { ok: false, error: `Title must be ${DEADLINE_TITLE_MAX} characters or fewer.` };
    }
    const next = trimmed === "" ? null : trimmed;
    if (next !== current.title) patch.title = next;
  }

  const fields = Object.keys(patch) as ("due_date" | "title")[];
  return { ok: true, patch, dateMoved: patch.due_date !== undefined, fields };
}
