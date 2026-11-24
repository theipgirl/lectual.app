import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { leadRead } from "@/lib/leads/live";
import { CAME_BACK_DAYS, CAME_BACK_KIND, CAME_BACK_SOURCE, cameBackItems, type CameBackLead, type CameBackRead, type CameBackRow, type StageChangeRow } from "./came-back-rules";

/**
 * Today's "Came back" rows (both layouts). Scoped client, RLS. Three states: items (possibly none) or unavailable.
 * A failed read is never silence and never "none": the card says it couldn't show returning clients.
 */
export async function loadCameBack(now: Date = new Date()): Promise<CameBackRead> {
  try {
    const supabase = await getScopedClient();
    const since = new Date(now.getTime() - CAME_BACK_DAYS * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from("crm_activity")
      .select("id, lead_id, created_at, payload")
      .eq("type", "ai_insight")
      .eq("payload->>source", CAME_BACK_SOURCE)
      .eq("payload->>kind", CAME_BACK_KIND)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return { status: "unavailable" };
    const rows = (data ?? []) as CameBackRow[];
    const ids = [...new Set(rows.map((r) => r.lead_id).filter((x): x is string => !!x))];
    if (ids.length === 0) return { status: "ok", items: [] };
    const [leads, changes] = await Promise.all([
      leadRead(({ merged }) =>
        supabase
          // live-guard: reads the flagged leads WITH their pointer so a merged one is dropped from the list
          .from("crm_lead")
          .select(merged ? "id, first_name, last_name, business_name, email, merged_into_id" : "id, first_name, last_name, business_name, email")
          .in("id", ids),
      ),
      supabase.from("crm_activity").select("lead_id, created_at").eq("type", "stage_changed").in("lead_id", ids).gte("created_at", since).limit(1000),
    ]);
    if (leads.error || changes.error) return { status: "unavailable" };
    return {
      status: "ok",
      items: cameBackItems(rows, (leads.data ?? []) as unknown as CameBackLead[], (changes.data ?? []) as StageChangeRow[], now.getTime()),
    };
  } catch {
    return { status: "unavailable" };
  }
}
