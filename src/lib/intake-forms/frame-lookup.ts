import "server-only";

import { getAdminClient } from "@/lib/db/admin";

/**
 * The proxy's one database read: a LIVE form's `allowed_domains`, for the
 * `frame-ancestors` header (frame-policy.ts). Kept apart from public.ts so the
 * proxy bundle pulls in the admin client and nothing else.
 *
 * `null` means "don't know" — not live, not found, or unreachable — and the
 * proxy frames that as 'self' only: fail closed. The answer is cached briefly
 * per instance so an embedded intake doesn't cost a round trip per request;
 * a firm's domain change reaches every instance within FRAME_TTL_MS.
 *
 * Service role, because the visitor has no session. The read is keyed on
 * the exact slug of a live form, returns one column, and writes nothing.
 */

const SLUG_SHAPE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;
const FRAME_TTL_MS = 30_000;
const cache = new Map<string, { at: number; domains: string[] | null }>();

export async function readFrameDomains(slug: string, now = Date.now()): Promise<string[] | null> {
  if (!SLUG_SHAPE.test(slug)) return null;
  const hit = cache.get(slug);
  if (hit && now - hit.at < FRAME_TTL_MS) return hit.domains;
  let domains: string[] | null = null;
  try {
    const { data, error } = await getAdminClient()
      .from("crm_intake_form")
      .select("allowed_domains")
      .eq("slug", slug)
      .eq("status", "live")
      .maybeSingle();
    domains = !error && data ? (data.allowed_domains ?? []) : null;
  } catch {
    domains = null;
  }
  // Don't cache a failure for long: the next request retries.
  if (domains !== null) cache.set(slug, { at: now, domains });
  if (cache.size > 1000) cache.delete(cache.keys().next().value as string);
  return domains;
}
