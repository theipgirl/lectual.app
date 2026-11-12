"use client";

import { useActionState } from "react";
import { sendBackAction, type SendBackState } from "@/app/dashboard/queue/actions";
import { SEND_BACK_NOTE_LABEL, SEND_BACK_NOTE_HINT, sendBackTo } from "@/lib/ui/words";
import { SEND_BACK_NOTE_MAX } from "@/lib/queue/handed";

/** "Send back to <name>" with an optional note. The action re-checks everything; this only draws the form. */
export function SendBackForm({ id, name }: { id: string; name: string }) {
  const [state, action, pending] = useActionState<SendBackState, FormData>(sendBackAction, {});
  return (
    <form action={action} className="lx-sendback" data-send-back>
      <input type="hidden" name="id" value={id} />
      <label className="lx-sendback-label">
        <span>{SEND_BACK_NOTE_LABEL}</span>
        <textarea name="note" rows={2} maxLength={SEND_BACK_NOTE_MAX} className="lx-sendback-note" aria-describedby={`sb-hint-${id}`} />
      </label>
      <p id={`sb-hint-${id}`} className="lx-note" style={{ margin: 0 }}>
        {SEND_BACK_NOTE_HINT}
      </p>
      {state.error && (
        <p role="alert" className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
          {state.error}
        </p>
      )}
      <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
        {sendBackTo(name)}
      </button>
    </form>
  );
}
