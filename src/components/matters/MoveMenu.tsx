"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Popover, { PopoverItem } from "@/components/list-page/Popover";
import { updateMatterStageAction } from "@/app/dashboard/matters/[id]/actions";
import { MOVED_CARD_KEY, stageDisplayName } from "@/lib/matters/list-view";

/**
 * A board card's "Move" button: a small menu of the docket stages instead of a full select on every
 * card. Choosing one runs the same role-gated stage action as the matter page. The card's id is kept
 * so the board can bring it back into view after the page refreshes (see MovedCardScroller).
 */
export function MoveMenu({ matterId, stageId, stages }: { matterId: string; stageId: string | null; stages: { id: string; label: string }[] }) {
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
      router.refresh();
    });
  }

  return (
    <div className="lx-board-move">
      <Popover
        label="Move to a stage"
        width={200}
        trigger={({ onClick, ref, ...aria }) => (
          <button {...aria} ref={ref} type="button" onClick={onClick} className="lp-btn" disabled={pending}>
            {pending ? "Moving…" : "Move"}
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
        <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: "4px 0 0" }}>
          {error}
        </p>
      )}
    </div>
  );
}
