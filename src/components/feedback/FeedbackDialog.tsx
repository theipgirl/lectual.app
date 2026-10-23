"use client";

import { useEffect, useId, useRef, useState } from "react";
import { sendFeedbackAction } from "@/app/dashboard/feedback-actions";
import {
  FEEDBACK_DISCLOSURE,
  FEEDBACK_MAX_CHARS,
  FEEDBACK_MESSAGES,
  FEEDBACK_TYPES,
  FEEDBACK_TYPE_LABELS,
  SHOW_FEEDBACK_EVENT,
  type FeedbackType,
} from "@/lib/feedback/constants";
import { beginSend, canSend, finishSend, initialDialogState, type DialogState } from "@/lib/feedback/dialog";
import { buildFeedbackForm } from "@/lib/feedback/form";
import { openerFrom, type OpenerLike } from "@/lib/feedback/open";
import { loadTrail, serializeTrail } from "@/lib/feedback/trail";
import { focusRestoreTarget, tourKeyAction } from "@/lib/onboarding/engine";
import "./feedback.css";

type ViewProps = {
  state: DialogState;
  onType: (t: FeedbackType) => void;
  onText: (text: string) => void;
  onSend: () => void;
  onClose: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  dialogRef?: React.Ref<HTMLDivElement>;
  selectRef?: React.Ref<HTMLSelectElement>;
  textRef?: React.Ref<HTMLTextAreaElement>;
  cancelRef?: React.Ref<HTMLButtonElement>;
  sendRef?: React.Ref<HTMLButtonElement>;
};

/** The dialog itself, presentational so the server renders it the same as the browser. */
export function FeedbackDialogView({ state, onType, onText, onSend, onClose, onKeyDown, dialogRef, selectRef, textRef, cancelRef, sendRef }: ViewProps) {
  const titleId = useId();
  const descId = useId();
  const sending = state.status === "sending";

  return (
    <div className="fb-root">
      <div className="fb-backdrop" />
      <div ref={dialogRef} className="lx-card fb-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="fb-title">
          Send feedback
        </h2>
        {state.status === "sent" ? (
          <>
            <p role="status" className="fb-sent">
              {FEEDBACK_MESSAGES.sent}
            </p>
            <div className="fb-actions">
              <button type="button" className="lx-btn lx-btn-pri lx-btn-sm" onClick={onClose} ref={sendRef}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="lx-field">
              <span className="lx-label">Type</span>
              <select ref={selectRef} className="lx-input" name="type" value={state.type} onChange={(e) => onType(e.target.value as FeedbackType)} disabled={sending}>
                {FEEDBACK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FEEDBACK_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="lx-field">
              <span className="lx-label">What happened, or what do you need?</span>
              <textarea
                ref={textRef}
                className="lx-input fb-text"
                name="description"
                required
                rows={6}
                maxLength={FEEDBACK_MAX_CHARS}
                value={state.description}
                onChange={(e) => onText(e.target.value)}
                disabled={sending}
                aria-describedby={descId}
              />
              <span id={descId} className="lx-note fb-count">
                {`${state.description.length.toLocaleString("en-US")} / ${FEEDBACK_MAX_CHARS.toLocaleString("en-US")}`}
              </span>
            </label>
            <p className="lx-note fb-disclosure">{FEEDBACK_DISCLOSURE}</p>
            {state.error && (
              <p role="alert" className="fb-error">
                {state.error}
              </p>
            )}
            <div className="fb-actions">
              <button type="button" ref={cancelRef} className="lx-btn lx-btn-sec lx-btn-sm" onClick={onClose} disabled={sending}>
                Cancel
              </button>
              <button type="button" ref={sendRef} className="lx-btn lx-btn-pri lx-btn-sm" onClick={onSend} disabled={!canSend(state)}>
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Mounted once in the dashboard layout; the account menu and the Getting started page open it with SHOW_FEEDBACK_EVENT. */
export function FeedbackDialog() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DialogState>(initialDialogState);
  const dialog = useRef<HTMLDivElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const send = useRef<HTMLButtonElement>(null);
  const opener = useRef<OpenerLike | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const onShow = (e: Event) => {
      opener.current = openerFrom(e);
      setState(initialDialogState());
      setOpen(true);
    };
    window.addEventListener(SHOW_FEEDBACK_EVENT, onShow);
    return () => window.removeEventListener(SHOW_FEEDBACK_EVENT, onShow);
  }, []);

  useEffect(() => {
    if (open) (text.current ?? dialog.current)?.focus();
  }, [open]);

  const close = () => {
    if (inFlight.current) return;
    setOpen(false);
    focusRestoreTarget(opener.current)?.focus?.();
  };

  const submit = async () => {
    const next = beginSend(state);
    if (!next || inFlight.current) return;
    inFlight.current = true;
    setState(next);
    const trailJson = serializeTrail(loadTrail(window.sessionStorage));
    const done = await finishSend(next, () => sendFeedbackAction(buildFeedbackForm({ type: next.type, description: next.description, trailJson })));
    inFlight.current = false;
    setState(done);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const controls = [select.current, text.current, cancel.current, send.current].filter((el): el is NonNullable<typeof el> => !!el && !el.disabled);
    const current = controls.findIndex((el) => el === e.target);
    const action = tourKeyAction({ key: e.key, shiftKey: e.shiftKey, inField: true }, { count: controls.length, current });
    if (!action) return;
    if (action.kind === "skip") {
      if (inFlight.current) return;
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (action.kind === "focus") {
      e.preventDefault();
      controls[action.index]?.focus();
    }
  };

  if (!open) return null;
  return (
    <FeedbackDialogView
      state={state}
      onType={(type) => setState((s) => ({ ...s, type }))}
      onText={(description) => setState((s) => ({ ...s, description }))}
      onSend={submit}
      onClose={close}
      onKeyDown={onKeyDown}
      dialogRef={dialog}
      selectRef={select}
      textRef={text}
      cancelRef={cancel}
      sendRef={send}
    />
  );
}
