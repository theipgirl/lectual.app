import { matterStageWithRole } from "@/lib/stages/roles";

/**
 * The docket stage the Lawmatics hired-matter sync files every new TM matter on, and the one rule that names it.
 * Pure (no server imports) so the sync's planner and the Matters page's intake rule share ONE definition: the
 * Matters page draws a matter from this stage on, and nothing before it (see phase-group.ts `intakeStageIds`).
 */
export const TM_HIRED_STAGE_LABEL = "Signed LOE / Deposit Received";

/** True for the hired-sync stage. Exact label, exactly as the sync matches it (`planHiredSync`). */
export function isHiredStage(stage: { label: string }): boolean {
  return stage.label === TM_HIRED_STAGE_LABEL;
}

/**
 * The firm's hired-sync stage, ROLE FIRST (lectual 0119): the open stage holding the matter `signed_loe` role, so a rename keeps
 * the sync filing on it and the Matters page drawing from it. With no role, the first stage whose label is exactly
 * `TM_HIRED_STAGE_LABEL` (`isHiredStage`), as before. Null when neither finds one.
 */
export function hiredStageOf<T extends { label: string; role?: string | null; is_open?: boolean | null }>(stages: readonly T[]): T | null {
  return matterStageWithRole(stages, "signed_loe") ?? stages.find((s) => isHiredStage(s)) ?? null;
}
