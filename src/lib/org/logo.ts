import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * The firm's logo for the rail wordmark, in ONE place (the way client-link-config.ts holds the
 * proposal origins). A firm with no entry keeps its name as text.
 *
 * Only the DARK variant belongs here: the bar is light, and `/brand/rpb-logo-cream.png` (the
 * client proposal page's logo) vanishes on it. An entry whose file is missing from `public/brand/`,
 * or that names a cream file, is ignored, so a typo or a file not yet dropped in shows the name
 * instead of a broken image.
 */

export type FirmLogo = { src: string; alt: string };
export type LogoEntry = string;

/** Keyed by org id. Add a firm here when its dark logo is in `public/brand/`. */
export const LOGO_BY_ORG: Readonly<Record<string, LogoEntry>> = {};
/**
 * Keyed by org slug, for a firm whose id this repo does not carry. RPB's dark logo is not in
 * `public/brand/` yet (only the cream one is), so until it is dropped in, RPB shows its name.
 */
export const LOGO_BY_SLUG: Readonly<Record<string, LogoEntry>> = { "rpb-law": "/brand/rpb-logo-dark.png" };

const BRAND_PREFIX = "/brand/";

/** A logo path is usable when it is a `/brand/` file, is not a cream variant, and exists. */
export function usableLogoPath(src: string, exists: (publicPath: string) => boolean): boolean {
  if (!src.startsWith(BRAND_PREFIX) || src.includes("..")) return false;
  if (/cream/i.test(src)) return false;
  return exists(src);
}

export function onDisk(publicPath: string): boolean {
  try {
    return existsSync(path.join(process.cwd(), "public", publicPath));
  } catch {
    return false;
  }
}

export function firmLogo(
  orgId: string,
  firmName: string,
  slug?: string | null,
  deps: { byOrg?: Readonly<Record<string, LogoEntry>>; bySlug?: Readonly<Record<string, LogoEntry>>; exists?: (p: string) => boolean } = {},
): FirmLogo | null {
  const byOrg = deps.byOrg ?? LOGO_BY_ORG;
  const bySlug = deps.bySlug ?? LOGO_BY_SLUG;
  const exists = deps.exists ?? onDisk;
  const src = byOrg[orgId] ?? (slug ? bySlug[slug] : undefined);
  if (!src || !usableLogoPath(src, exists)) return null;
  return { src, alt: firmName };
}
