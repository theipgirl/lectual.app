import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultPrepDeps } from "./deps";
import { cancelAllScheduled } from "./engine";

/**
 * The firm has switched consult prep OFF (or never on): its remaining scheduled emails are cancelled, and no prep is made.
 * Called by the 5 AM sweep (`runAllAgents`) for a firm that holds the Assistants feature and is not paused. Counts only.
 */
export async function cancelPrepSendsWhenOff(deps: { admin: SupabaseClient; fetchImpl?: typeof fetch }, orgId: string): Promise<{ cancelled: number; notCancelled: number }> {
  const prep = defaultPrepDeps({ admin: deps.admin, orgId, signal: new AbortController().signal, fetchImpl: deps.fetchImpl });
  return cancelAllScheduled({ admin: deps.admin, orgId }, prep, Date.now());
}
