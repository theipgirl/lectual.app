// MIRRORED FROM theipgirl/lectual:src/lib/site-origin.ts — keep in sync, do not edit locally
//
// Adapted only in its last-resort fallback: this app reads NEXT_PUBLIC_SITE_URL
// rather than SITE_URL.
import "server-only";
import { headers } from "next/headers";
import { optionalEnv } from "@/lib/env";

/**
 * The origin to build magic-link redirects against.
 *
 * MUST be the origin the user is actually browsing: Supabase's PKCE flow writes
 * the `-code-verifier` cookie on the origin where the sign-in form was submitted,
 * so a callback that lands anywhere else cannot complete the exchange. It also
 * has to be in the Supabase Redirect URLs allowlist, or GoTrue silently swaps in
 * the project's Site URL and the code arrives at the wrong path — which, because
 * this project is shared with the main app, means Tracy's magic link lands on the
 * marketing homepage.
 *
 * Request headers win over the env var for exactly that reason — every preview
 * deployment then self-heals instead of inheriting whatever origin was baked
 * into the env at provisioning time. NEXT_PUBLIC_SITE_URL stays as a last resort
 * for contexts with no request (and must still be allowlisted when it is used).
 */
export async function getSiteOrigin(): Promise<string> {
  const hdrs = await headers();

  const origin = hdrs.get("origin");
  if (origin) return origin.replace(/\/$/, "");

  const host = hdrs.get("x-forwarded-host") ?? hdrs.get("host");
  if (host) {
    const proto =
      hdrs.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }

  return optionalEnv("NEXT_PUBLIC_SITE_URL")?.replace(/\/$/, "") ?? "http://localhost:3000";
}
