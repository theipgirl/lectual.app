"use client";

import { useEffect, useMemo, useState } from "react";

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

const fieldStyle: React.CSSProperties = {
  fontSize: 13,
  fontFamily: "inherit",
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--line)",
  background: "var(--surface)",
  color: "var(--ink)",
  width: "100%",
  boxSizing: "border-box",
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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

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
    <div
      role="presentation"
      // The chip lives inside a table row (and a draggable card) whose own
      // click handler navigates to the lead. Without this, dismissing the
      // dialog by clicking its backdrop would also open the record behind it.
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) onCancel();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 70,
        background: "rgba(20,4,8,.34)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "12vh 16px 16px",
        overflowY: "auto",
        cursor: "default",
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${title} — ${leadName}`}
        style={{
          width: "min(420px, 100%)",
          background: "var(--surface)",
          border: "1px solid var(--line)",
          borderRadius: 14,
          boxShadow: "var(--shadow)",
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 13,
          textAlign: "left",
        }}
      >
        <div>
          <h2 className="intake-serif" style={{ margin: 0, fontSize: 23, lineHeight: 1.1 }}>
            {title}
          </h2>
          <p style={{ margin: "5px 0 0", fontSize: 12, color: "var(--ink2)", lineHeight: 1.5 }}>
            {mode === "stop"
              ? `What were you doing on ${leadName}? One line, for the team — it stays inside the firm.`
              : `Time already spent on ${leadName}. Internal effort only — this is never a client invoice.`}
          </p>
        </div>

        {mode === "manual" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
              <span className="intake-eyebrow">Hours</span>
              <input
                type="number"
                min={0}
                max={12}
                step={1}
                value={hours}
                autoFocus
                onChange={(event) => setHours(event.target.value)}
                style={fieldStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
              <span className="intake-eyebrow">Minutes</span>
              <input
                type="number"
                min={0}
                max={59}
                step={5}
                value={minutes}
                onChange={(event) => setMinutes(event.target.value)}
                style={fieldStyle}
              />
            </label>
            <label style={{ display: "grid", gap: 5, minWidth: 0, gridColumn: "1 / -1" }}>
              <span className="intake-eyebrow">Finished at</span>
              <input
                type="datetime-local"
                value={endedAt}
                onChange={(event) => setEndedAt(event.target.value)}
                style={fieldStyle}
              />
            </label>
          </div>
        )}

        <label style={{ display: "grid", gap: 5, minWidth: 0 }}>
          <span className="intake-eyebrow">Note{mode === "stop" ? "" : " (optional)"}</span>
          <input
            type="text"
            value={note}
            maxLength={200}
            autoFocus={mode === "stop"}
            placeholder="Reviewed the search results"
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit(true);
              }
            }}
            style={fieldStyle}
          />
        </label>

        {(localError || error) && (
          <p
            role="status"
            style={{
              margin: 0,
              fontSize: 11.5,
              lineHeight: 1.45,
              color: "var(--crit)",
              background: "var(--critbg)",
              borderRadius: 8,
              padding: "7px 9px",
            }}
          >
            {localError || error}
          </p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              height: 34,
              padding: "0 12px",
              borderRadius: 9,
              border: "1px solid var(--line)",
              background: "var(--surface)",
              color: "var(--ink2)",
              fontSize: 12.5,
              fontFamily: "inherit",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          {mode === "stop" && (
            // A note is asked for, never demanded: a timer that cannot be
            // stopped without typing something is a timer people stop lying to.
            <button
              type="button"
              disabled={pending}
              onClick={() => submit(false)}
              style={{
                height: 34,
                padding: "0 12px",
                borderRadius: 9,
                border: "1px solid var(--line)",
                background: "var(--surface)",
                color: "var(--ink2)",
                fontSize: 12.5,
                fontFamily: "inherit",
                cursor: pending ? "progress" : "pointer",
              }}
            >
              Stop without a note
            </button>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={() => submit(true)}
            style={{
              height: 34,
              padding: "0 14px",
              borderRadius: 9,
              border: "1px solid var(--ox)",
              background: "var(--ox)",
              color: "var(--cream)",
              fontSize: 12.5,
              fontWeight: 500,
              fontFamily: "inherit",
              cursor: pending ? "progress" : "pointer",
              opacity: pending ? 0.7 : 1,
            }}
          >
            {mode === "stop" ? "Stop timer" : "Log time"}
          </button>
        </div>
      </div>
    </div>
  );
}
