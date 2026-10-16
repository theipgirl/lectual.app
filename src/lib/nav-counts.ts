import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listStages } from "@/lib/pipeline";
import { intakeStageIds } from "@/lib/intake/scope";

/**
 * The numbers the pinned rail shows beside a section (design: the prototype's
 * `railCounts`). Keyed by nav slug.
 *
 * Best-effort and never a false zero: a count that could not be read is
 * simply absent, so the rail draws no number rather than "0" over a broken
 * read. Both reads are RLS-scoped head counts, so they cost no rows.
 */
export async function loadRailCounts(): Promise<Partial<Record<string, number>>> {
  const counts: Partial<Record<string, number>> = {};
  const supabase = await getScopedClient();

  const [intake, matters] = await Promise.allSettled([
    (async () => {
      const ids = Array.from(intakeStageIds(await listStages()));
      if (ids.length === 0) return 0;
      // Same scope as the Intake page (src/lib/intake/leads.ts listIntakeLeads).
      const { count, error } = await supabase
        .from("crm_lead")
        .select("id", { count: "exact", head: true })
        .in("current_stage_id", ids)
        .or("practice_area.is.null,practice_area.ilike.%trademark%");
      if (error) throw error;
      return count ?? 0;
    })(),
    (async () => {
      const { count, error } = await supabase
        .from("crm_matter")
        .select("id", { count: "exact", head: true })
        .eq("status", "open");
      if (error) throw error;
      return count ?? 0;
    })(),
  ]);

  if (intake.status === "fulfilled") counts.intake = intake.value;
  if (matters.status === "fulfilled") counts.matters = matters.value;
  return counts;
}
