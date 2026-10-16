/**
 * Pure helpers for member identity. No DB, no server-only imports — these are
 * the bits worth unit-testing without a database (tests/settings/members.test.ts).
 */

/** Trim + lowercase. auth.users stores emails lowercased; comparisons must match. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Deliberately permissive shape check — the authoritative validation is
 * Supabase Auth's, which rejects the address when the invite is sent. This
 * only catches the obvious typo before we spend a round trip.
 */
export function isEmailAddress(value: string): boolean {
  if (!value || /\s/.test(value)) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

/**
 * What to show for a member in the UI. Mirrors the firm layout's displayName()
 * chain (full_name → name → email local part) and falls back to the raw user id
 * only when there is genuinely nothing else — never to an invented name.
 */
export function memberDisplayName(member: {
  displayName?: string | null;
  email?: string | null;
  userId: string;
}): string {
  const named = member.displayName?.trim();
  if (named) return named;
  const email = member.email?.trim();
  if (email) return email.split("@")[0] || email;
  return member.userId;
}
