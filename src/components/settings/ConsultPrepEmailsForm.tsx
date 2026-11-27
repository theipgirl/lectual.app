"use client";

import { useActionState } from "react";
import { saveConsultPrepEmailsAction, type ConsultPrepEmailsState } from "@/app/dashboard/settings/team/consult-prep-actions";
import { Notice } from "@/components/ui/Notice";
import { SavedNote } from "@/components/ui/SavedNote";
import { CONSULT_PREP_TEAM_CC_LABEL, CONSULT_PREP_TEAM_SAVE, SAVING } from "@/lib/ui/words";
import type { AlertMember } from "./DeadlineAlertsForm";
import "./deadline-alerts.css";

/** One checkbox per member (To) and a box for Cc addresses; Save posts them. The action re-checks the role, every id and every address. */
export function ConsultPrepEmailsForm({ members, cc }: { members: AlertMember[]; cc: string[] }) {
  const [state, action, pending] = useActionState<ConsultPrepEmailsState, FormData>(saveConsultPrepEmailsAction, {});
  return (
    <form action={action} className="lx-dl-alerts-form">
      <fieldset className="lx-dl-alerts-list" aria-label="People who get consult prep emails">
        {members.map((m) => (
          <label key={m.userId} className="lx-dl-alerts-row">
            <input type="checkbox" name="userId" value={m.userId} defaultChecked={m.chosen} />
            <span>
              {m.name} <span className="lx-note">· {m.role}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <label className="lx-label" htmlFor="consult-prep-cc">
        {CONSULT_PREP_TEAM_CC_LABEL}
      </label>
      <input id="consult-prep-cc" name="cc" type="text" className="lx-input" defaultValue={cc.join(", ")} autoComplete="off" />
      <div className="lx-queue-filters">
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? SAVING : CONSULT_PREP_TEAM_SAVE}
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
