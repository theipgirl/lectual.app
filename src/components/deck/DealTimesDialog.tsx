"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveDealTimesAction } from "@/lib/account/deal-times-actions";
import { dealTimeOptions, SHOW_DEAL_TIMES_EVENT, validateDealTimes, type DealTimesPair } from "@/lib/deal/person-times";
import { focusRestoreTarget } from "@/lib/onboarding/engine";
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
import { Dialog } from "@/components/ui/Dialog";
import { Notice } from "@/components/ui/Notice";
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
  firstRef?: React.RefObject<HTMLSelectElement | null>;
  secondRef?: React.Ref<HTMLSelectElement>;
};

const OPTIONS = dealTimeOptions();

/** Presentational, so the server renders it the same as the browser. Follows YourNameDialog. */
export function DealTimesDialogView({ first, second, zoneLabel, error, saving, onFirst, onSecond, onSave, onClose, firstRef, secondRef }: ViewProps) {
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
    <Dialog
      size="sm"
      className="dt-dialog"
      title={DEAL_TIMES_TITLE}
      titleId={titleId}
      onClose={onClose}
      initialFocus={firstRef as React.RefObject<HTMLElement | null> | undefined}
      footer={
        <>
          <button type="button" className="lx-btn lx-btn-sec" onClick={onClose} disabled={saving}>
            {DEAL_TIMES_CANCEL}
          </button>
          <button type="button" className="lx-btn lx-btn-pri" onClick={onSave} disabled={saving}>
            {saving ? DEAL_TIMES_SAVING : DEAL_TIMES_SAVE}
          </button>
        </>
      }
    >
      {select(DEAL_TIMES_FIRST, first, onFirst, firstRef)}
      {select(DEAL_TIMES_SECOND, second, onSecond, secondRef)}
      <p id={noteId} className="lx-note">
        {dealTimesZoneLine(zoneLabel)}.{" "}
        {DEAL_TIMES_NOTE}
      </p>
      {error && (
        <Notice tone="risk" role="alert">
          {error}
        </Notice>
      )}
    </Dialog>
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
  const firstEl = useRef<HTMLSelectElement>(null);
  const secondEl = useRef<HTMLSelectElement>(null);
  const opener = useRef<OpenerLike | null>(null);
  const currentRef = useRef(current);
  const inFlight = useRef(false);

  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    const onShow = (e: Event) => {
      opener.current = (e as CustomEvent<{ opener?: OpenerLike | null }>).detail?.opener ?? null;
      setFirst(currentRef.current[0]);
      setSecond(currentRef.current[1]);
      setError(null);
      setOpen(true);
    };
    window.addEventListener(SHOW_DEAL_TIMES_EVENT, onShow);
    return () => window.removeEventListener(SHOW_DEAL_TIMES_EVENT, onShow);
  }, []);

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
      firstRef={firstEl}
      secondRef={secondEl}
    />
  );
}
