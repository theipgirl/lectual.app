import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import {
  AGENT_MOVE_DAYS,
  chipsByLead,
  currentAgentMoves,
  movedTodayCount,
  type ActivityRow,
  type AgentMoveChip,
} from "./moves";

/**
 * The Stage Keeper's recent moves, for the Intake board and table and the Agents page.
 *
 * One read through the caller's RLS-scoped client, in two states and never a bare empty list:
 *   ok           we reached the timeline; a lead is absent only because the agent hasn't moved it
 *                (or someone moved it since)
 *   unavailable  the read failed or threw, so nothing is known either way
 * `truncated` is set when the row cap was hit; the newest moves are always the ones kept.
 *
 * The chip, the "Agent moves" filter and the Agents-page count all come from this one result,
 * so they cannot disagree.
 */

/** Stage changes read in the window. Newest first, so a cut keeps what matters most. */
export const AGENT_MOVE_ROW_CAP = 1000;

export type AgentMovesRead =
  | { status: "ok"; chips: Record<string, AgentMoveChip>; truncated: boolean; movedToday: number }
  | { status: "unavailable" };

export async function loadAgentMoves(now: Date, timeZone: string): Promise<AgentMovesRead> {
  try {
    const supabase = await getScopedClient();
    const since = new Date(now.getTime() - AGENT_MOVE_DAYS * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from("crm_activity")
      .select("id, lead_id, type, actor_type, created_at, payload")
      .eq("type", "stage_changed")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(AGENT_MOVE_ROW_CAP);
    if (error) return { status: "unavailable" };
    const rows = (data ?? []) as ActivityRow[];
    const chips = chipsByLead(currentAgentMoves(rows, now), now, timeZone);
    return { status: "ok", chips, truncated: rows.length >= AGENT_MOVE_ROW_CAP, movedToday: movedTodayCount(chips) };
  } catch {
    return { status: "unavailable" };
  }
}
