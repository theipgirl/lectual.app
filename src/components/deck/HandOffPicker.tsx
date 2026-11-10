"use client";

import { useId } from "react";
import { DECK_HAND_EYEBROW, DECK_HAND_NOTE_LABEL, DECK_HAND_TO, DECK_HAND_WHY } from "@/lib/ui/words";

export type HandOffPerson = { userId: string; name: string };

/**
 * The inline "Hand off" form: a person and an optional note. When `disabledReason` is set the control is drawn disabled
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
      aria-label={DECK_HAND_EYEBROW}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        onHandOff(String(fd.get("assigneeId") ?? ""), String(fd.get("note") ?? ""));
      }}
    >
      <span className="dk-eyebrow">{DECK_HAND_EYEBROW}</span>
      <div className="dk-handto-row">
        <select name="assigneeId" aria-label={DECK_HAND_TO} defaultValue="" disabled={disabled} aria-describedby={disabledReason ? reasonId : undefined}>
          <option value="" disabled>
            {DECK_HAND_TO}
          </option>
          {people.map((p) => (
            <option key={p.userId} value={p.userId}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="submit" className="dk-ghost" disabled={disabled} aria-describedby={disabledReason ? reasonId : undefined}>
          {DECK_HAND_TO}
        </button>
      </div>
      <label className="dk-row-sub" htmlFor={`${reasonId}-note`}>
        {DECK_HAND_NOTE_LABEL}
      </label>
      <textarea id={`${reasonId}-note`} name="note" rows={2} maxLength={500} disabled={disabled} />
      <p className="dk-hint dk-hint--left">{DECK_HAND_WHY}</p>
      {disabledReason && (
        <p id={reasonId} className="dk-moves-note">
          {disabledReason}
        </p>
      )}
    </form>
  );
}
