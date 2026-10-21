import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { ReadinessSource } from "@/lib/agents/readiness";

/**
 * Whether the Agents page can see any Outlook consults, for the Stage Keeper's readiness line.
 * Three states, like every read of a source an agent depends on: `ok` (there are some), `none`
 * (the table answered and has none, which includes a database that has not had lectual 0098
 * applied yet, where the Outlook columns do not exist) and `unavailable` (the read failed, so
 * it is not known either way).
 */
export async function readConsultReadiness(): Promise<ReadinessSource> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase.from("crm_calendar_event").select("id").eq("source", "outlook").limit(1);
    if (error) {
      const waiting = error.code === "42703" || error.code === "PGRST204";
      return waiting ? "none" : "unavailable";
    }
    return (data ?? []).length > 0 ? "ok" : "none";
  } catch {
    return "unavailable";
  }
}
