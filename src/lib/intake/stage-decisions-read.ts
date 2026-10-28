import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { parseDecisionFlag, type DecisionFlag } from "./stage-decision";

/**
 * The stage-decision flags the Lawmatics importer wrote (`lead_created` rows with source `lawmatics_import`), for the
 * Intake board. One read through the caller's RLS-scoped client, in two states and never a bare empty map:
 *   ok           we reached the timeline; a lead is absent only because it carries no flag
 *   unavailable  the read failed or threw, so nothing is known either way (the board says so and offers no filter)
 * `truncated` is set when the row cap was hit.
 */

export const DECISION_ROW_CAP = 5000;

export type StageDecisionsRead =
  | { status: "ok"; byLead: Record<string, DecisionFlag>; truncated: boolean }
  | { status: "unavailable" };

export async function loadStageDecisions(): Promise<StageDecisionsRead> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_activity")
      .select("lead_id, payload, created_at")
      // `lead_created` is a hand-widened activity type (src/lib/matters/activity.ts), so it goes through the untyped filter.
      .filter("type", "eq", "lead_created")
      .eq("payload->>source", "lawmatics_import")
      .order("created_at", { ascending: false })
      .limit(DECISION_ROW_CAP);
    if (error) return { status: "unavailable" };
    const rows = (data ?? []) as Array<{ lead_id: string | null; payload: unknown }>;
    const byLead: Record<string, DecisionFlag> = {};
    for (const row of rows) {
      if (!row.lead_id || byLead[row.lead_id]) continue; // newest first: the first flag per lead is the one that stands
      const flag = parseDecisionFlag(row.payload);
      if (flag) byLead[row.lead_id] = flag;
    }
    return { status: "ok", byLead, truncated: rows.length >= DECISION_ROW_CAP };
  } catch {
    return { status: "unavailable" };
  }
}
