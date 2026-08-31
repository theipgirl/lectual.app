// MIRRORED FROM theipgirl/lectual:src/lib/db/scoped-client.ts — keep in sync, do not edit locally
//
// Adapted only in its type import: this app generates types fresh from
// lectual-prod into ./types.generated.ts rather than carrying the main repo's
// hand-patched src/lib/db/types.ts.
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types.generated";
import { env } from "@/lib/env";

/**
 * The ONLY sanctioned server-side DB entry point.
 * Builds a request-scoped Supabase client from the caller's auth cookies, so
 * every query carries the user's JWT (active_org_id claim) and RLS is always
 * enforced. There is intentionally no exported unscoped/service-role client
 * here — and this app ships no service-role key at all.
 *
 * Because RLS does the scoping, callers must never add an `org_id` filter of
 * their own; doing so would silently hide rows the policy already allows and
 * would hide a policy regression rather than surface it.
 */
export async function getScopedClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          // In a Server Component cookies are read-only and .set throws; the
          // session refresh is handled by src/proxy.ts, which runs before
          // rendering and persists the rotated tokens. Swallow per the
          // documented @supabase/ssr App Router pattern.
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // no-op in RSC render context
          }
        },
      },
    },
  );
}
