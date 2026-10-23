/**
 * FIRM_CLIENT_LINK_ORIGINS, parsed. Pure and import-free on purpose: next.config.ts reads it
 * too (for the server-action allowed origins), and the config file cannot use the `@/` alias.
 *
 * The value is JSON `{ "<org_id>": "https://proposals.example.com" }`. An entry is kept only
 * when it is an https origin with no path, query, hash or credentials (a trailing slash is
 * tolerated). Anything else, or a value that is not a JSON object, is ignored.
 */

export function parseClientLinkOrigins(raw: string | undefined | null): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (!raw || !raw.trim()) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
  for (const [orgId, value] of Object.entries(parsed as Record<string, unknown>)) {
    const origin = cleanOrigin(value);
    if (orgId.trim() && origin) out.set(orgId.trim(), origin);
  }
  return out;
}

function cleanOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  let url: URL;
  try {
    url = new URL(v);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  if (v.replace(/\/$/, "") !== url.origin) return null;
  return url.origin;
}

/** The hosts (no scheme) to add to the server-action allowed origins. Empty when the env is unset or invalid. */
export function clientLinkHosts(raw: string | undefined | null): string[] {
  const hosts = new Set<string>();
  for (const origin of parseClientLinkOrigins(raw).values()) hosts.add(new URL(origin).host);
  return [...hosts];
}
