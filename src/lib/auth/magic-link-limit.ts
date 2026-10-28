/**
 * Courtesy limit on sign-in link requests, keyed by the typed address. In memory per server
 * instance (like the feedback limiter), so on serverless it is a soft cap; Supabase's own limit
 * still applies behind it. The address is only a Map key: never logged, never stored.
 */
export const MAGIC_LINK_GAP_MS = 30 * 1000;
export const MAGIC_LINK_WINDOW_MS = 10 * 60 * 1000;
export const MAGIC_LINK_MAX_PER_WINDOW = 5;

export type MagicLinkLimiter = {
  /** True when a request may go now; a true answer records it. */
  take: (email: string) => boolean;
};

export function createMagicLinkLimiter(now: () => number = () => Date.now()): MagicLinkLimiter {
  const hits = new Map<string, number[]>();
  return {
    take(email) {
      const t = now();
      const kept = (hits.get(email) ?? []).filter((h) => h > t - MAGIC_LINK_WINDOW_MS);
      const last = kept[kept.length - 1];
      if (
        (last !== undefined && t - last < MAGIC_LINK_GAP_MS) ||
        kept.length >= MAGIC_LINK_MAX_PER_WINDOW
      ) {
        hits.set(email, kept);
        return false;
      }
      kept.push(t);
      hits.set(email, kept);
      return true;
    },
  };
}

export const magicLinkLimiter = createMagicLinkLimiter();
