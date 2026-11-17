"use client";

import { useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";
import { CANCEL } from "@/lib/ui/words";

/**
 * The two prompts behind the ⏱ (blueprint §13.1): the one-line note asked for
 * on Stop, and the "+ time" form for work that already happened.
 *
 * One component for both because they are the same dialog with a different
 * number of fields, and a firm should not have to learn two shapes for
 * "describe what you just did".
 *
 * Everything it collects is an INTERNAL memo about internal effort. Nothing
 * typed here is sent to anyone, and a time entry is never a client invoice.
 *
 * The two rules it enforces on a manual entry — nothing over 12 hours, nothing
 * in the future — are a courtesy, not the guard: src/lib/time/entries.ts
 * refuses both again server-side, where a typed number cannot be edited past
 * them.
 */

/**
 * Twelve hours, mirroring MAX_MANUAL_SECONDS in src/lib/time/entries.ts. The
 * server is the guard; this is what lets the dialog say so before a round
 * trip. Change one, change both.
 */
export const MAX_MANUAL_SECONDS_UI = 12 * 3600;

/** What the dialog hands back: a Stop carries only a note, "+ time" carries all three. */
export type TimeEntrySubmit = {
  /** Manual entries only — a Stop's duration is measured server-side. */
  seconds: number | null;
  note: string | null;
  /** When the work ENDED, ISO. Manual entries only. */
  atIso: string | null;
};

/** `YYYY-MM-DDTHH:mm` in the reader's own zone — what datetime-local wants. */
function localInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

export default function TimeEntryDialog({
  mode,
  leadName,
  pending,
  error,
  onCancel,
  onSubmit,
}: {
  mode: "stop" | "manual";
  leadName: string;
  pending: boolean;
  /** A server refusal, rendered in the dialog rather than behind it. */
  error?: string | null;
  onCancel: () => void;
  onSubmit: (input: TimeEntrySubmit) => void;
}) {
  const [note, setNote] = useState("");
  const [hours, setHours] = useState("0");
  const [minutes, setMinutes] = useState("15");
  // Captured once, on open: the default is "it ended just now", and a value
  // that kept re-deriving would move under the cursor while someone typed.
  const [endedAt, setEndedAt] = useState(() => localInputValue(new Date()));
  const [localError, setLocalError] = useState<string | null>(null);

  const hoursRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);

  const seconds = useMemo(() => {
    const h = Number.parseInt(hours, 10);
    const m = Number.parseInt(minutes, 10);
    return (Number.isFinite(h) ? h : 0) * 3600 + (Number.isFinite(m) ? m : 0) * 60;
  }, [hours, minutes]);

  const title = mode === "stop" ? "Stop the timer" : "Log time";

  function submit(withNote: boolean) {
    setLocalError(null);

    if (mode === "stop") {
      onSubmit({ seconds: null, note: withNote ? note.trim() || null : null, atIso: null });
      return;
    }

    if (seconds <= 0) {
      setLocalError("How long was it? Enter a duration above zero.");
      return;
    }
    if (seconds > MAX_MANUAL_SECONDS_UI) {
      setLocalError("That's more than 12 hours — log it as more than one entry.");
      return;
    }
    const ended = new Date(endedAt);
    if (Number.isNaN(ended.getTime())) {
      setLocalError("That isn't a date we can read.");
      return;
    }
    if (ended.getTime() > Date.now() + 60_000) {
      setLocalError("You can't log time in the future.");
      return;
    }
    onSubmit({ seconds, note: note.trim() || null, atIso: ended.toISOString() });
  }

  return (
    <Dialog
      size="sm"
      title={title}
      onClose={onCancel}
      initialFocus={mode === "stop" ? noteRef : hoursRef}
      footer={
        <>
          <button type="button" className="lx-btn lx-btn-sec" onClick={onCancel}>
            {CANCEL}
          </button>
          {mode === "stop" && (
            // A note is asked for, never demanded: a timer that cannot be
            // stopped without typing something is a timer people stop lying to.
            <button type="button" className="lx-btn lx-btn-sec" disabled={pending} onClick={() => submit(false)}>
              Stop without a note
            </button>
          )}
          <button type="button" className="lx-btn lx-btn-pri" disabled={pending} onClick={() => submit(true)}>
            {mode === "stop" ? "Stop timer" : "Log time"}
          </button>
        </>
      }
    >
      <p className="lx-note">
        {mode === "stop"
          ? `What were you doing on ${leadName}? One line, for the team — it stays inside the firm.`
          : `Time already spent on ${leadName}. Internal effort only — this is never a client invoice.`}
      </p>

      {mode === "manual" && (
        <div className="ix-time-grid">
          <Field label="Hours">
            <input ref={hoursRef} type="number" className="lx-input" min={0} max={12} step={1} value={hours} onChange={(event) => setHours(event.target.value)} />
          </Field>
          <Field label="Minutes">
            <input type="number" className="lx-input" min={0} max={59} step={5} value={minutes} onChange={(event) => setMinutes(event.target.value)} />
          </Field>
          <div className="ix-time-wide">
            <Field label="Finished at">
              <input type="datetime-local" className="lx-input" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} />
            </Field>
          </div>
        </div>
      )}

      <Field label="Note" optional={mode !== "stop"}>
        <input
          ref={noteRef}
          type="text"
          className="lx-input"
          value={note}
          maxLength={200}
          placeholder="Reviewed the search results"
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit(true);
            }
          }}
        />
      </Field>

      {(localError || error) && (
        <Notice tone="risk" role="status">
          {localError || error}
        </Notice>
      )}
    </Dialog>
  );
}
