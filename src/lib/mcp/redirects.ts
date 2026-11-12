/**
 * The OAuth redirect URIs the consent page may approve (plan decision 5). Dynamic client
 * registration lets anyone register a client with Supabase; this list is what stops a look-alike
 * client from getting a member's token through our own consent page. Pure: env is passed in.
 */
export const DEFAULT_MCP_REDIRECTS: readonly string[] = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];

/**
 * `MCP_ALLOWED_REDIRECTS`: comma-separated exact https URLs. Unset or blank = the defaults. An entry
 * that is not an absolute https URL with no query or fragment is dropped (never widened). A value
 * that leaves nothing usable falls back to NOTHING, not the defaults: a mistyped setting must not
 * silently re-open the list.
 */
export function parseAllowedRedirects(raw: string | null | undefined): string[] {
  if (raw === undefined || raw === null || raw.trim() === "") return [...DEFAULT_MCP_REDIRECTS];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim();
    if (!value) continue;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || url.search || url.hash || url.username || url.password) continue;
    if (url.href !== value) continue;
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/** The client's registered redirect URI, compared exactly. */
export function redirectUriAllowed(uri: string | null | undefined, allowed: readonly string[]): boolean {
  if (typeof uri !== "string" || uri.length === 0) return false;
  return allowed.includes(uri);
}

/**
 * A complete redirect URL from Supabase (`redirect_uri` plus `?code=...&state=...`, or an error). Its
 * origin and path must be an allowed URI exactly; the query is Supabase's and is kept as it is.
 */
export function redirectUrlAllowed(url: string | null | undefined, allowed: readonly string[]): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  return allowed.includes(parsed.origin + parsed.pathname);
}
