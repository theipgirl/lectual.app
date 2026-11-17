"use client";

import { useState } from "react";
import { CANCEL, SAVING, yesVerb } from "@/lib/ui/words";
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
  confirmLabel,
  tone = "danger",
  pending = false,
  className = "lx-btn lx-btn-ghost lx-btn-sm",
  initial = "idle",
}: {
  label: string;
  question: string;
  onConfirm: () => void;
  /** Default: "Yes, <label>" ("Remove" -> "Yes, remove"). */
  confirmLabel?: string;
  /** danger for a removal (default); primary for a confirm that removes nothing (a role change). */
  tone?: "danger" | "primary";
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
        {pending ? SAVING : label}
      </button>
    );
  }
  return (
    <span role="alert" className="lx-note lx-inline-confirm">
      {question}
      <button type="button" className={`lx-btn ${tone === "primary" ? "lx-btn-pri" : "lx-btn-danger"} lx-btn-sm`} onClick={() => send("confirm")}>
        {confirmLabel ?? yesVerb(label)}
      </button>
      <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => send("cancel")}>
        {CANCEL}
      </button>
    </span>
  );
}
