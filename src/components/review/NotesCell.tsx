"use client";

import { useId, useRef, useState } from "react";
import { logWhatHappenedAction } from "@/app/dashboard/review/actions";
import { shortDate } from "@/lib/review/format";
import { afterNoteSaved, noteBlurOutcome, noteCommitter, noteFirstLine, noteKeyIntent, type NoteCell, type SheetNote } from "@/lib/review/sheet-notes";
import type { ReviewKind } from "@/lib/review/buckets";
import { NOTE_MAX_LENGTH } from "@/lib/pipeline/lead-input";
import { SHEET_NOTE_ADD, SHEET_NOTE_CANT_LOAD, SHEET_NOTE_KEYS, SHEET_NOTE_NOT_SAVED_YET, SHEET_NOTE_SAVE_FAILED, SHEET_NOTE_SAVED, SHEET_NOTE_SAVING, SHEET_SAVE_FAILED, sheetNoteCellLabel } from "@/lib/ui/words";

type Status = "idle" | "saving" | "saved" | "failed" | "unsaved";

/**
 * One Notes cell of the Weekly review's Sheet. Shows the newest plain note (first line, clipped, and its date); a writer
 * clicks in and types. Enter (without Shift) saves ONE plain `note` through the existing review action
 * (`logWhatHappenedAction`, which re-checks the role and the record and revalidates the review). Leaving the cell never
 * saves: typed text stays with "Not saved yet. Press Enter to save." Esc cancels; empty text saves nothing. A failed save
 * keeps the typed text. The note is React text only.
 */
export function NotesCell({
  kind,
  id,
  client,
  cell,
  canEdit,
  today,
  onResult,
}: {
  kind: ReviewKind;
  id: string;
  client: string;
  cell: NoteCell;
  canEdit: boolean;
  today: string;
  /** The owner Sheet passes its save line in; the plain Sheet has none. */
  onResult?: (ok: boolean, message: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  // The note this cell just saved, with the server state it was saved over: once fresh rows arrive they are the truth.
  const [saved, setSaved] = useState<{ note: SheetNote; over: string } | null>(null);
  const committer = useRef<ReturnType<typeof noteCommitter> | null>(null);
  // What the field holds right now (a save that answers late compares against it, not against its own closure).
  const draftRef = useRef("");
  const buttonRef = useRef<HTMLButtonElement>(null);
  const fieldId = `rv-note-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;

  const serverKey = cell.state === "note" ? `${cell.note.date}|${cell.note.text}` : cell.state;
  const shown: NoteCell = saved && saved.over === serverKey ? { state: "note", note: saved.note } : cell;
  const label = sheetNoteCellLabel(client);

  async function save(body: string) {
    setStatus("saving");
    const form = new FormData();
    form.set("kind", kind);
    form.set("id", id);
    form.set("body", body);
    let ok = false;
    let message: string | null = null;
    try {
      const res = await logWhatHappenedAction({}, form);
      ok = !!res.saved;
      message = res.error ?? null;
    } catch {
      ok = false;
    }
    if (ok) {
      setSaved({ note: { text: noteFirstLine(body) ?? body, date: today }, over: serverKey });
      setStatus("saved");
      // Text typed while the save was in flight is kept, in a fresh session (it is a new note, saved by Enter).
      const { keep } = afterNoteSaved(body, draftRef.current);
      if (keep === null) {
        setDraftText("");
        setEditing(false);
      } else {
        committer.current = noteCommitter(save);
      }
    } else {
      setStatus("failed");
    }
    onResult?.(ok, ok ? null : message ?? SHEET_SAVE_FAILED);
    return { ok };
  }

  function open() {
    committer.current = noteCommitter(save);
    setStatus("idle");
    setEditing(true);
  }

  function setDraftText(v: string) {
    draftRef.current = v;
    setDraft(v);
  }

  async function commit() {
    const c = committer.current;
    if (!c) return;
    const out = await c.commit(draftRef.current);
    if (out === "empty") setEditing(false);
  }

  /** Leaving the cell never saves (Enter only): empty closes, text stays with a quiet "Not saved yet" (a failure keeps its own line). */
  function leave() {
    const out = noteBlurOutcome(draftRef.current, !!committer.current?.busy);
    if (out === "close") {
      committer.current?.cancel();
      setEditing(false);
      setStatus("idle");
    } else if (out === "unsaved") {
      setStatus((s) => (s === "failed" ? s : "unsaved"));
    }
  }

  function cancel() {
    committer.current?.cancel();
    setDraftText("");
    setEditing(false);
    setStatus("idle");
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  const text =
    shown.state === "note" ? (
      <>
        <span className="rv-note-text">{shown.note.text}</span>
        <span className="lx-note rv-note-date">{shortDate(shown.note.date, today)}</span>
      </>
    ) : shown.state === "unavailable" ? (
      <span className="lx-note">{SHEET_NOTE_CANT_LOAD}</span>
    ) : canEdit ? (
      <span className="rv-note-add">{SHEET_NOTE_ADD}</span>
    ) : null;

  const statusLine =
    status === "saving"
      ? SHEET_NOTE_SAVING
      : status === "saved"
        ? SHEET_NOTE_SAVED
        : status === "failed"
          ? SHEET_NOTE_SAVE_FAILED
          : status === "unsaved"
            ? SHEET_NOTE_NOT_SAVED_YET
            : null;

  return (
    <div className="rv-notes" data-notes-cell="" data-state={shown.state}>
      {canEdit && editing ? (
        <>
          <label htmlFor={fieldId} className="rv-sr">
            {label}
          </label>
          <textarea
            id={fieldId}
            className="rv-note-in"
            rows={1}
            value={draft}
            maxLength={NOTE_MAX_LENGTH}
            autoFocus
            aria-describedby={`${fieldId}-keys`}
            aria-busy={status === "saving" || undefined}
            onChange={(e) => setDraftText(e.target.value)}
            onKeyDown={(e) => {
              const intent = noteKeyIntent(e.key, e.shiftKey, e.nativeEvent.isComposing);
              if (intent === "commit") {
                e.preventDefault();
                void commit();
              } else if (intent === "cancel") {
                e.preventDefault();
                cancel();
              }
            }}
            onBlur={leave}
          />
          <span id={`${fieldId}-keys`} className="rv-sr">
            {SHEET_NOTE_KEYS}
          </span>
        </>
      ) : canEdit ? (
        <button ref={buttonRef} type="button" className="rv-note-btn" aria-label={label} title={shown.state === "note" ? shown.note.text : undefined} onClick={open}>
          {text}
        </button>
      ) : (
        <span className="rv-note-ro" title={shown.state === "note" ? shown.note.text : undefined}>
          {text}
        </span>
      )}
      {statusLine && (
        <span className={`lx-note rv-note-status${status === "failed" ? " is-error" : ""}`} role="status" aria-live="polite">
          {statusLine}
        </span>
      )}
    </div>
  );
}
