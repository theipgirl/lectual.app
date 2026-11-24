"use client";

import { useActionState } from "react";
import { closeMatterWithOverrideAction, type ActionState } from "@/app/dashboard/matters/[id]/actions";
import { Notice } from "@/components/ui/Notice";
import { SavedNote } from "@/components/ui/SavedNote";
import { OVERRIDE_REASON_MAX } from "@/lib/matters/deadline-safety";
import {
  CLOSE_OVERRIDE_BUTTON,
  CLOSE_OVERRIDE_CONFIRM,
  CLOSE_OVERRIDE_DONE,
  CLOSE_OVERRIDE_HELP,
  CLOSE_OVERRIDE_REASON,
  CLOSE_OVERRIDE_SUMMARY,
  SAVING,
} from "@/lib/ui/words";

/**
 * Close a matter that still has an open USPTO deadline (PGE Sprint 3). Drawn only for an override role (owner,
 * attorney); the action re-checks the role before any read. A reason (1..300 characters) and an explicit confirm
 * are required; the reason goes on the timeline.
 */
export function CloseOverrideForm({ matterId, deadlineNames }: { matterId: string; deadlineNames: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(closeMatterWithOverrideAction, {});
  return (
    <details className="lx-disclosure-inline mx-close-override" data-close-override="">
      <summary className="lx-btn lx-btn-sec lx-btn-sm">{CLOSE_OVERRIDE_SUMMARY}</summary>
      <form action={action} className="lx-form-grid mx-mt-8">
        <p className="lx-note" style={{ margin: 0 }}>
          {CLOSE_OVERRIDE_HELP} <b>{deadlineNames}</b>
        </p>
        <input type="hidden" name="matterId" value={matterId} />
        <label className="lx-field">
          <span className="lx-label">{CLOSE_OVERRIDE_REASON}</span>
          <textarea name="reason" className="lx-input" required maxLength={OVERRIDE_REASON_MAX} rows={3} />
        </label>
        <label className="mx-row">
          <input type="checkbox" name="confirm" value="yes" required />
          <span>{CLOSE_OVERRIDE_CONFIRM}</span>
        </label>
        <div className="mx-row">
          <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
            {pending ? SAVING : CLOSE_OVERRIDE_BUTTON}
          </button>
          <SavedNote show={!!state.saved}>{CLOSE_OVERRIDE_DONE}</SavedNote>
        </div>
        {state.error && (
          <Notice tone="risk" role="alert">
            {state.error}
          </Notice>
        )}
      </form>
    </details>
  );
}
