"use client";

import { moveStageAction } from "@/app/dashboard/review/actions";
import { MOVED_CARD_KEY, MOVED_GROUP_EVENT } from "@/lib/matters/list-view";
import { phaseGroupOf } from "@/lib/matters/phase-group";
import { savedMark } from "@/lib/record-card/rules";
import { SavedMarkView } from "./SavedMarkView";
import { useRun, viaForm } from "./use-run";
import { CardMenu, NextStepLine, OwnerPick, SourcePick, StagePick } from "./controls";
import type { MatterCardData } from "@/lib/record-card/matter-cards";
import "./record-card.css";

/** The bottom of a matter board card: owner, source and next step (no last-activity read on the docket pages). */
export function MatterCardFoot({ card }: { card: MatterCardData }) {
  return (
    <div className="rc-bottom" data-card-bottom>
      <div className="rc-bottom-row">
        <OwnerPick kind="matter" id={card.id} name={card.name} owner={card.owner} withName />
        <SourcePick kind="matter" id={card.id} name={card.name} value={card.source.value} choices={card.source.choices} compact />
      </div>
      <NextStepLine kind="matter" id={card.id} line={card.nextStep} dueIso={card.dueIso} text={card.bottom.nextStep} />
    </div>
  );
}

/**
 * The ⋯ menu of a matter card or row. A move goes through the review's `moveStageAction` (it answers `{ saved: true }`, so the
 * card can say "Saved"), and keeps what the board's old Move menu did: the card is brought back into view after the page
 * refreshes, and a move into another phase group tells the page (`announceGroup`).
 */
export function MatterCardMenu({ card, type, phases, announceGroup }: { card: MatterCardData; type?: string; phases?: { id: string; phase: string | null }[]; announceGroup?: boolean }) {
  const { pending, mark, run } = useRun();
  const move = (stageId: string) => {
    run(async () => {
      const result = await viaForm(moveStageAction, { kind: "matter", id: card.id, stageId })();
      if (savedMark(result).saved) {
        try {
          sessionStorage.setItem(MOVED_CARD_KEY, card.id);
        } catch {
          // Private mode: the card just isn't scrolled to.
        }
        if (announceGroup && type && phases) {
          const phaseOf = (id: string | null) => phases.find((s) => s.id === id)?.phase ?? null;
          const from = phaseGroupOf({ type, stage: { phase: phaseOf(card.stage.id) } });
          const to = phaseGroupOf({ type, stage: { phase: phaseOf(stageId) } });
          if (from !== to) window.dispatchEvent(new CustomEvent(MOVED_GROUP_EVENT, { detail: { group: to } }));
        }
      }
      return result;
    });
  };
  return (
    <span className="rc-ctl">
      <CardMenu card={card} stepHref={`${card.openHref}#card-steps`} onMovePick={move} />
      {pending ? null : <SavedMarkView mark={mark} />}
    </span>
  );
}

export { OwnerPick, StagePick, NextStepLine };
