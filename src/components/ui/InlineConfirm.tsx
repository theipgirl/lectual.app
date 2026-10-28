"use client";

import { useState } from "react";
import { nextConfirm, type ConfirmEvent, type ConfirmState } from "@/lib/ui/inline-confirm";

/**
 * The one confirm step for a destructive button (Team remove, Forms archive): the button asks, the same
 * spot then shows the question with Confirm and Cancel. Only Confirm calls `onConfirm`. Replaces the
 * browser's confirm dialog, which a phone shows out of context and a test cannot drive.
 */
export function InlineConfirm({
  label,
  question,
  onConfirm,
  confirmLabel = "Confirm",
  pending = false,
  className = "lx-btn lx-btn-ghost lx-btn-sm",
  initial = "idle",
}: {
  label: string;
  question: string;
  onConfirm: () => void;
  confirmLabel?: string;
  pending?: boolean;
  /** The class of the button that asks. */
  className?: string;
  /** For tests: render the asking state. */
  initial?: ConfirmState;
}) {
  const [state, setState] = useState<ConfirmState>(initial);
  const send = (event: ConfirmEvent) => {
    const next = nextConfirm(state, event);
    setState(next.state);
    if (next.fire) onConfirm();
  };

  if (state === "idle") {
    return (
      <button type="button" className={className} disabled={pending} onClick={() => send("ask")}>
        {pending ? "…" : label}
      </button>
    );
  }
  return (
    <span role="alert" className="lx-note lx-inline-confirm">
      {question}
      <button type="button" className="lx-btn lx-btn-pri lx-btn-sm" onClick={() => send("confirm")}>
        {confirmLabel}
      </button>
      <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => send("cancel")}>
        Cancel
      </button>
    </span>
  );
}
