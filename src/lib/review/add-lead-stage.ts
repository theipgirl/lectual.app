import { reviewLeadStageIds } from "./build";
import { newEnquiryStage } from "@/lib/pipeline/new-enquiry";
import { inPipelineOrder } from "@/lib/pipeline/stage-order";

/**
 * Where "Add a lead" on the Weekly review List may start a lead. Pure.
 *
 * The picker offers the firm's OPEN lead stages only, in pipeline order (the board's order). Won, lost and nurture are never offered, and
 * the server re-checks the posted id against the firm's own stage list: a missing, foreign or non-open id is refused. A lead started in
 * a stage past first contact (`reviewLeadStageIds`) shows in the List at once; one started in the new-enquiry stage joins it later.
 */
export type StageIn = { id: string; name: string; category?: string | null; order_index: number | null };

export function startStages<T extends StageIn>(stages: readonly T[]): T[] {
  return inPipelineOrder(stages.filter((s) => s.category === "open"));
}

/** The stage the picker starts on: the firm's new-enquiry stage, else the first open one. */
export function defaultStartStageId(stages: readonly StageIn[]): string | null {
  return (newEnquiryStage(stages) ?? startStages(stages)[0])?.id ?? null;
}

export type StageChoice = { ok: true; /** null = no stage posted: `createLead` uses the new-enquiry stage. */ stageId: string | null; joinsList: boolean } | { ok: false; reason: "not-open" };

/** The posted stage id against the stage list the server read itself. */
export function chooseStartStage(stages: readonly StageIn[], posted: unknown): StageChoice {
  // Anything but a string (or nothing at all) is not an id of ours.
  if (posted !== undefined && posted !== null && typeof posted !== "string") return { ok: false, reason: "not-open" };
  const id = typeof posted === "string" ? posted.trim() : "";
  const defaultId = newEnquiryStage(stages)?.id ?? null;
  const past = reviewLeadStageIds(stages);
  if (id === "") return { ok: true, stageId: null, joinsList: defaultId !== null && past.has(defaultId) };
  const stage = stages.find((s) => s.id === id);
  if (!stage || stage.category !== "open") return { ok: false, reason: "not-open" };
  return { ok: true, stageId: stage.id, joinsList: past.has(stage.id) };
}
