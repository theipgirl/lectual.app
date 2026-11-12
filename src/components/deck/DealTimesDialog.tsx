"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveDealTimesAction } from "@/lib/account/deal-times-actions";
import { dealTimeOptions, SHOW_DEAL_TIMES_EVENT, validateDealTimes, type DealTimesPair } from "@/lib/deal/person-times";
import { focusRestoreTarget, tourKeyAction } from "@/lib/onboarding/engine";
import type { OpenerLike } from "@/lib/feedback/open";
import {
  DEAL_TIMES_CANCEL,
  DEAL_TIMES_FIRST,
  DEAL_TIMES_NOTE,
  DEAL_TIMES_NOT_SAVED,
  DEAL_TIMES_SAVE,
  DEAL_TIMES_SAVING,
  DEAL_TIMES_SECOND,
  DEAL_TIMES_TITLE,
  dealTimesZoneLine,
} from "@/lib/ui/words";
import "@/components/feedback/feedback.css";
import "./deal-times.css";

type ViewProps = {
  first: string;
  second: string;
  zoneLabel: string;
  error: string | null;
  saving: boolean;
  onFirst: (v: string) => void;
  onSecond: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  dialogRef?: React.Ref<HTMLDivElement>;
  firstRef?: React.Ref<HTMLSelectElement>;
  secondRef?: React.Ref<HTMLSelectElement>;
  cancelRef?: React.Ref<HTMLButtonElement>;
  saveRef?: React.Ref<HTMLButtonElement>;
};

const OPTIONS = dealTimeOptions();

/** Presentational, so the server renders it the same as the browser. Follows YourNameDialog. */
export function DealTimesDialogView({ first, second, zoneLabel, error, saving, onFirst, onSecond, onSave, onClose, onKeyDown, dialogRef, firstRef, secondRef, cancelRef, saveRef }: ViewProps) {
  const titleId = useId();
  const noteId = useId();
  const select = (label: string, value: string, onChange: (v: string) => void, ref?: React.Ref<HTMLSelectElement>) => (
    <label className="lx-field">
      <span className="lx-label">{label}</span>
      <select ref={ref} className="lx-input" value={value} onChange={(e) => onChange(e.target.value)} disabled={saving} aria-describedby={noteId}>
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="fb-root dt-root">
      <div className="fb-backdrop" />
      <div ref={dialogRef} className="lx-card fb-dialog dt-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="fb-title">
          {DEAL_TIMES_TITLE}
        </h2>
        {select(DEAL_TIMES_FIRST, first, onFirst, firstRef)}
        {select(DEAL_TIMES_SECOND, second, onSecond, secondRef)}
        <p id={noteId} className="lx-note fb-disclosure">
          {dealTimesZoneLine(zoneLabel)}.{" "}
          {DEAL_TIMES_NOTE}
        </p>
        {error && (
          <p role="alert" className="fb-error">
            {error}
          </p>
        )}
        <div className="fb-actions">
          <button type="button" ref={cancelRef} className="lx-btn lx-btn-sec lx-btn-sm" onClick={onClose} disabled={saving}>
            {DEAL_TIMES_CANCEL}
          </button>
          <button type="button" ref={saveRef} className="lx-btn lx-btn-pri lx-btn-sm" onClick={onSave} disabled={saving}>
            {saving ? DEAL_TIMES_SAVING : DEAL_TIMES_SAVE}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Mounted once in the OWNER view's dashboard layout; the deck header and the account menu open it with SHOW_DEAL_TIMES_EVENT. */
export function DealTimesDialog({ current, zoneLabel }: { current: DealTimesPair; zoneLabel: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState(current[0]);
  const [second, setSecond] = useState(current[1]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const firstEl = useRef<HTMLSelectElement>(null);
  const secondEl = useRef<HTMLSelectElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const save = useRef<HTMLButtonElement>(null);
  const opener = useRef<OpenerLike | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const onShow = (e: Event) => {
      opener.current = (e as CustomEvent<{ opener?: OpenerLike | null }>).detail?.opener ?? null;
      setFirst(current[0]);
      setSecond(current[1]);
      setError(null);
      setOpen(true);
    };
    window.addEventListener(SHOW_DEAL_TIMES_EVENT, onShow);
    return () => window.removeEventListener(SHOW_DEAL_TIMES_EVENT, onShow);
  }, [current]);

  useEffect(() => {
    if (open) (firstEl.current ?? dialog.current)?.focus();
  }, [open]);

  const close = () => {
    if (inFlight.current) return;
    setOpen(false);
    focusRestoreTarget(opener.current)?.focus?.();
  };

  const submit = async () => {
    if (inFlight.current) return;
    const checked = validateDealTimes(first, second);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setError(null);
    let result: Awaited<ReturnType<typeof saveDealTimesAction>>;
    try {
      result = await saveDealTimesAction({ times: checked.times });
    } catch {
      result = { ok: false, error: DEAL_TIMES_NOT_SAVED };
    }
    inFlight.current = false;
    setSaving(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    focusRestoreTarget(opener.current)?.focus?.();
    router.refresh();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const controls = [firstEl.current, secondEl.current, cancel.current, save.current].filter((el): el is NonNullable<typeof el> => !!el && !el.disabled);
    const index = controls.findIndex((el) => el === e.target);
    const action = tourKeyAction({ key: e.key, shiftKey: e.shiftKey, inField: true }, { count: controls.length, current: index });
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
    <DealTimesDialogView
      first={first}
      second={second}
      zoneLabel={zoneLabel}
      error={error}
      saving={saving}
      onFirst={setFirst}
      onSecond={setSecond}
      onSave={submit}
      onClose={close}
      onKeyDown={onKeyDown}
      dialogRef={dialog}
      firstRef={firstEl}
      secondRef={secondEl}
      cancelRef={cancel}
      saveRef={save}
    />
  );
}
