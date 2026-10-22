import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { env } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/http/timeout";

/**
 * The service-role client. `timeoutMs` puts a deadline on every statement it sends (the agent
 * runner uses it, so a database call that never answers cannot hold a run past its time limit).
 * Without it the client behaves exactly as before.
 */
export function getAdminClient(opts: { timeoutMs?: number } = {}): SupabaseClient<Database> {
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      ...(opts.timeoutMs ? { global: { fetch: fetchWithTimeout(fetch, opts.timeoutMs) } } : {}),
    },
  );
}
