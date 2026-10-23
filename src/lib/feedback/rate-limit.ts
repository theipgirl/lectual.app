/**
 * Sliding-window limiter, in memory. Per server instance, so on serverless it is a courtesy limit
 * rather than a hard cap (instances do not share it). `allowed` does not consume; `record` does, so a
 * failed send can be retried.
 */
export const FEEDBACK_LIMIT = 5;
export const FEEDBACK_WINDOW_MS = 60 * 60 * 1000;

export type RateLimiter = {
  allowed: (key: string) => boolean;
  record: (key: string) => void;
};

export function createRateLimiter(opts: { max: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  const live = (key: string) => {
    const cutoff = now() - opts.windowMs;
    const kept = (hits.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length === 0) hits.delete(key);
    else hits.set(key, kept);
    return kept;
  };
  return {
    allowed: (key) => live(key).length < opts.max,
    record: (key) => {
      const kept = live(key);
      kept.push(now());
      hits.set(key, kept);
    },
  };
}

export const feedbackLimiter = createRateLimiter({ max: FEEDBACK_LIMIT, windowMs: FEEDBACK_WINDOW_MS });
