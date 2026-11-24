import { stageForSignal, type StageMapping } from "@/lib/agents/stage-keeper/mapping";
import type { StageOpt } from "@/lib/reconcile/types";

/**
 * Is this the firm's consult-scheduled stage? The Stage Keeper's own resolver answers (`stageForSignal`: the firm
 * notes' mapping first, else the default names), so there is ONE rule for what "Consultation Scheduled" means.
 * A firm with no such stage has none: never a first-stage guess.
 */
export function consultScheduledStage(stages: readonly StageOpt[], mapping: StageMapping): StageOpt | null {
  return stageForSignal("consult-scheduled", stages, mapping);
}

export function isConsultScheduledStage(stageId: string | null | undefined, stages: readonly StageOpt[], mapping: StageMapping): boolean {
  if (!stageId) return false;
  const stage = consultScheduledStage(stages, mapping);
  return stage !== null && stage.id === stageId;
}
