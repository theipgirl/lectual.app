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
