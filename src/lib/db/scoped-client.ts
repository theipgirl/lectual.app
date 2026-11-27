import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { env } from "@/lib/env";
import { netMustAsk, refusesWrites } from "@/lib/views/view-as-rules";
import { VIEW_AS_READ_ONLY } from "@/lib/ui/words";

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
      // View as, Layer b: this client's own fetch (per instance, never process-wide) refuses writes while the owner is
      // previewing a teammate. See previewNetFetch below.
      global: { fetch: previewNetFetch },
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

/**
 * The database net (View as, Layer b; spec "The write block"). For a request that is not a read (netMustAsk: any non-GET to
 * the REST API or storage, and updateUser), it asks the per-request preview flag first and, while a preview is on (or
 * couldn't be checked), answers 409 itself without sending anything. Reads, `rpc(fn, args, { get: true })`, signed
 * download links, the three view-as log functions and auth's refresh / logout pass without asking. This is the net for an
 * action that slipped past previewSafe(); it does not cover the queue API or any provider (Layer a does).
 *
 * The flag module is imported lazily: it reads the session through this very function, and only ever with requests that
 * pass without asking, so there is no cycle at run time.
 */
export const previewNetFetch: typeof fetch = async (input, init) => {
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let pathname = "";
  try {
    pathname = new URL(href).pathname;
  } catch {
    pathname = "";
  }
  if (netMustAsk(method, pathname)) {
    const { previewFlag } = await import("@/lib/views/view-as-flag");
    if (refusesWrites(await previewFlag())) {
      return new Response(
        JSON.stringify({ code: "view_as_read_only", message: VIEW_AS_READ_ONLY, error: VIEW_AS_READ_ONLY, details: null, hint: null, statusCode: "409" }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    }
  }
  return fetch(input, init);
};
