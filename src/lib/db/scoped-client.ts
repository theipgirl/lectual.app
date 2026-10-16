import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { env } from "@/lib/env";

/**
 * The ONLY sanctioned server-side DB entry point.
 * Builds a request-scoped Supabase client from the caller's auth cookies, so
 * every query carries the user's JWT (active_org_id claim) and RLS is always
 * enforced. There is intentionally no exported unscoped/service-role client here
 * — service-role access lives in a separate, lint-fenced admin module (Task 15).
 */
export async function getScopedClient(): Promise<SupabaseClient<Database>> {
  const cookieStore = await cookies();
  return createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          // In a Server Component cookies are read-only and .set throws; the
          // session refresh is handled by src/proxy.ts, which runs before
          // rendering and persists the rotated tokens. Swallow per the
          // documented @supabase/ssr App Router pattern. (eng-review fix)
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
