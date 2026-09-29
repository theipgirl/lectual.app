import "server-only";
import { headers } from "next/headers";
import { env } from "@/lib/env";

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

  const origin = hdrs.get("origin");
  if (origin) return origin.replace(/\/$/, "");

  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
  if (host) {
    const proto = hdrs.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }

  return env.SITE_URL?.replace(/\/$/, "") ?? "http://localhost:3000";
}
