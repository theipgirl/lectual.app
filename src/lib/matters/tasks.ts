import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
import { requireMatterWriteRole } from "./matters";

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
    throw new Error("createTask requires at least one of leadId or matterId");
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
