"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveFullNameAction } from "@/lib/account/actions";
import { NAME_MAX, SHOW_NAME_EVENT, splitFullName } from "@/lib/account/name";
import { focusRestoreTarget, tourKeyAction } from "@/lib/onboarding/engine";
import type { OpenerLike } from "@/lib/feedback/open";
import "@/components/feedback/feedback.css";

type ViewProps = {
  first: string;
  last: string;
  error: string | null;
  saving: boolean;
  onFirst: (v: string) => void;
  onLast: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  dialogRef?: React.Ref<HTMLDivElement>;
  firstRef?: React.Ref<HTMLInputElement>;
  lastRef?: React.Ref<HTMLInputElement>;
  cancelRef?: React.Ref<HTMLButtonElement>;
  saveRef?: React.Ref<HTMLButtonElement>;
};

/** Presentational, so the server renders it the same as the browser. Follows FeedbackDialog. */
export function YourNameDialogView({ first, last, error, saving, onFirst, onLast, onSave, onClose, onKeyDown, dialogRef, firstRef, lastRef, cancelRef, saveRef }: ViewProps) {
  const titleId = useId();
  return (
    <div className="fb-root">
      <div className="fb-backdrop" />
      <div ref={dialogRef} className="lx-card fb-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="fb-title">
          Your name
        </h2>
        <label className="lx-field">
          <span className="lx-label">First name</span>
          <input ref={firstRef} className="lx-input" name="first" required maxLength={NAME_MAX} autoComplete="given-name" value={first} onChange={(e) => onFirst(e.target.value)} disabled={saving} />
        </label>
        <label className="lx-field">
          <span className="lx-label">Last name</span>
          <input ref={lastRef} className="lx-input" name="last" maxLength={NAME_MAX} autoComplete="family-name" value={last} onChange={(e) => onLast(e.target.value)} disabled={saving} />
        </label>
        <p className="lx-note fb-disclosure">Your colleagues see this name, and Today greets you with it.</p>
        {error && (
          <p role="alert" className="fb-error">
            {error}
          </p>
        )}
        <div className="fb-actions">
          <button type="button" ref={cancelRef} className="lx-btn lx-btn-sec lx-btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" ref={saveRef} className="lx-btn lx-btn-pri lx-btn-sm" onClick={onSave} disabled={saving || !first.trim()}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Mounted once in the dashboard layout; the account menu and Today's "Add your name" open it with SHOW_NAME_EVENT. */
export function YourNameDialog({ currentFullName }: { currentFullName: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const firstEl = useRef<HTMLInputElement>(null);
  const lastEl = useRef<HTMLInputElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const save = useRef<HTMLButtonElement>(null);
  const opener = useRef<OpenerLike | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const onShow = (e: Event) => {
      opener.current = (e as CustomEvent<{ opener?: OpenerLike | null }>).detail?.opener ?? null;
      const name = splitFullName(currentFullName);
      setFirst(name.first);
      setLast(name.last);
      setError(null);
      setOpen(true);
    };
    window.addEventListener(SHOW_NAME_EVENT, onShow);
    return () => window.removeEventListener(SHOW_NAME_EVENT, onShow);
  }, [currentFullName]);

  useEffect(() => {
    if (open) (firstEl.current ?? dialog.current)?.focus();
  }, [open]);

  const close = () => {
    if (inFlight.current) return;
    setOpen(false);
    focusRestoreTarget(opener.current)?.focus?.();
  };

  const submit = async () => {
    if (inFlight.current || !first.trim()) return;
    inFlight.current = true;
    setSaving(true);
    setError(null);
    let result: Awaited<ReturnType<typeof saveFullNameAction>>;
    try {
      result = await saveFullNameAction({ first, last });
    } catch {
      result = { ok: false, error: "We couldn't save your name. Try again." };
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
    const controls = [firstEl.current, lastEl.current, cancel.current, save.current].filter((el): el is NonNullable<typeof el> => !!el && !el.disabled);
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
    <YourNameDialogView
      first={first}
      last={last}
      error={error}
      saving={saving}
      onFirst={setFirst}
      onLast={setLast}
      onSave={submit}
      onClose={close}
      onKeyDown={onKeyDown}
      dialogRef={dialog}
      firstRef={firstEl}
      lastRef={lastEl}
      cancelRef={cancel}
      saveRef={save}
    />
  );
}
