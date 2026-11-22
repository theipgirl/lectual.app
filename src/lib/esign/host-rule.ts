/**
 * The host rule for Adobe Acrobat Sign (Sprint 5a, contract item 2). PURE.
 *
 * A firm's tokens, and Lectual's `client_secret`, are only ever sent to an Adobe host, and a client's browser is only ever sent
 * to an Adobe signing page. "An Adobe host" means: `https://`, no user name or password, no port, and a host name that ENDS in
 * `.adobesign.com` or `.echosign.com` (so `adobesign.com.evil.com` and `evilecho-sign.com` are refused). Adobe hands each firm
 * its own `api_access_point` ("https://api.na1.adobesign.com/") at sign-in; that value is checked HERE before the token POST that
 * carries the client secret, and again before every later call, because a value stored in a row is never trusted on its own.
 *
 * lectual 0113's CHECK on `adobe_sign_connection.api_access_point` / `web_access_point` states the same rule in SQL.
 */

export const ADOBE_HOST_SUFFIXES = [".adobesign.com", ".echosign.com"] as const;

function parse(raw: unknown): URL | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  if (/\s/.test(raw)) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function hostOk(url: URL, suffixes: readonly string[]): boolean {
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port) return false;
  const host = url.hostname.toLowerCase();
  return suffixes.some((s) => host.endsWith(s) && host.length > s.length);
}

/**
 * An access point (`api_access_point` / `web_access_point`) as its bare origin ("https://api.na1.adobesign.com"), or null when it
 * breaks the rule. No path beyond "/", no query, no fragment.
 */
export function adobeAccessPoint(raw: unknown): string | null {
  const url = parse(raw);
  if (!url || !hostOk(url, ADOBE_HOST_SUFFIXES)) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  if (url.search || url.hash) return null;
  return url.origin;
}

/** Two access points are the same when both pass the rule and name the same origin. */
export function sameAccessPoint(a: unknown, b: unknown): boolean {
  const x = adobeAccessPoint(a);
  return x !== null && x === adobeAccessPoint(b);
}

/** The `esignUrl` a client is sent to: an Adobe host (any path), https, no credentials in it. */
export function isAdobeSigningUrl(raw: unknown): boolean {
  const url = parse(raw);
  return url !== null && hostOk(url, ADOBE_HOST_SUFFIXES);
}

/** `ADOBE_SIGN_AUTHORIZE_URL`, when set: https, and a host ending `.adobesign.com` (contract item 1). */
export function isAdobeAuthorizeUrl(raw: unknown): boolean {
  const url = parse(raw);
  return url !== null && hostOk(url, [".adobesign.com"]) && !url.hash;
}
