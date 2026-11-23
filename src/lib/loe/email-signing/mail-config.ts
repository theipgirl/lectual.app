/**
 * `FIRM_CLIENT_MAIL_FROM`: the sender of the two owner-approved client emails, PER FIRM. JSON
 * `{ "<org_id>": "Firm Name <signing@firm-domain.com>" }`. Import-free on purpose (like `client-link-config.ts`), so the gate,
 * the Settings status line and the tests can parse it without pulling in anything else.
 *
 * Rules: an org id must be a uuid; the value is ONE address, display name optional, no CR or LF, at most 320 characters; an
 * address on `lectual.app` or any subdomain of it, or on the host of `SITE_URL` (or a subdomain), is DROPPED: there is no
 * deployment-wide sender for client mail. Invalid entries are ignored. There is no default sender.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADDRESS = /^[^\s@<>",;:()[\]\\]+@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+)$/i;
const NAMED = /^([^<>"\r\n]*?)\s*<([^<>\s]+)>$/;
const MAX = 320;
const LECTUAL_DOMAIN = "lectual.app";

function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function onDomain(domain: string, root: string): boolean {
  return domain === root || domain.endsWith(`.${root}`);
}

/** The address part of a sender value, or null when the value is not exactly one valid address. */
export function senderAddress(value: string): string | null {
  if (value.length === 0 || value.length > MAX || /[\r\n]/.test(value)) return null;
  const v = value.trim();
  const named = NAMED.exec(v);
  const address = named ? named[2] : v;
  return ADDRESS.test(address) ? address : null;
}

export function parseFirmMailFrom(raw: string | undefined | null, siteUrl?: string | null): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (!raw || !raw.trim()) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return out;
  const siteHost = hostOf(siteUrl);
  for (const [orgId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!UUID.test(orgId) || typeof value !== "string") continue;
    const address = senderAddress(value);
    if (!address) continue;
    const domain = address.slice(address.lastIndexOf("@") + 1).toLowerCase();
    if (onDomain(domain, LECTUAL_DOMAIN)) continue;
    if (siteHost && onDomain(domain, siteHost)) continue;
    out.set(orgId.toLowerCase(), value.trim());
  }
  return out;
}

/** The firm's sender from the environment, or null (no entry, an invalid entry, or an entry that was dropped). */
export function firmMailFrom(orgId: string, env: { FIRM_CLIENT_MAIL_FROM?: string; SITE_URL?: string } = process.env as Record<string, string | undefined>): string | null {
  return parseFirmMailFrom(env.FIRM_CLIENT_MAIL_FROM, env.SITE_URL).get(orgId.toLowerCase()) ?? null;
}
