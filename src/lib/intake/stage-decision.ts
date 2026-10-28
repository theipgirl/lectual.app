import type { AgentMoveChip } from "@/lib/stage-keeper/moves";

/**
 * "Why is this lead in this column?" and "does it still need a stage decision?", for the Intake board. Pure and safe
 * for the browser.
 *
 * The Lawmatics importer files everybody in the firm's new-enquiry stage (Lawmatics' own stage names never choose a
 * stage) and, when Lawmatics gave the person a stage or called them hired, records that as a flag on the lead's
 * `lead_created` timeline row: `lawmatics_stage_unmapped` (the Lawmatics stage text, kept for reference),
 * `hired_in_lawmatics` and `stage_id` (where the importer filed the person). The flag is OPEN while the lead is
 * still in that stage; the moment anybody (or the Stage Keeper, or Reconcile) moves the lead, it is decided.
 */

export const NEEDS_DECISION_LABEL = "Needs a stage decision";
export const IMPORTED_DECISION_LABEL = "Imported — stage needs a decision";
export const HIRED_DECISION_LABEL = "Hired in Lawmatics — open a matter";

export type DecisionFlag = {
  /** The Lawmatics stage text, read-only. Null when only "hired" was recorded. */
  lawmaticsStage: string | null;
  hired: boolean;
  /** The stage the importer filed the person in. Null on a flag too old to say, which is never treated as open. */
  stageId: string | null;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The flag a `lead_created` payload carries, or null for any other payload. */
export function parseDecisionFlag(payload: unknown): DecisionFlag | null {
  const p = obj(payload);
  if (p.source !== "lawmatics_import" || !("lawmatics_stage_unmapped" in p || p.hired_in_lawmatics === true)) return null;
  const stage = typeof p.lawmatics_stage_unmapped === "string" ? p.lawmatics_stage_unmapped.trim() : "";
  return {
    lawmaticsStage: stage || null,
    hired: p.hired_in_lawmatics === true,
    stageId: typeof p.stage_id === "string" && p.stage_id ? p.stage_id : null,
  };
}

/** Still waiting for a decision: the lead has not left the stage the importer filed it in. */
export function decisionOpen(flag: DecisionFlag | undefined | null, currentStageId: string): flag is DecisionFlag {
  return !!flag && flag.stageId !== null && flag.stageId === currentStageId;
}

/** The pill on the card: what is to be decided, in the importer's own words. */
export function decisionPillText(flag: DecisionFlag): string {
  return flag.hired ? HIRED_DECISION_LABEL : IMPORTED_DECISION_LABEL;
}

export type WhyLine = { kind: "agent" | "lawmatics" | "imported"; text: string };

/**
 * The one line under a card's name. A Stage Keeper move wins (it is the newest fact and the board already
 * says "automatic"), then the Lawmatics stage text of a lead still waiting for a decision. Anything else is
 * null: the card draws nothing rather than a guess.
 */
export function whyLine(input: { agentMove?: AgentMoveChip; decision?: DecisionFlag | null; currentStageId: string }): WhyLine | null {
  if (input.agentMove?.why) return { kind: "agent", text: input.agentMove.why };
  const flag = input.decision;
  if (decisionOpen(flag, input.currentStageId)) {
    if (flag.lawmaticsStage) return { kind: "lawmatics", text: `Lawmatics: ${flag.lawmaticsStage}` };
    return { kind: "imported", text: IMPORTED_DECISION_LABEL };
  }
  return null;
}
