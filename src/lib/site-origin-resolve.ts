/**
 * Pure origin resolution behind `getSiteOrigin` (src/lib/site-origin.ts).
 *
 * Every link we hand a client (the proposal page, a magic link) is built on
 * the result, and `renderProposalEmail` refuses anything but an https address
 * (plain http only for a local dev server). So this never returns a value that
 * rule would refuse for a deployed host:
 *
 *  - an `Origin: null` header (sent by some privacy modes and redirects) or any
 *    non-http(s) value is ignored, not returned as the string "null";
 *  - comma lists (`x-forwarded-proto: https,http`, a chain of forwarded hosts)
 *    take their first entry, the one nearest the client;
 *  - a missing or `http` protocol on a non-local host becomes `https`
 *    (Vercel only serves https; a request that reaches us over a proxy hop as
 *    http was still https at the edge);
 *  - a configured SITE_URL without a scheme gets `https://`.
 */

export type OriginInputs = {
  origin?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
  forwardedProto?: string | null;
  siteUrl?: string | null;
  /** Vercel's own deployment hosts (no scheme). */
  vercelProductionHost?: string | null;
  vercelHost?: string | null;
};

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return LOCAL_HOSTNAMES.has(h) || h.endsWith(".localhost");
}

function first(value: string | null | undefined): string {
  return (value ?? "").split(",")[0].trim();
}

/** `scheme://host[:port]` from a candidate, upgraded to https unless local; null if unusable. */
function normalise(candidate: string, defaultScheme: "https" | "http" = "https"): string | null {
  const raw = candidate.trim();
  if (!raw || raw.toLowerCase() === "null") return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${defaultScheme}://${raw}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!url.hostname) return null;
  const scheme = url.protocol === "http:" && !isLocalHostname(url.hostname) ? "https:" : url.protocol;
  return `${scheme}//${url.host}`;
}

export function resolveSiteOrigin(input: OriginInputs): string {
  const fromOrigin = normalise(first(input.origin));
  if (fromOrigin) return fromOrigin;

  const host = first(input.forwardedHost) || first(input.host);
  if (host && !/[\s/@\\]/.test(host)) {
    const proto = first(input.forwardedProto).toLowerCase();
    let local = false;
    try {
      local = isLocalHostname(new URL(`http://${host}`).hostname);
    } catch {
      // normalise() below refuses the same host
    }
    const scheme = proto === "http" || proto === "https" ? proto : local ? "http" : "https";
    const fromHost = normalise(`${scheme}://${host}`);
    if (fromHost) return fromHost;
  }

  return (
    normalise(input.siteUrl ?? "") ??
    normalise(input.vercelProductionHost ?? "") ??
    normalise(input.vercelHost ?? "") ??
    "http://localhost:3000"
  );
}
