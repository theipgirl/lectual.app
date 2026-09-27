import { normalizeDomain } from "./config";

/**
 * Who may put `/i/<slug>` in an iframe (`crm_intake_form.allowed_domains`).
 *
 * The browser enforces it, from a `Content-Security-Policy: frame-ancestors`
 * header the proxy sets on the page (src/proxy.ts). Pure, so the header's
 * exact wording is tested.
 *
 *   []                         → null: no header, any site can embed it
 *                                (the design's "Any site can embed this").
 *   ["example.com"]            → "frame-ancestors 'self' example.com"
 *   ["*.example.com"]          → "frame-ancestors 'self' *.example.com"
 *   unreadable / lookup failed → "frame-ancestors 'self'" — fail closed.
 *
 * Scheme-less host sources match the page's own scheme and its https upgrade,
 * so a production (https) intake is never framed by a plain-http page.
 * Every entry is re-normalised here: a value that is not a domain is dropped,
 * never pasted into a header.
 */
export function frameAncestors(domains: readonly string[] | null): string | null {
  if (domains === null) return "frame-ancestors 'self'";
  if (domains.length === 0) return null;
  const clean = [...new Set(domains.map((d) => normalizeDomain(d)).filter((d): d is string => !!d))];
  return clean.length ? `frame-ancestors 'self' ${clean.join(" ")}` : "frame-ancestors 'self'";
}

/** `/i/<slug>` or `/i/<slug>/` → the slug; anything else → null. */
export function intakeSlugFromPath(pathname: string): string | null {
  const m = /^\/i\/([a-z0-9-]{3,60})\/?$/.exec(pathname);
  return m ? m[1] : null;
}
