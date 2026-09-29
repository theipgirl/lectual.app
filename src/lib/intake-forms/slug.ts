/**
 * The public intake's address: `<origin>/i/<slug>`.
 *
 * `SLUG_PATTERN` is 0079's `crm_intake_form_slug_shape` check, character for
 * character: 3–60 characters of a-z, 0-9 and hyphens, starting and ending
 * with a letter or digit. Everything here produces strings that pass it, so
 * an insert never trips the check constraint.
 *
 * Slugs are unique ACROSS firms (`crm_intake_form_slug_key`), and a firm's
 * scoped client cannot see other firms' rows to check first. So uniqueness
 * is settled by the database: the store tries `slugCandidates()` in order and
 * moves on when the insert hits the unique violation.
 *
 * The slug is fixed once the draft exists. The design derives the link from
 * the firm-name field as you type, but a live link that moves whenever
 * someone edits a display name breaks every site that embedded it.
 */

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;
const MAX = 60;

export function isValidSlug(s: string): boolean {
  return SLUG_PATTERN.test(s);
}

/** "Hartwell IP (demo)" → "hartwell-ip-demo". Always passes SLUG_PATTERN. */
export function slugFromFirmName(name: string): string {
  let s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  s = trimTo(s, MAX);
  if (s.length < 3) s = s ? `${s}-intake` : "firm-intake";
  return s;
}

function trimTo(s: string, max: number): string {
  return s.slice(0, max).replace(/-+$/g, "");
}

/**
 * `base`, then `base-2` … `base-9`, then `base-<random>`: the order the store
 * tries them in. Every candidate passes SLUG_PATTERN; the base is shortened
 * when a suffix would push it past 60 characters.
 */
export function slugCandidates(base: string, random: () => string = randomSuffix): string[] {
  const root = isValidSlug(base) ? base : slugFromFirmName(base);
  const withSuffix = (suffix: string) => `${trimTo(root, MAX - suffix.length - 1)}-${suffix}`;
  const out = [root];
  for (let n = 2; n <= 9; n++) out.push(withSuffix(String(n)));
  out.push(withSuffix(random()), withSuffix(random()));
  return out.filter(isValidSlug);
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(4, "0");
}
