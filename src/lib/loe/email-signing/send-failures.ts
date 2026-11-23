/**
 * The failure memo (Sprint A item 9b): an in-memory, per-instance count of failed sends per proposal in a 24-hour window, used
 * ONLY when the database could not record a failure (`client_proposal_signing_note_failure` itself errored). Readiness adds it to
 * the database's count on this instance. Per instance, like the limiters: on another instance an unrecorded failure is not seen
 * (a known limit; a recorded one lives in 0117 and is seen everywhere).
 */

export const LOCAL_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

const failures = new Map<string, number[]>();

function live(proposalId: string, now: number): number[] {
  const kept = (failures.get(proposalId) ?? []).filter((t) => t > now - LOCAL_FAILURE_WINDOW_MS);
  if (kept.length === 0) failures.delete(proposalId);
  else failures.set(proposalId, kept);
  return kept;
}

export function noteLocalFailure(proposalId: string, now: number = Date.now()): void {
  const kept = live(proposalId, now);
  kept.push(now);
  failures.set(proposalId, kept);
}

export function localFailures(proposalId: string, now: number = Date.now()): number {
  return live(proposalId, now).length;
}

/** Tests only. */
export function resetLocalFailures(): void {
  failures.clear();
}
