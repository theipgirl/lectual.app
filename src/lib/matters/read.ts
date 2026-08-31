import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types.generated";
import { listMatterStages, indexStagesById, type MatterStage } from "./stages";

/**
 * Server-side reads of the caseload (`crm_matter`) and of one matter's whole
 * file.
 *
 * NO `org_id` FILTER, ANYWHERE IN THIS FILE — ON PURPOSE
 * -----------------------------------------------------
 * Every query runs through `getScopedClient()`, which carries the caller's JWT
 * and its `active_org_id` claim, and RLS scopes the rows. A belt-and-braces
 * `.eq("org_id", …)` would not make anything safer: it would make a broken
 * policy return an empty screen instead of failing loudly, and on this product
 * an empty screen is indistinguishable from "nothing is due".
 *
 * NO `stage_id IS NOT NULL` FILTER, ANYWHERE IN THIS FILE — ALSO ON PURPOSE
 * ------------------------------------------------------------------------
 * 22 of this firm's 34 live litigation matters carry `stage_id IS NULL`:
 * deliberately unplaced, awaiting the attorney's judgment. They are returned
 * with `stage: null`, which is the honest answer, and `buildBoard` puts them
 * in its always-rendered `unstaged` lane. Any read that quietly dropped them
 * would delete 65% of her live caseload from the screen — the single
 * highest-consequence rendering bug available in this app.
 *
 * The stage join is done in memory rather than as a PostgREST embed. A firm
 * has a few dozen stages, so one extra scoped SELECT serves a whole page of
 * matters, and the embed's shape (which varies with how PostgREST resolves the
 * composite `(stage_id, org_id)` FK) never leaks into these types. It also
 * means a `stage_id` pointing at a row the caller cannot see resolves to
 * `stage: null` instead of dropping the matter.
 */

export type MatterRow = Database["public"]["Tables"]["crm_matter"]["Row"];
export type LitigationDetailRow =
  Database["public"]["Tables"]["crm_litigation_detail"]["Row"];
export type ContactRow = Database["public"]["Tables"]["crm_contact"]["Row"];
export type TaskRow = Database["public"]["Tables"]["crm_task"]["Row"];
export type ActivityRow = Database["public"]["Tables"]["crm_activity"]["Row"];

/**
 * A matter as the read surfaces consume it: the row plus the stage its
 * `stage_id` points at, resolved. `stage` is null for an unplaced matter and
 * that is a first-class state, never an error and never a reason to filter.
 */
export type Matter = MatterRow & { stage: MatterStage | null };

/** A contact linked to a matter, carrying the role the link records. */
export type MatterContact = ContactRow & { link_role: string };

/** One matter's whole file, as `/matter/[id]` renders it. */
export type MatterFile = {
  matter: Matter;
  /** Null when the matter has no litigation facts recorded (or isn't LIT). */
  litigation: LitigationDetailRow | null;
  /** Client and any other linked parties, client-role rows first. */
  contacts: MatterContact[];
  /** Every task on the matter, open ones first, soonest due first. */
  tasks: TaskRow[];
  /** The tail of the timeline, newest first. Fees are read separately. */
  activity: ActivityRow[];
};

export type ListMattersFilter = {
  /** `crm_matter.status` — free text in this schema, so passed through as-is. */
  status?: string;
  /** Restrict to one matter type. Omitted means every practice. */
  type?: MatterRow["type"];
  leadId?: string;
  assigneeId?: string;
};

/**
 * Every matter visible to the caller, newest first, each with its stage
 * resolved.
 *
 * Newest-first (by `opened_at`, falling back to insertion order via
 * `created_at`) rather than by stage: the board does the stage arrangement
 * downstream, and a stage-ordered read would tempt a caller into treating the
 * query as the board and losing the unstaged lane.
 */
export async function listMatters(filter: ListMattersFilter = {}): Promise<Matter[]> {
  const supabase = await getScopedClient();
  let query = supabase.from("crm_matter").select("*");

  if (filter.status) query = query.eq("status", filter.status);
  if (filter.type) query = query.eq("type", filter.type);
  if (filter.leadId) query = query.eq("lead_id", filter.leadId);
  if (filter.assigneeId) query = query.eq("assigned_to", filter.assigneeId);

  const { data, error } = await query
    .order("opened_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw error;

  return withStages(data ?? []);
}

/**
 * One matter with its stage resolved, or null when it does not exist or is not
 * visible under RLS. Those two cases are deliberately indistinguishable.
 */
export async function getMatter(id: string): Promise<Matter | null> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_matter")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return (await withStages([data]))[0] ?? null;
}

export type GetMatterFileOptions = {
  /** How many timeline rows to read back. Newest first. */
  activityLimit?: number;
};

/**
 * One matter's whole file: the matter, its litigation facts, its contacts, its
 * tasks and the tail of its timeline.
 *
 * The sub-reads run concurrently and each is independently RLS-scoped, so a
 * caller who can see the matter but not (say) its contacts gets an empty
 * contacts list rather than a failed page. Nothing here is filtered by
 * `org_id`, and nothing is filtered by status: a satisfied deadline, a
 * completed task and a closed-out note are the file's history, and the case
 * file is exactly where history belongs.
 *
 * Deadlines are NOT read here — `@/lib/deadlines/read` owns the docket and its
 * "no near-end date filter" rule, and duplicating that query would eventually
 * duplicate the rule badly. Fees are likewise `@/lib/fees`'s job.
 */
export async function getMatterFile(
  id: string,
  options: GetMatterFileOptions = {},
): Promise<MatterFile | null> {
  const matter = await getMatter(id);
  if (!matter) return null;

  const supabase = await getScopedClient();
  const activityLimit = options.activityLimit ?? 30;

  const [litigation, contacts, tasks, activity] = await Promise.all([
    (async (): Promise<LitigationDetailRow | null> => {
      const { data, error } = await supabase
        .from("crm_litigation_detail")
        .select("*")
        .eq("matter_id", id)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    })(),
    listMatterContacts(supabase, id),
    (async (): Promise<TaskRow[]> => {
      const { data, error } = await supabase
        .from("crm_task")
        .select("*")
        .eq("matter_id", id)
        // Open before completed/cancelled: the enum's text order puts
        // 'cancelled' first, so status is sorted by an explicit rank below
        // instead of in SQL.
        .order("due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return sortTasksOpenFirst(data ?? []);
    })(),
    (async (): Promise<ActivityRow[]> => {
      const { data, error } = await supabase
        .from("crm_activity")
        .select("*")
        .eq("matter_id", id)
        .order("created_at", { ascending: false })
        .limit(activityLimit);
      if (error) throw error;
      return data ?? [];
    })(),
  ]);

  return { matter, litigation, contacts, tasks, activity };
}

/**
 * The contacts on a matter, client-role rows first.
 *
 * Two plain queries rather than a foreign-table embed: `crm_matter_contact`
 * reaches `crm_contact` through a composite `(contact_id, org_id)` FK, and
 * PostgREST's rendering of those is the kind of thing that changes shape under
 * you. Both queries are RLS-scoped, so a link row pointing at a contact the
 * caller cannot see simply yields no contact rather than an error.
 */
async function listMatterContacts(
  supabase: Awaited<ReturnType<typeof getScopedClient>>,
  matterId: string,
): Promise<MatterContact[]> {
  const { data: links, error: linkError } = await supabase
    .from("crm_matter_contact")
    .select("contact_id, role")
    .eq("matter_id", matterId);
  if (linkError) throw linkError;
  if (!links || links.length === 0) return [];

  const roleById = new Map(links.map((l) => [l.contact_id, l.role]));
  const { data: contacts, error } = await supabase
    .from("crm_contact")
    .select("*")
    .in("id", [...roleById.keys()]);
  if (error) throw error;

  return (contacts ?? [])
    .map((c) => ({ ...c, link_role: roleById.get(c.id) ?? "" }))
    .sort((a, b) => rankContactRole(a.link_role) - rankContactRole(b.link_role));
}

function rankContactRole(role: string): number {
  return role.trim().toLowerCase() === "client" ? 0 : 1;
}

/** Open tasks first, then everything else, each already in due-date order. */
function sortTasksOpenFirst(tasks: TaskRow[]): TaskRow[] {
  const rank = (t: TaskRow): number => (t.status === "open" ? 0 : t.status === "snoozed" ? 1 : 2);
  return [...tasks].sort((a, b) => rank(a) - rank(b));
}

/**
 * Attaches each row's stage. One scoped SELECT for the whole batch, skipped
 * entirely when nothing in the batch is staged — which, on this docket, is a
 * live case rather than a hypothetical. A `stage_id` that resolves to nothing
 * yields `stage: null`, the same honest "not on the docket" an unplaced matter
 * gets, rather than throwing.
 */
async function withStages(rows: MatterRow[]): Promise<Matter[]> {
  if (rows.length === 0) return [];
  if (!rows.some((r) => r.stage_id)) return rows.map((r) => ({ ...r, stage: null }));

  const byId = indexStagesById(await listMatterStages());
  return rows.map((r) => ({ ...r, stage: (r.stage_id && byId.get(r.stage_id)) || null }));
}
