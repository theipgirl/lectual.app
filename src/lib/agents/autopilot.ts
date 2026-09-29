import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { isMissingTableError } from "@/lib/reports/db";
import { autopilotFromRow, type AutopilotState } from "./autopilot-rules";

export const AUTOPILOT_COLUMNS = "paused, paused_by, paused_at, reason, minutes_per_task";

/**
 * The caller's firm's Autopilot row, read through RLS. Three states, the same
 * discipline as the queue: `ok` (no row is a real answer: on, default
 * minutes), `missing` (0082 isn't applied in this environment, so there is no
 * pause switch to show), `unavailable` (a real read failure: we don't know
 * whether the firm is paused, and must not say "on").
 */
export type AutopilotLoad = { status: "ok"; state: AutopilotState } | { status: "missing" } | { status: "unavailable" };

export async function loadAutopilot(): Promise<AutopilotLoad> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase.from("agent_autopilot").select(AUTOPILOT_COLUMNS).maybeSingle();
    if (error) return isMissingTableError(error) ? { status: "missing" } : { status: "unavailable" };
    return { status: "ok", state: autopilotFromRow(data) };
  } catch {
    return { status: "unavailable" };
  }
}
