"use client";

import { useActionState } from "react";
import { saveDeadlineAlertRecipientsAction, type DeadlineAlertState } from "@/app/dashboard/settings/team/deadline-alert-actions";
import { Notice } from "@/components/ui/Notice";
import { SavedNote } from "@/components/ui/SavedNote";
import { DEADLINE_ALERTS_SAVE, SAVING } from "@/lib/ui/words";
import "./deadline-alerts.css";

export type AlertMember = { userId: string; name: string; role: string; chosen: boolean };

/** One checkbox per member; Save posts the ticked ids. The action re-checks the role and every id. */
export function DeadlineAlertsForm({ members }: { members: AlertMember[] }) {
  const [state, action, pending] = useActionState<DeadlineAlertState, FormData>(saveDeadlineAlertRecipientsAction, {});
  return (
    <form action={action} className="lx-dl-alerts-form">
      <fieldset className="lx-dl-alerts-list" aria-label="People who get deadline alerts">
        {members.map((m) => (
          <label key={m.userId} className="lx-dl-alerts-row">
            <input type="checkbox" name="userId" value={m.userId} defaultChecked={m.chosen} />
            <span>
              {m.name} <span className="lx-note">· {m.role}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="lx-queue-filters">
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? SAVING : DEADLINE_ALERTS_SAVE}
        </button>
        <SavedNote show={!!state.saved} />
        {state.error && (
          <Notice tone="risk" role="alert">
            {state.error}
          </Notice>
        )}
      </div>
    </form>
  );
}
