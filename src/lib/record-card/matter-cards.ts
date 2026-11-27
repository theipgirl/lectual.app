import type { Matter } from "@/lib/matters";
import { stageDisplayName } from "@/lib/matters/list-view";
import { buildBoardCard, type CardContext, type CardRead, type CardTask, type CardView } from "./model";

/** The per-matter card data the Matters page hands its board and list (Sprint 10 Part 2). PURE; plain data. */
export type MatterCardData = CardView & { dueIso: string | null };

export function buildMatterCards(opts: { matters: readonly Matter[]; ctx: CardContext; steps: CardRead<Record<string, CardTask | null>> }): Record<string, MatterCardData> {
  const out: Record<string, MatterCardData> = {};
  for (const m of opts.matters) {
    const nextStep: CardRead<CardTask | null> = opts.steps.status === "ok" ? { status: "ok", value: opts.steps.value[m.id] ?? null } : { status: "unavailable" };
    const view = buildBoardCard(
      {
        kind: "matter",
        matter: { id: m.id, title: m.title, mark_text: m.mark_text, owner_name: m.owner_name, matter_number: m.matter_number, stage_id: m.stage_id, assigned_to: m.assigned_to, referral_source: m.referral_source },
        stageName: m.stage ? stageDisplayName(m.stage.label) : null,
        nextStep,
        // The docket pages don't read activity per matter, so the bottom line says nothing about it (see sprint-10.md).
        lastActivityAt: null,
      },
      opts.ctx,
    );
    const due = nextStep.status === "ok" && nextStep.value?.dueAt && /^\d{4}-\d{2}-\d{2}/.test(nextStep.value.dueAt) ? nextStep.value.dueAt.slice(0, 10) : null;
    // The docket's stage names lose their "3. " ordering prefix everywhere they are shown (list-view's rule).
    out[m.id] = { ...view, stage: { ...view.stage, targets: view.stage.targets.map((t) => ({ ...t, name: stageDisplayName(t.name) })) }, dueIso: due };
  }
  return out;
}
