import { safeNext } from "./safe-next";

/**
 * Where to come back to after signing in, for the dashboard. A layout cannot read its own URL, so the proxy
 * copies the page's path and a FILTERED query into this request header and the dashboard layout reads it. It only
 * chooses where a signed-out person is sent back to after signing in; it never decides access (every page and
 * action still gates itself), and whatever it carries goes through `safeNext` again.
 *
 * Privacy: the return path ends up in the sign-in URL, server logs, Supabase's emailRedirectTo and the link in the
 * sign-in email (which mail scanners open), so it carries ONLY non-identifying query keys. Search terms (q),
 * record ids (c, m, box, live, open, lead, matter, person) and anything unknown are dropped.
 */
export const RETURN_PATH_HEADER = "x-lectual-return-to";

/** Query keys that may ride along. Nothing else does. */
export const RETURN_QUERY_KEYS = ["event", "range", "view", "form", "tab", "group", "who", "kind"] as const;

const KEPT = new Set<string>(RETURN_QUERY_KEYS);
const VALUE = /^[A-Za-z0-9_-]{1,120}$/;

/** The longest return path kept; longer falls back to the bare path, then to Today. */
export const RETURN_PATH_MAX = 600;

const HOME = "/dashboard/";

/** "/dashboard" or "/dashboard/…", exactly. */
export function isDashboardPath(path: string | null | undefined): path is string {
  return typeof path === "string" && (path === "/dashboard" || path.startsWith("/dashboard/") || path.startsWith("/dashboard?"));
}

/** The path + allowed query to come back to, only for a page under /dashboard; anything else is null. */
export function dashboardReturnPath(pathname: string, search: string): string | null {
  if (pathname !== "/dashboard" && !pathname.startsWith("/dashboard/")) return null;
  const bare = safeNext(pathname);
  if (bare !== pathname || !isDashboardPath(bare)) return null;
  const kept = new URLSearchParams();
  for (const [key, value] of new URLSearchParams(search)) {
    if (KEPT.has(key) && VALUE.test(value) && !kept.has(key)) kept.set(key, value);
  }
  const query = kept.toString();
  const full = query ? `${bare}?${query}` : bare;
  if (full.length <= RETURN_PATH_MAX) return full;
  return bare.length <= RETURN_PATH_MAX ? bare : HOME;
}

/** The sign-in address that comes back to `next` (checked, and encoded so its own query survives). */
export function signInRedirect(next: string | null | undefined): string {
  return `/sign-in/?next=${encodeURIComponent(safeNext(next))}`;
}
