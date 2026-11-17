"use client";

import { SavedNote } from "@/components/ui/SavedNote";
import { RECORD_CARD_SAVED } from "@/lib/ui/words";
import type { SavedMark } from "@/lib/record-card/rules";

/** The quiet "Saved" beside a control, or the action's own fixed sentence. Nothing for an unknown result. */
export function SavedMarkView({ mark }: { mark: SavedMark | null }) {
  if (!mark) return null;
  if (mark.error)
    return (
      <span className="rc-err" role="alert">
        {mark.error}
      </span>
    );
  return <SavedNote show={mark.saved}>{RECORD_CARD_SAVED}</SavedNote>;
}
