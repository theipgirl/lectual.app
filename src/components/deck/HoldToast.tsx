"use client";

import { DECK_DONE_HOLD_NOTE, DECK_HOLD_NOTE, DECK_UNDO, deckDoneHolding, deckHolding } from "@/lib/ui/words";

/**
 * The 5-second hold before a Yes is posted. Nothing has happened while it shows: Undo (or closing the tab) leaves the
 * card exactly as it was. The note says so, and that there is no un-approve once it has gone through.
 */
export function HoldToast({ seconds, onUndo, done }: { seconds: number; onUndo: () => void; done?: boolean }) {
  return (
    <div className="dk-hold" role="status" aria-live="polite">
      <div className="dk-toast">
        <span>{done ? deckDoneHolding(seconds) : deckHolding(seconds)}</span>
        <button type="button" className="dk-undo" onClick={onUndo} autoFocus>
          {DECK_UNDO}
        </button>
      </div>
      <div className="dk-toast-bar" aria-hidden="true">
        <i />
      </div>
      <p className="dk-hint">{done ? DECK_DONE_HOLD_NOTE : DECK_HOLD_NOTE}</p>
    </div>
  );
}
