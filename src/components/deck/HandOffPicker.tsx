"use client";

import { useId } from "react";
import "@/components/review/review.css";
import { DECK_HAND_NOTE_LABEL, DECK_HAND_TO } from "@/lib/ui/words";

export type HandOffPerson = { userId: string; name: string };

/**
 * The inline "Hand to" picker: a person and an optional note. Drawn to look like the weekly review deck's "Hand to"
 * form (`rv-handto`), so the two decks read as one control. When `disabledReason` is set the control is drawn disabled
 * with that sentence beside it. The action decides on the server whether the hand-off may happen.
 */
export function HandOffPicker({
  people,
  disabledReason,
  pending,
  onHandOff,
}: {
  people: HandOffPerson[];
  disabledReason: string | null;
  pending?: boolean;
  onHandOff: (userId: string, note: string) => void;
}) {
  const reasonId = useId();
  const disabled = !!disabledReason || pending;
  return (
    <form
      className="dk-handto"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onHandOff(String(fd.get("assigneeId") ?? ""), String(fd.get("note") ?? ""));
      }}
    >
      <div className="rv-handto">
        <select className="lx-input" name="assigneeId" aria-label={DECK_HAND_TO} defaultValue="" disabled={disabled} aria-describedby={disabledReason ? reasonId : undefined}>
          <option value="" disabled>
            {DECK_HAND_TO}
          </option>
          {people.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="submit" className="lx-btn lx-btn-sec" disabled={disabled} aria-describedby={disabledReason ? reasonId : undefined}>
          {DECK_HAND_TO}
        </button>
      </div>
      <input className="lx-input" name="note" type="text" maxLength={500} aria-label={DECK_HAND_NOTE_LABEL} placeholder={DECK_HAND_NOTE_LABEL} disabled={disabled} />
      {disabledReason && (
        <p id={reasonId} className="lx-note" style={{ margin: 0 }}>
          {disabledReason}
        </p>
      )}
    </form>
  );
}
