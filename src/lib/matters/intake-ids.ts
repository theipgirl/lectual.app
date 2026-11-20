import { loadMatterStages } from "./stages";
import { inIntakeStage, intakeStageIds } from "./phase-group";

/**
 * The intake stage ids, for the pages that count matters (Today, Copilot) the way the Matters page draws them: a matter
 * still in an intake stage is not an "open matter" there. Never throws. A database with no phase column has no intake
 * stages (empty set); a failed stage read is `null`, and callers then count every matter, as before the rule.
 */
export async function loadIntakeStageIds(): Promise<ReadonlySet<string> | null> {
  try {
    const read = await loadMatterStages();
    if (read.status === "unavailable") return null;
    return read.status === "ok" ? intakeStageIds(read.stages) : new Set();
  } catch {
    return null;
  }
}

/** The matters past intake. With no ids (unknown) every matter stays. */
export function withoutIntake<M extends { stage_id?: string | null }>(matters: readonly M[], intakeIds: ReadonlySet<string> | null): M[] {
  return intakeIds && intakeIds.size > 0 ? matters.filter((m) => !inIntakeStage(m, intakeIds)) : [...matters];
}
