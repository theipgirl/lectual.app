import { safeNext } from "./safe-next";

/**
 * Where to come back to after signing in, for the dashboard. A layout cannot read its own URL, so the proxy
 * copies the page's path and query into this request header and the dashboard layout reads it. It only chooses
 * where a signed-out person is sent back to after signing in; it never decides access (every page and action
 * still gates itself), and whatever it carries goes through `safeNext` again.
 */
export const RETURN_PATH_HEADER = "x-lectual-return-to";

/** The path + query to come back to, only for a page under /dashboard; anything else is null. */
export function dashboardReturnPath(pathname: string, search: string): string | null {
  if (pathname !== "/dashboard" && !pathname.startsWith("/dashboard/")) return null;
  const path = safeNext(pathname + search);
  return path.startsWith("/dashboard") ? path : null;
}

/** The sign-in address that comes back to `next` (checked, and encoded so its own query survives). */
export function signInRedirect(next: string | null | undefined): string {
  return `/sign-in/?next=${encodeURIComponent(safeNext(next))}`;
}
