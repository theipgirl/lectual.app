import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types.generated";

/**
 * Server-side reads of the docket (`crm_matter_deadline`).
 *
 * NO `org_id` FILTER, ANYWHERE IN THIS FILE — ON PURPOSE
 * -----------------------------------------------------
 * Every query here runs through `getScopedClient()`, which carries the
 * caller's JWT and its `active_org_id` claim, and RLS scopes the rows. Adding
 * a belt-and-braces `.eq("org_id", …)` would not make anything safer: it would
 * make a broken policy return an empty screen instead of failing loudly, which
 * on this product means an attorney seeing "nothing is due" when something is.
 * Tenancy is the database's job and it is tested as such.
 *
 * NO NEAR-END DATE FILTER, ANYWHERE IN THIS FILE — ALSO ON PURPOSE
 * ---------------------------------------------------------------
 * A horizon bounds the FAR end only (`due_date <= horizon`). There is no
 * `due_date >= today` in this module and there must never be one. Two of the
 * deadlines on this docket are intentionally-overdue lapsed appeal windows,
 * left `status='open'` so they keep rendering at the top of the screen; a
 * near-end filter would quietly delete exactly the rows that matter most.
 * Overdue rows are the product, not noise.
 */

export type MatterDeadlineRow = Database["public"]["Tables"]["crm_matter_deadline"]["Row"];

/** A docket row with the matter identity the docket is read by. */
export type OpenDeadline = MatterDeadlineRow & {
  /** For this firm, `crm_matter.matter_number` IS the court case number. */
  matter_number: string;
  matter_title: string | null;
};

export type ListOpenDeadlinesOptions = {
  /**
   * Far-end bound in days from today: rows due on or before today + N.
   * Overdue rows are always included regardless of how far past they are —
   * this option cannot exclude them.
   */
  withinDays?: number;
  /** Cap on rows returned. Rows are ordered soonest-first, so a cap drops the
   * furthest-out rows, never the overdue ones. */
  limit?: number;
};

/** The joined shape Supabase returns for the embedded matter. */
type JoinedMatter = { matter_number: string; title: string | null } | null;

/**
 * Every OPEN deadline visible to the caller, soonest first — overdue rows at
 * the very top, since they sort earliest by date.
 *
 * `!inner` on the matter join is deliberate: a docket row whose matter is not
 * visible to this caller is not a row this caller may read, and RLS on
 * `crm_matter` says so. Urgency banding is derived at render time from
 * `due_date` (see `./urgency`), never stored and never computed here.
 */
export async function listOpenDeadlines(
  options: ListOpenDeadlinesOptions = {},
): Promise<OpenDeadline[]> {
  const supabase = await getScopedClient();

  let query = supabase
    .from("crm_matter_deadline")
    .select("*, crm_matter!inner(matter_number, title)")
    .eq("status", "open");

  if (options.withinDays != null) {
    // Far end only. Computed in UTC, which can only ever widen the window by
    // part of a day relative to Florida local time — it can never clip a row.
    const horizon = new Date();
    horizon.setUTCDate(horizon.getUTCDate() + options.withinDays);
    query = query.lte("due_date", horizon.toISOString().slice(0, 10));
  }

  query = query.order("due_date", { ascending: true });
  if (options.limit != null) query = query.limit(options.limit);

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map(flatten);
}

/**
 * Every deadline on one matter, open ones first and soonest first within that
 * — the case-file view, where satisfied and superseded rows are history worth
 * showing rather than clutter.
 */
export async function listDeadlinesForMatter(matterId: string): Promise<OpenDeadline[]> {
  const supabase = await getScopedClient();

  const { data, error } = await supabase
    .from("crm_matter_deadline")
    .select("*, crm_matter!inner(matter_number, title)")
    .eq("matter_id", matterId)
    .order("status", { ascending: true })
    .order("due_date", { ascending: true });
  if (error) throw error;

  return (data ?? []).map(flatten);
}

/** Open-deadline counts for the hero strip: "7 open · 2 overdue". */
export async function countOpenDeadlines(): Promise<number> {
  const supabase = await getScopedClient();
  const { count, error } = await supabase
    .from("crm_matter_deadline")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) throw error;
  return count ?? 0;
}

function flatten(row: MatterDeadlineRow & { crm_matter: JoinedMatter }): OpenDeadline {
  const { crm_matter: matter, ...rest } = row;
  return {
    ...rest,
    matter_number: matter?.matter_number ?? "",
    matter_title: matter?.title ?? null,
  };
}
