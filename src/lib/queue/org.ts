import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";

/**
 * The active org's tenant key for the external approval queue.
 *
 * The queue is not in this database — it lives in the firm's CRM Supabase
 * behind lawmatics-mcp, reached over HTTP with one shared bearer token. RLS
 * therefore cannot scope it, and this key is the entire tenant boundary. It is
 * read through the RLS-scoped client, so a caller can only ever resolve the
 * key of the org their JWT is actually active in.
 *
 * Returns null when the active org has no queue wired up. Callers must treat
 * that as "no queue" and show an empty state — never fall back to a default
 * tenant, which is precisely the bug this replaced.
 */
export async function activeQueueOrgKey(): Promise<string | null> {
  const supabase = await getScopedClient();
  const { data } = await supabase.from("crm_org").select("queue_org_key").maybeSingle();
  return data?.queue_org_key ?? null;
}
