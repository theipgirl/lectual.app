import { parseCivilDate } from "./ip-fields";

/**
 * Pure rules for editing a task's title, due date and assignee. No DB, no
 * server-only imports.
 */

export const TASK_TITLE_MAX = 200;

export type TaskEditInput = {
  title?: string | null;
  /** YYYY-MM-DD from a date input; blank clears it. */
  dueAt?: string | null;
  /** A user id; null or blank clears it. */
  assigneeId?: string | null;
};

export type TaskEditResult =
  | {
      ok: true;
      patch: { title?: string; due_at?: string | null; assignee_id?: string | null };
      fields: ("title" | "due_at" | "assignee_id")[];
    }
  | { ok: false; error: string };

/**
 * `current.due_at` is a timestamp (tasks are created with the date typed into a
 * date box, stored as that day at midnight UTC); only the day is compared.
 */
export function validateTaskEdit(
  input: TaskEditInput,
  current: { title: string; due_at: string | null; assignee_id: string | null },
): TaskEditResult {
  const patch: { title?: string; due_at?: string | null; assignee_id?: string | null } = {};

  if (input.title !== undefined) {
    const title = (input.title ?? "").trim();
    if (!title) return { ok: false, error: "Enter a task title." };
    if (title.length > TASK_TITLE_MAX) {
      return { ok: false, error: `Title must be ${TASK_TITLE_MAX} characters or fewer.` };
    }
    if (title !== current.title) patch.title = title;
  }

  if (input.dueAt !== undefined) {
    let due: string | null;
    try {
      due = parseCivilDate(input.dueAt);
    } catch {
      return { ok: false, error: "Enter a real calendar date for the due date." };
    }
    if (due !== (current.due_at ? current.due_at.slice(0, 10) : null)) patch.due_at = due;
  }

  if (input.assigneeId !== undefined) {
    const assignee = (input.assigneeId ?? "").trim() || null;
    if (assignee !== current.assignee_id) patch.assignee_id = assignee;
  }

  return { ok: true, patch, fields: Object.keys(patch) as ("title" | "due_at" | "assignee_id")[] };
}
