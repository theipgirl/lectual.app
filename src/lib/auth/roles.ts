/**
 * Privilege order. Lower index = more privilege; `hasRole` is a rank
 * comparison over this array, so THE ORDER IS LOAD-BEARING.
 *
 * `attorney` sits directly under the admin tier — above intake, paralegal,
 * law clerk and social media. It historically sat at index 7, below all of
 * them, which meant the practising attorney was the second-least-privileged
 * person in her own firm: locked out of every `senior_admin`-gated surface
 * AND outranked by the paralegal in every ceiling comparison. Every
 * consumer had quietly worked around it with explicit role arrays
 * (CLAIM_REVIEW_ROLES, MATTER_WRITE_ROLES, QUEUE_APPROVE_ROLES…), which is
 * why the inversion never bit — but it was a live trap for the first call
 * site to write `hasRole(role, "attorney")`.
 *
 * Reordering is behavior-neutral for every existing gate: the only
 * threshold used anywhere is "senior_admin" (verified by grep), and
 * attorney is above it in neither ordering. The explicit role arrays are
 * unaffected by rank entirely.
 *
 * This array is NOT the Postgres `crm_role` enum's order — that enum is
 * unordered in practice (RLS policies use explicit role lists, never enum
 * comparison). Only membership must match; tests assert it.
 */
export const ROLES = [
  "owner",
  "admin",
  "senior_admin",
  "attorney",
  "intake",
  "paralegal",
  "law_clerk",
  "social_media",
  "clerk",
  "viewer",
] as const;
export type Role = (typeof ROLES)[number];

// Lower index = more privilege. owner (0) outranks everyone.
const RANK: Record<Role, number> = ROLES.reduce(
  (acc, r, i) => ((acc[r] = i), acc),
  {} as Record<Role, number>,
);

/** True if `actual` is at least as privileged as `required`. */
export function hasRole(actual: Role, required: Role): boolean {
  return RANK[actual] <= RANK[required];
}

/** Throws if the actual role is insufficient. Use in server actions/route handlers. */
export function requireRole(actual: Role, required: Role): void {
  if (!hasRole(actual, required)) {
    throw new Error(`Forbidden: requires ${required}, has ${actual}`);
  }
}
