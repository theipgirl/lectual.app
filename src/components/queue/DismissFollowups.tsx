"use client";

import { useActionState, useRef } from "react";
import { dismissStaleFollowupsAction, type DismissState } from "@/app/dashboard/queue/actions";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import { DISMISS_CAP } from "@/lib/queue/dismiss";

/** Bulk-reject of stale follow-ups. The form posts a confirm flag only; the server picks the set. */
export function DismissFollowups({ count, initial }: { count: number; initial?: "idle" | "asking" }) {
  const [state, action, pending] = useActionState<DismissState, FormData>(dismissStaleFollowupsAction, {});
  const formRef = useRef<HTMLFormElement>(null);
  const noun = count === 1 ? "follow-up" : "follow-ups";
  const cap = count > DISMISS_CAP ? ` (${DISMISS_CAP} at a time)` : "";
  return (
    <form ref={formRef} action={action} className="lx-dismiss" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="confirm" value="yes" />
      <InlineConfirm
        label="Dismiss follow-ups older than 7 days"
        question={`Dismiss ${count} ${noun} older than 7 days${cap}?`}
        confirmLabel="Dismiss"
        pending={pending}
        initial={initial}
        onConfirm={() => formRef.current?.requestSubmit()}
      />
      {state.message && (
        <span role="status" className="lx-note">
          {state.message}
        </span>
      )}
      {state.error && (
        <span role="alert" className="lx-note">
          {state.error}
        </span>
      )}
    </form>
  );
}
