"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MOVED_GROUP_EVENT } from "@/lib/matters/list-view";
import { isPhaseGroup, type PhaseGroup } from "@/lib/matters/phase-group";
import { MATTER_GROUP_LABEL, MATTER_MOVED_TO } from "@/lib/ui/words";

/**
 * One quiet line after a board Move takes a card into another group: the card leaves this group's board, so it says
 * where it went and links there. Nothing is stored; a reload clears it.
 */
export function MovedOutNotice() {
  const [group, setGroup] = useState<PhaseGroup | null>(null);
  useEffect(() => {
    const onMoved = (e: Event) => {
      const g = (e as CustomEvent<{ group?: unknown }>).detail?.group;
      if (isPhaseGroup(g)) setGroup(g);
    };
    window.addEventListener(MOVED_GROUP_EVENT, onMoved);
    return () => window.removeEventListener(MOVED_GROUP_EVENT, onMoved);
  }, []);
  return (
    <p role="status" className="lx-note" style={{ margin: 0 }}>
      {group && (
        <>
          {MATTER_MOVED_TO}{" "}
          <Link href={`/dashboard/matters/?group=${group}&view=board`}>{MATTER_GROUP_LABEL[group]}</Link>.
        </>
      )}
    </p>
  );
}
