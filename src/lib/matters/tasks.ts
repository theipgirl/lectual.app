import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { listMemberDirectory } from "@/lib/members/directory";
import { requireMatterWriteRole } from "./matters";
import { logActivitySafe } from "./activity";
import { recordNotFoundError } from "./not-found";
import { validateTaskEdit, type TaskEditInput } from "./task-edit";
import { ReadableError } from "@/lib/ui/readable-error";


export type Task = Database["public"]["Tables"]["crm_task"]["Row"];

export type TaskFilter = {
  status?: string;
  matterId?: string;
  leadId?: string;
  assigneeId?: string;
};

/**
 * Lists tasks in the active org, optionally filtered by status, matter,
 * lead, or assignee. RLS scopes rows to the caller's org. Ordered by
 * due_at ascending (soonest due first), tasks with no due date last.
 */
export async function listTasks(filter: TaskFilter = {}): Promise<Task[]> {
  const supabase = await getScopedClient();
  let query = supabase.from("crm_task").select("*");

  if (filter.status) {
    query = query.eq("status", filter.status as Task["status"]);
  }
  if (filter.matterId) {
    query = query.eq("matter_id", filter.matterId);
  }
  if (filter.leadId) {
    query = query.eq("lead_id", filter.leadId);
  }
  if (filter.assigneeId) {
    query = query.eq("assignee_id", filter.assigneeId);
  }

  const { data, error } = await query.order("due_at", {
    ascending: true,
    nullsFirst: false,
  });
  if (error) throw error;
  return data ?? [];
}

export type CreateTaskInput = {
  title: string;
  leadId?: string;
  matterId?: string;
  type?: Task["type"];
  dueAt?: string;
  assigneeId?: string;
};

/**
 * Creates a task. Staff-role-gated (see MATTER_WRITE_ROLES in matters.ts).
 * org_id is never taken from the caller — it's read off the referenced lead
 * or matter row, same pattern as logActivity in activity.ts, so the
 * denormalized column used directly by RLS can never drift from the
 * parent's real org.
 */
export async function createTask(input: CreateTaskInput): Promise<Task> {
  if (!input.leadId && !input.matterId) {
    throw new ReadableError("createTask requires at least one of leadId or matterId");
  }

  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  let orgId: string;
  if (input.leadId) {
    const { data, error } = await supabase
      .from("crm_lead")
      .select("org_id")
      .eq("id", input.leadId)
      .single();
    if (error) throw error;
    orgId = data.org_id;
  } else {
    const { data, error } = await supabase
      .from("crm_matter")
      .select("org_id")
      .eq("id", input.matterId!)
      .single();
    if (error) throw error;
    orgId = data.org_id;
  }

  const { data, error } = await supabase
    .from("crm_task")
    .insert({
      org_id: orgId,
      lead_id: input.leadId ?? null,
      matter_id: input.matterId ?? null,
      title: input.title,
      type: input.type ?? "custom",
      due_at: input.dueAt ?? null,
      assignee_id: input.assigneeId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Marks a task completed. Staff-gated, stamps updated_at. */
export async function completeTask(id: string): Promise<Task> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const { data, error } = await supabase
    .from("crm_task")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/**
 * Where a task's timeline rows go: the task's own matter, else its lead. Taken
 * from the task row we just read, never from an id the form posted.
 */
function taskActivityTarget(task: Pick<Task, "matter_id" | "lead_id">): { matterId: string } | { leadId: string } | null {
  if (task.matter_id) return { matterId: task.matter_id };
  if (task.lead_id) return { leadId: task.lead_id };
  return null;
}

/**
 * Edits a task's title, due date and assignee. Staff-gated. The task is read
 * first through the scoped client (a missing or foreign id is "not found"), and
 * only the changed columns are written.
 *
 * An assignee must be a member of this firm, checked against the member
 * directory. If the directory can't be read the assignment is refused rather
 * than allowed unchecked. Clearing the assignee needs no check.
 *
 * Logs "Task edited" (field names) for a title or date change and "Task
 * assigned" (the new assignee's id, or none) for an assignee change.
 */
export async function updateTask(id: string, input: TaskEditInput): Promise<{ task: Task; fields: string[] }> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const { data: current, error: readError } = await supabase
    .from("crm_task")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) throw recordNotFoundError("task");

  const checked = validateTaskEdit(input, current);
  if (!checked.ok) throw new ReadableError(checked.error);
  if (checked.fields.length === 0) return { task: current, fields: [] };

  const newAssignee = checked.patch.assignee_id;
  if (newAssignee) {
    let members;
    try {
      members = await listMemberDirectory();
    } catch {
      throw new ReadableError("Couldn't check the team list right now, so the task wasn't reassigned. Try again.");
    }
    if (!members.some((m) => m.userId === newAssignee)) {
      throw new ReadableError("That person isn't a member of your firm.");
    }
  }

  const { data, error } = await supabase
    .from("crm_task")
    .update({ ...checked.patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;

  const target = taskActivityTarget(current);
  if (target) {
    const edited = checked.fields.filter((f) => f !== "assignee_id");
    if (edited.length > 0) {
      await logActivitySafe({
        type: "matter_updated",
        ...target,
        payload: { change: "task_edited", task_id: id, fields: edited },
      });
    }
    if (checked.patch.assignee_id !== undefined) {
      await logActivitySafe({
        type: "matter_updated",
        ...target,
        payload: { change: "task_assigned", task_id: id, title: data.title, assignee_id: newAssignee ?? null },
      });
    }
  }
  return { task: data, fields: checked.fields };
}

/**
 * Deletes a task. Staff-gated; the task is read first (a missing or foreign id
 * is "not found"). The timeline row records the title, since the task is gone.
 */
export async function deleteTask(id: string): Promise<void> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const { data: current, error: readError } = await supabase
    .from("crm_task")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw readError;
  if (!current) throw recordNotFoundError("task");

  const { data: removed, error } = await supabase.from("crm_task").delete().eq("id", id).select("id");
  if (error) throw error;
  // RLS filters a delete it doesn't allow down to zero rows without an error.
  if (!removed || removed.length === 0) throw new ReadableError("That task couldn't be deleted.");

  const target = taskActivityTarget(current);
  if (target) {
    await logActivitySafe({
      type: "matter_updated",
      ...target,
      payload: { change: "task_deleted", task_id: id, title: current.title },
    });
  }
}
