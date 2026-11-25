import { StageMenu } from "@/components/views/stages/StageMenu";
import { MANAGE_STAGES, MANAGE_STAGES_CLOSED, MANAGE_STAGES_HOLDS_UNKNOWN, MANAGE_STAGES_INTAKE, MANAGE_STAGES_INTRO, MANAGE_STAGES_NONE, MANAGE_STAGES_OPEN, manageStagesHolds } from "@/lib/ui/words";
import { stageDisplayName } from "@/lib/matters/list-view";
import { neighbours, stageMenuModel, type MenuStage } from "@/lib/stages/menu-model";

/**
 * "Manage stages": the owner's way to every matter stage the Board does not give a column of its own: the closed stages (folded into
 * one "Closed" column) and the intake stages the Matters page leaves out. Each row has the SAME stage menu as a board column (rename,
 * move, add, change open/closed, delete with a move), the same action and the same rules. Drawn by the page only for an owner
 * membership row and never in a preview; the action asks the row again.
 *
 * Server component over plain data: the menu models are built here, in the page's own order (the firm's stage order, every stage).
 */
export function ManageStages({
  stages,
  holdings,
  merged,
  leftOut,
}: {
  /** Every matter stage the firm has, in pipeline order. */
  stages: readonly (MenuStage & { isOpen: boolean })[];
  /** stage id -> matter ids; null = couldn't be read (no delete, no count, never "empty"). */
  holdings: Record<string, string[]> | null;
  merged?: Record<string, number> | null;
  /** Stage ids the Matters page leaves out (before the signed engagement). */
  leftOut: ReadonlySet<string>;
}) {
  const order = stages.map((s) => s.id);
  return (
    <details className="lx-card lx-disclosure" data-manage-stages="">
      <summary>{MANAGE_STAGES}</summary>
      <p className="lx-note">{MANAGE_STAGES_INTRO}</p>
      {stages.length === 0 ? (
        <p className="lx-note">{MANAGE_STAGES_NONE}</p>
      ) : (
        <ul className="lx-manage-stages">
          {stages.map((stage) => {
            const model = stageMenuModel({ kind: "matter", stage, all: stages, ...neighbours(order, stage.id), holdings, merged });
            const held = holdings ? (holdings[stage.id]?.length ?? 0) : null;
            const state = !stage.isOpen ? MANAGE_STAGES_CLOSED : leftOut.has(stage.id) ? MANAGE_STAGES_INTAKE : MANAGE_STAGES_OPEN;
            return (
              <li key={stage.id} className="lx-manage-stage" data-stage={stage.id}>
                <span className="lx-manage-name">{stageDisplayName(stage.name)}</span>
                <span className="lx-note">
                  {state} · {held === null ? MANAGE_STAGES_HOLDS_UNKNOWN : manageStagesHolds(held)}
                </span>
                <StageMenu model={model} />
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}
