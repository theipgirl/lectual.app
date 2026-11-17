"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Popover, { PopoverItem } from "@/components/list-page/Popover";
import { updateMatterStageAction } from "@/app/dashboard/matters/[id]/actions";
import { MOVED_CARD_KEY, MOVED_GROUP_EVENT, stageDisplayName } from "@/lib/matters/list-view";
import { Icon, Notice } from "@/components/ui";
import { phaseGroupOf } from "@/lib/matters/phase-group";

/**
 * A board card's "Move" button: a small menu of the docket stages instead of a full select on every
 * card. Choosing one runs the same role-gated stage action as the matter page. The card's id is kept
 * so the board can bring it back into view after the page refreshes (see MovedCardScroller).
 */
export function MoveMenu({
  matterId,
  title,
  stageId,
  stages,
  type,
  announceGroup,
}: {
  matterId: string;
  /** The matter's name, for the trigger's accessible name ("Move <title>"). */
  title: string;
  stageId: string | null;
  stages: { id: string; label: string; phase?: string | null }[];
  type?: string;
  /** A phase-group board: a move into another group tells the page, which says where the card went. */
  announceGroup?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function move(next: string, close: () => void) {
    close();
    if (next === stageId) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("matterId", matterId);
      fd.set("stageId", next);
      const res = await updateMatterStageAction({}, fd);
      if (res.error) {
        setError(res.error);
        return;
      }
      try {
        sessionStorage.setItem(MOVED_CARD_KEY, matterId);
      } catch {
        // Private mode: the card just isn't scrolled to.
      }
      if (announceGroup && type) {
        const from = phaseGroupOf({ type, stage: { phase: stages.find((s) => s.id === stageId)?.phase ?? null } });
        const to = phaseGroupOf({ type, stage: { phase: stages.find((s) => s.id === next)?.phase ?? null } });
        if (from !== to) window.dispatchEvent(new CustomEvent(MOVED_GROUP_EVENT, { detail: { group: to } }));
      }
      router.refresh();
    });
  }

  return (
    <div className="lx-board-move">
      <Popover
        label="Move to a stage"
        width={200}
        trigger={({ onClick, ref, ...aria }) => (
          <button {...aria} ref={ref} type="button" onClick={onClick} className="lx-board-menu" disabled={pending} aria-busy={pending} aria-label={`Move ${title}`}>
            <Icon name="more" />
          </button>
        )}
      >
        {(close) =>
          stages.map((s) => (
            <PopoverItem key={s.id} checked={s.id === stageId} onSelect={() => move(s.id, close)}>
              {stageDisplayName(s.label)}
            </PopoverItem>
          ))
        }
      </Popover>
      {error && (
        <Notice tone="risk" role="alert">
          {error}
        </Notice>
      )}
    </div>
  );
}
