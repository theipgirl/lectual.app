import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types.generated";
import { matterWriteRoleError, type WriteResult } from "@/lib/matters/write";

/**
 * Tasks (`crm_task`) — the firm's to-do list, and, for now, its demand queue.
 *
 * NO `org_id` FILTER, ANYWHERE IN THIS FILE. Every query runs through
 * `getScopedClient()`; RLS scopes the rows on the caller's `active_org_id`
 * claim. A redundant filter would turn a policy regression into an empty
 * screen rather than a loud failure.
 *
 * Writes read `org_id` OFF THE PARENT MATTER, never off the input — the same
 * rule, for the same reason, as everything in `@/lib/matters/write`, and the
 * role gate is imported from there so the two can never keep divergent copies
 * of the staff-role list.
 */

export type TaskRow = Database["public"]["Tables"]["crm_task"]["Row"];
export type TaskType = Database["public"]["Enums"]["crm_task_type"];
export type TaskStatus = Database["public"]["Enums"]["crm_task_status"];

function ok<T>(data: T): WriteResult<T> {
  return { ok: true, data };
}

export type TaskFilter = {
  status?: TaskStatus;
  matterId?: string;
  leadId?: string;
  assigneeId?: string;
  type?: TaskType;
};

/**
 * Tasks visible to the caller, soonest due first, undated last.
 *
 * There is no default status filter and there must not be one: a completed
 * task is part of the record of a matter, and a caller who wants only the open
 * ones says so.
 */
export async function listTasks(filter: TaskFilter = {}): Promise<TaskRow[]> {
  const supabase = await getScopedClient();
  let query = supabase.from("crm_task").select("*");

  if (filter.status) query = query.eq("status", filter.status);
  if (filter.matterId) query = query.eq("matter_id", filter.matterId);
  if (filter.leadId) query = query.eq("lead_id", filter.leadId);
  if (filter.assigneeId) query = query.eq("assignee_id", filter.assigneeId);
  if (filter.type) query = query.eq("type", filter.type);

  const { data, error } = await query.order("due_at", {
    ascending: true,
    nullsFirst: false,
  });
  if (error) throw error;
  return data ?? [];
}

export type CreateTaskInput = {
  matterId: string;
  title: string;
  type?: TaskType;
  /** Instant, ISO-8601. Tasks carry a time; deadlines carry a civil date. */
  dueAt?: string | null;
  assigneeId?: string | null;
};

/**
 * Creates a task on a matter. Staff-role-gated.
 *
 * `matterId` is required rather than optional-with-`leadId`: this app has no
 * lead surface, and an org_id read off "whichever parent happened to be
 * supplied" is exactly the kind of branch that eventually reads it off neither.
 */
export async function createTask(input: CreateTaskInput): Promise<WriteResult<TaskRow>> {
  "use server";

  const supabase = await getScopedClient();
  const roleError = await matterWriteRoleError(supabase);
  if (roleError) return { ok: false, error: roleError };

  const title = input.title?.trim();
  if (!title) {
    return { ok: false, error: { code: "invalid", message: "A task needs a title." } };
  }

  // org_id comes from here and nowhere else. A matter in another tenant is
  // invisible under RLS, so this resolves to nothing before anything is written.
  const { data: matter, error: matterError } = await supabase
    .from("crm_matter")
    .select("id, org_id")
    .eq("id", input.matterId)
    .maybeSingle();
  if (matterError) throw matterError;
  if (!matter) {
    return {
      ok: false,
      error: { code: "not-found", message: "That matter isn't available." },
    };
  }

  const { data, error } = await supabase
    .from("crm_task")
    .insert({
      org_id: matter.org_id,
      matter_id: matter.id,
      lead_id: null,
      title,
      type: input.type ?? "custom",
      due_at: input.dueAt ?? null,
      assignee_id: input.assigneeId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;

  return ok(data);
}

/** Marks a task completed. Staff-role-gated; stamps `updated_at`. */
export async function completeTask(id: string): Promise<WriteResult<TaskRow>> {
  "use server";

  const supabase = await getScopedClient();
  const roleError = await matterWriteRoleError(supabase);
  if (roleError) return { ok: false, error: roleError };

  const { data, error } = await supabase
    .from("crm_task")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return {
      ok: false,
      error: { code: "not-found", message: "That task isn't available any more." },
    };
  }

  return ok(data);
}

// ---------------------------------------------------------------------------
// The demand queue
// ---------------------------------------------------------------------------

/**
 * ⚠️ INTERIM STRING CONVENTION — A DELIBERATE SMELL, NOT AN OVERSIGHT.
 *
 * A demand is a `crm_task` with `type = 'custom'` and a title beginning
 * `"Demand: "`. There is no demand table, no settlement amount, no percentage
 * and no stage. `crm_demand` is deferred v2 schema, and schema for this
 * product lives in a different repository, so shipping the demand queue on a
 * task title is what makes it useful on day one instead of next quarter.
 *
 * The cost is stated plainly so nobody has to rediscover it: the prefix is
 * load-bearing text a human types, a renamed task silently leaves the queue,
 * and nothing here can hold the ~20%-of-settlement figure that is the actual
 * reason this queue matters. Untracked demands are money sitting still — the
 * queue exists to make that visible, not to model it.
 *
 * WHEN `crm_demand` LANDS: it backfills from exactly these rows. Match on
 * `type = 'custom' AND title LIKE 'Demand: %'`, take `demandSubject()` as the
 * description and `due_at` as the follow-up date, then delete this section.
 * Keep `DEMAND_TITLE_PREFIX` exported and unchanged until that migration has
 * run — changing the string orphans every task already written under it.
 */
export const DEMAND_TITLE_PREFIX = "Demand: ";

/** True for a title following the demand convention. Case-insensitive. */
export function isDemandTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return title.trimStart().toLowerCase().startsWith(DEMAND_TITLE_PREFIX.toLowerCase());
}

/**
 * The part of a demand task's title after the prefix — what the demand is
 * about. Falls back to the whole title when the prefix isn't there, so this is
 * safe to call on any task.
 */
export function demandSubject(title: string): string {
  const trimmed = title.trimStart();
  return isDemandTitle(trimmed) ? trimmed.slice(DEMAND_TITLE_PREFIX.length).trim() : trimmed.trim();
}

/** Builds a title that will be picked up by the queue. Use it, don't hand-type. */
export function demandTitle(subject: string): string {
  return `${DEMAND_TITLE_PREFIX}${subject.trim()}`;
}

/** A demand task with the matter identity the queue is read by. */
export type Demand = TaskRow & {
  /** For this firm, `crm_matter.matter_number` IS the court case number. */
  matter_number: string;
  matter_title: string | null;
  /** The title with the `"Demand: "` prefix stripped. */
  subject: string;
};

export type ListDemandsOptions = {
  /** Defaults to `'open'` — a sent demand has left the queue. Pass null for all. */
  status?: TaskStatus | null;
};

/**
 * The demand queue: matters sitting waiting for a demand to go out.
 *
 * `!inner` on the matter join is deliberate — a task whose matter this caller
 * cannot read is not a task this caller may read, and RLS on `crm_matter` says
 * so. Ordered soonest-first with undated rows last, which puts a demand nobody
 * has dated at the bottom rather than dropping it: an undated demand is still
 * a stalled case.
 *
 * The prefix match is re-applied in memory over the SQL `ilike`, so the
 * returned rows agree exactly with `isDemandTitle` and the convention has one
 * definition rather than two.
 */
export async function listDemands(options: ListDemandsOptions = {}): Promise<Demand[]> {
  const supabase = await getScopedClient();
  const status = options.status === undefined ? "open" : options.status;

  let query = supabase
    .from("crm_task")
    .select("*, crm_matter!inner(matter_number, title)")
    .eq("type", "custom")
    .ilike("title", `${DEMAND_TITLE_PREFIX}%`);

  if (status) query = query.eq("status", status);

  const { data, error } = await query.order("due_at", { ascending: true, nullsFirst: false });
  if (error) throw error;

  return (data ?? [])
    .map((row) => {
      const { crm_matter: matter, ...task } = row as TaskRow & {
        crm_matter: { matter_number: string; title: string | null } | null;
      };
      return {
        ...task,
        matter_number: matter?.matter_number ?? "",
        matter_title: matter?.title ?? null,
        subject: demandSubject(task.title),
      };
    })
    .filter((d) => isDemandTitle(d.title));
}

/** How many demands are waiting — the attention-strip tile on `/`. */
export async function countOpenDemands(): Promise<number> {
  return (await listDemands({ status: "open" })).length;
}
