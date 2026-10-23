import { getSiteOrigin } from "@/lib/site-origin";
import { parseClientLinkOrigins } from "./client-link-config";

/**
 * Where a client's proposal link lives. A firm with an entry in FIRM_CLIENT_LINK_ORIGINS gets
 * its own domain; every other firm (and a deployment with the env unset) gets this app's
 * origin. This file is the ONLY place a `/p/<token>/` URL is built (a test greps for it), so
 * the proposal page and the consult email cannot disagree.
 */

let memo: { raw: string; map: ReadonlyMap<string, string> } | null = null;

/** Parsed once per distinct value of the env. */
function configured(raw: string | undefined): ReadonlyMap<string, string> {
  const value = raw ?? "";
  if (!memo || memo.raw !== value) memo = { raw: value, map: parseClientLinkOrigins(value) };
  return memo.map;
}

/** Pure form: the firm's origin, else `fallback` (trailing slash dropped). */
export function resolveClientLinkOrigin(orgId: string, fallback: string, raw: string | undefined = process.env.FIRM_CLIENT_LINK_ORIGINS): string {
  return configured(raw).get(orgId) ?? fallback.replace(/\/$/, "");
}

export async function clientLinkOrigin(orgId: string): Promise<string> {
  const own = configured(process.env.FIRM_CLIENT_LINK_ORIGINS).get(orgId);
  return own ?? (await getSiteOrigin());
}

/** `<origin>/p/<token>/`. */
export function clientLinkUrl(origin: string, publicToken: string): string {
  return `${origin.replace(/\/$/, "")}/p/${publicToken}/`;
}
