"use client";

import { DECK_HOLD_NOTE, DECK_UNDO, deckHolding } from "@/lib/ui/words";

/**
 * The 5-second hold before a Yes is posted. Nothing has happened while it shows: Undo (or closing the tab) leaves the
 * card exactly as it was. The note says so, and that there is no un-approve once it has gone through.
 */
export function HoldToast({ seconds, onUndo }: { seconds: number; onUndo: () => void }) {
  return (
    <div className="dk-hold" role="status" aria-live="polite">
      <div className="dk-toast">
        <span>{deckHolding(seconds)}</span>
        <button type="button" className="dk-undo" onClick={onUndo} autoFocus>
          {DECK_UNDO}
        </button>
      </div>
      <div className="dk-toast-bar" aria-hidden="true">
        <i />
      </div>
      <p className="dk-hint">{DECK_HOLD_NOTE}</p>
    </div>
  );
}
