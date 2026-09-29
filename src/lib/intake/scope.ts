import type { Lead, Stage } from "@/lib/pipeline";

/**
 * Pure "which leads are intake" arithmetic (blueprint §4.1). No getScopedClient,
 * no server-only imports — this is imported from client components (the
 * `/dashboard/intake` filter bar needs to recompute scope locally), so it must
 * stay safe to bundle for the browser. See src/lib/pipeline/board.ts for the
 * pattern this follows and src/lib/pipeline/index.ts for why that module is
 * kept out of the barrel that pulls in server code.
 */

/**
 * Intake = stages with category in ('open', 'nurture') whose order_index is
 * below the first 'won' stage's order_index. A tenant with no 'won' stage
 * treats every open/nurture stage as intake (nothing to be "below").
 *
 * Deliberately stage-CATEGORY based, not stage-name based, so this resolves
 * the same way for RPB's 21-stage pipeline and the 7-stage tenant default.
 */
export function intakeStages(stages: Stage[]): Stage[] {
  const wonOrderIndexes = stages.filter((s) => s.category === "won").map((s) => s.order_index);
  const firstWonOrderIndex = wonOrderIndexes.length > 0 ? Math.min(...wonOrderIndexes) : null;

  return stages.filter((s) => {
    if (s.category !== "open" && s.category !== "nurture") return false;
    if (firstWonOrderIndex === null) return true;
    return s.order_index < firstWonOrderIndex;
  });
}

/** Convenience wrapper — the id set is what leads.ts filters `current_stage_id` against. */
export function intakeStageIds(stages: Stage[]): Set<string> {
  return new Set(intakeStages(stages).map((s) => s.id));
}

/**
 * Trademarks only (blueprint §4.1). Null practice_area is included — sheet
 * rows land with practice_area unset until the importer stamps 'Trademark',
 * and an unknown practice area should never silently vanish from the view.
 */
export function isTrademarkIntake(lead: Pick<Lead, "practice_area">): boolean {
  if (lead.practice_area == null) return true;
  return lead.practice_area.toLowerCase().includes("trademark");
}
