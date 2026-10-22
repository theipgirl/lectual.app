import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import type { DatabaseUpdate, ReadinessSource } from "@/lib/agents/readiness";

/**
 * What the Agents page can tell about the Outlook calendar, for the readiness lines of the agents that use it.
 *
 *   `readiness`       three states, like every read of a source an agent depends on: `ok` (there are some
 *                     consults), `none` (the table answered and has none, which includes a database that has not
 *                     had lectual 0098 applied yet, where the Outlook columns do not exist) and `unavailable`
 *                     (the read failed, so it is not known either way).
 *   `databaseUpdate`  `pending` when the Outlook columns are missing (0098 not applied), `applied` when the
 *                     probe succeeded, `unknown` when the read failed for any other reason. The same migration
 *                     adds the three newest agents to the settings CHECK, so this is the page's way of showing
 *                     "Not available until the database update" without writing a setting to find out.
 */
export type CalendarProbe = { readiness: ReadinessSource; databaseUpdate: DatabaseUpdate };

export async function readCalendarProbe(): Promise<CalendarProbe> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase.from("crm_calendar_event").select("id").eq("source", "outlook").limit(1);
    if (error) {
      const waiting = error.code === "42703" || error.code === "PGRST204";
      return waiting ? { readiness: "none", databaseUpdate: "pending" } : { readiness: "unavailable", databaseUpdate: "unknown" };
    }
    return { readiness: (data ?? []).length > 0 ? "ok" : "none", databaseUpdate: "applied" };
  } catch {
    return { readiness: "unavailable", databaseUpdate: "unknown" };
  }
}

/** Whether the Agents page can see any Outlook consults, for the Stage Keeper's readiness line. */
export async function readConsultReadiness(): Promise<ReadinessSource> {
  return (await readCalendarProbe()).readiness;
}
