/** Where signing in lands when nothing safe was asked for: Today. */
export const SIGN_IN_HOME = "/dashboard/";

const PROBE_ORIGIN = "https://x.invalid";

/**
 * The in-app path to go to after sign-in. Only a path inside this app is kept
 * (one leading slash, no protocol-relative "//", no backslash, no control character
 * or whitespace, and it must still resolve on our own origin once a browser or
 * `new URL` has stripped tabs and newlines); the bare root "/", nothing, or anything
 * else lands on Today.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || /[\u0000-\u001F\u007F\s]/.test(next)) return SIGN_IN_HOME;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\") || next === "/") return SIGN_IN_HOME;
  let url: URL;
  try {
    url = new URL(next, PROBE_ORIGIN);
  } catch {
    return SIGN_IN_HOME;
  }
  if (url.origin !== PROBE_ORIGIN) return SIGN_IN_HOME;
  const resolved = url.pathname + url.search + url.hash;
  if (resolved.startsWith("//") || resolved === "/") return SIGN_IN_HOME;
  return resolved;
}
