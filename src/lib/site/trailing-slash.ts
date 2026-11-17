/**
 * The trailing-slash rule, written down because next.config.ts sets `skipTrailingSlashRedirect: true`
 * and proxy.ts now does the redirect itself.
 *
 * Why: `trailingSlash: true` makes Next answer a 308 to `/api/mcp/` for `/api/mcp`, and Claude's connector
 * check treats that redirect as "Not found" and stops (it also drops the trailing slash from the address
 * a person types). So `/api/mcp` must answer directly. Every OTHER path keeps exactly today's behaviour:
 * an address without a final slash is redirected (308) to the same address with one, query kept.
 *
 * Not redirected, as with Next's own rule: a path that already ends in "/", a file with an extension,
 * anything under `/.well-known/`, and Next's own `/_next/` paths. Pure; tested in
 * tests/site/trailing-slash.test.ts.
 */
export const SLASH_EXEMPT_PATHS: readonly string[] = ["/api/mcp"];

export function needsTrailingSlash(pathname: string): boolean {
  if (pathname === "" || pathname.endsWith("/")) return false;
  if (SLASH_EXEMPT_PATHS.includes(pathname)) return false;
  if (pathname === "/.well-known" || pathname.startsWith("/.well-known/")) return false;
  if (pathname.startsWith("/_next/")) return false;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (/\.\w+$/.test(last)) return false;
  return true;
}

/**
 * Where an address with no final slash should be sent: the SAME address with a slash on its path, query
 * and hash kept. Null when no redirect is needed. A plain `URL` on purpose: Next's `NextURL` re-formats
 * the path and drops the slash that was just added (the redirect then points at itself and loops), which
 * the first real run of this change showed.
 */
export function trailingSlashTarget(requestUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (!needsTrailingSlash(url.pathname)) return null;
  url.pathname = `${url.pathname}/`;
  return url.toString();
}
