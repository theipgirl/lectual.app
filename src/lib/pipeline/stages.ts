import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";

export type Stage = Database["public"]["Tables"]["crm_stage"]["Row"];

/**
 * Lists the active org's pipeline stages, ordered for board/kanban rendering.
 * RLS (crm_stage_select_own) scopes this to the caller's active_org_id — no
 * org_id filter is applied here on purpose (see AGENTS.md tenant-isolation rule).
 */
export async function listStages(): Promise<Stage[]> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_stage")
    .select("*")
    .order("order_index", { ascending: true });
  if (error) throw error;
  return data ?? [];
}
