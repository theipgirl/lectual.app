import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Vercel Cron calls with `Authorization: Bearer <CRON_SECRET>`. Fail closed:
 * with no secret configured nothing is authorised, so an unset env var can
 * never turn a cron route into a public "run the sync" button.
 */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  // Hash both sides so the comparison is constant-time regardless of length.
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}
