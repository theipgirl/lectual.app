import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { Lead, Stage } from "@/lib/pipeline";
import { INTAKE_PRACTICE_AREA_FILTER } from "./counts";
import type { LostRead } from "./sets";

/**
 * The Lost set's OWN reads. Scoped client only. Lost leads are not in the Leads list (intake scope is open and nurture
 * stages), and widening that scope would change the rail's Intake badge and the Pipeline column, which share it. So:
 *   - `lostStageIds` are the stages whose category is `lost` (any position);
 *   - `readLostCount` is one head count (no rows), run on every render for the chip;
 *   - `listLostLeads` runs ONLY when the Lost set is chosen, newest activity first, capped at LOST_LIST_CAP.
 * Neither feeds the rail badge, the Pipeline, Working or All open. A failed read is `unavailable`, never 0.
 */
export const LOST_LIST_CAP = 500;

export function lostStageIds(stages: readonly Stage[]): string[] {
  return stages.filter((s) => s.category === "lost").map((s) => s.id);
}

export async function readLostCount(stages: readonly Stage[]): Promise<LostRead> {
  const ids = lostStageIds(stages);
  if (ids.length === 0) return { status: "none" };
  try {
    const db = await getScopedClient();
    const { count, error } = await db.from("crm_lead").select("id", { count: "exact", head: true }).in("current_stage_id", ids).or(INTAKE_PRACTICE_AREA_FILTER);
    if (error || count === null || count === undefined) return { status: "unavailable" };
    return { status: "ok", count };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * The NURTURE leads the intake scope does not reach (a Long-Term Nurture stage placed after the first won stage is not an
 * "intake" stage), by their own read: leads in `nurture`-category stages, trademark or unknown practice area, minus the
 * ones the page already loaded. Three states: ok / unavailable / none (the firm has no nurture stage). It feeds the board's
 * Long-Term Nurture column and the Nurture set only: never the rail badge, the Pipeline, Working or All open.
 */
export const NURTURE_LIST_CAP = 1000;
export type NurtureExtra = { status: "ok"; leads: Lead[] } | { status: "unavailable" } | { status: "none" };

export async function readNurtureExtra(stages: readonly Stage[], loadedIds: ReadonlySet<string>): Promise<NurtureExtra> {
  const ids = stages.filter((s) => s.category === "nurture").map((s) => s.id);
  if (ids.length === 0) return { status: "none" };
  try {
    const db = await getScopedClient();
    const { data, error } = await db
      .from("crm_lead")
      .select("*")
      .in("current_stage_id", ids)
      .or(INTAKE_PRACTICE_AREA_FILTER)
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .limit(NURTURE_LIST_CAP);
    if (error) return { status: "unavailable" };
    return { status: "ok", leads: (data ?? []).filter((l) => !loadedIds.has(l.id)) };
  } catch {
    return { status: "unavailable" };
  }
}

export type LostLeads = { status: "ok"; leads: Lead[]; total: number } | { status: "unavailable" };

export async function listLostLeads(stages: readonly Stage[]): Promise<LostLeads> {
  const ids = lostStageIds(stages);
  if (ids.length === 0) return { status: "ok", leads: [], total: 0 };
  try {
    const db = await getScopedClient();
    const { data, error, count } = await db
      .from("crm_lead")
      .select("*", { count: "exact" })
      .in("current_stage_id", ids)
      .or(INTAKE_PRACTICE_AREA_FILTER)
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .limit(LOST_LIST_CAP);
    if (error) return { status: "unavailable" };
    return { status: "ok", leads: data ?? [], total: count ?? (data ?? []).length };
  } catch {
    return { status: "unavailable" };
  }
}
