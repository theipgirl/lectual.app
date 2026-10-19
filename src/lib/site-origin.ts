import "server-only";
import { headers } from "next/headers";
import { env } from "@/lib/env";
import { resolveSiteOrigin } from "@/lib/site-origin-resolve";

/**
 * The origin to build magic-link redirects against.
 *
 * MUST be the origin the user is actually browsing: Supabase's PKCE flow writes
 * the `-code-verifier` cookie on the origin where the sign-in form was submitted,
 * so a callback that lands anywhere else cannot complete the exchange. It also
 * has to be in the Supabase Redirect URLs allowlist, or GoTrue silently swaps in
 * the dashboard's Site URL and the code arrives at the wrong path.
 *
 * Request headers win over SITE_URL for exactly that reason — every preview
 * deployment then self-heals instead of inheriting whatever origin was baked
 * into the env at provisioning time. SITE_URL stays as a last resort for
 * contexts with no request (and must still be allowlisted when it is used).
 */
export async function getSiteOrigin(): Promise<string> {
  const hdrs = await headers();
  // Optional deployment hints: read through a guard, never a reason to throw.
  const read = (get: () => string | undefined): string | null => {
    try {
      return get() ?? null;
    } catch {
      return null;
    }
  };
  // Pure rules (https only for a deployed host, "null" origins ignored) live in site-origin-resolve.ts.
  return resolveSiteOrigin({
    origin: hdrs.get("origin"),
    forwardedHost: hdrs.get("x-forwarded-host"),
    host: hdrs.get("host"),
    forwardedProto: hdrs.get("x-forwarded-proto"),
    siteUrl: read(() => env.SITE_URL),
    vercelProductionHost: read(() => env.VERCEL_PROJECT_PRODUCTION_URL),
    vercelHost: read(() => env.VERCEL_URL),
  });
}
