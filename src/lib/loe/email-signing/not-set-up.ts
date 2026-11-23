/**
 * The runtime memo (Sprint A, v2 B1a): ANY `signing_*` rpc or 0117 table read in this feature that answers a missing-object code
 * marks 0117 as not set up for 5 minutes in this server instance (the same idea as `src/lib/leads/live.ts`). While marked, the gate
 * answers `not_set_up` without reading, so the page and in-app signing fall back to today's path. A function dropped on its own
 * after the probe passed is therefore caught by the first call that hits it. Per instance, like the limiters.
 */

export const NOT_SET_UP_MEMO_MS = 5 * 60 * 1000;

let markedAt: number | null = null;

export function markSigningNotSetUp(now: number = Date.now()): void {
  markedAt = now;
}

export function signingNotSetUp(now: number = Date.now()): boolean {
  if (markedAt === null) return false;
  if (now - markedAt >= NOT_SET_UP_MEMO_MS) {
    markedAt = null;
    return false;
  }
  return true;
}

/** Tests only. */
export function resetSigningNotSetUp(): void {
  markedAt = null;
}
