"use client";

import type { ReactNode } from "react";
import { createProposalAction } from "@/app/dashboard/proposals/actions";
import { ActionForm, Outcome } from "./ActionForm";

/** The proposal type the draft is made as. `general` = a contract or other matter at a flat fee. */
type Kind = "trademark" | "general";

/**
 * One row of "Who is this for?" that creates the draft when pressed. It posts ONLY the record's id (and the type):
 * the server reads the lead or matter itself, builds the draft and the editor opens. A refusal shows under the row.
 */
export function StartDraftRow({ recordKind, id, name, secondary, type }: { recordKind: "lead" | "matter"; id: string; name: string; secondary: string | null; type: Kind }) {
  return (
    <ActionForm action={createProposalAction}>
      {({ state, pending }) => (
        <>
          <input type="hidden" name={recordKind === "lead" ? "leadId" : "matterId"} value={id} />
          <input type="hidden" name="kind" value={type} />
          <button type="submit" className="pe-who-row pe-start-row" disabled={pending} data-start-row>
            <span className="pe-who-name">{name}</span>
            {secondary && <span className="pe-who-sub">{secondary}</span>}
            <span className="pe-who-mark">{pending ? "Creating…" : "Create draft"}</span>
          </button>
          <Outcome state={state} pending={pending} />
        </>
      )}
    </ActionForm>
  );
}

/** "Start blank": a client name, then the draft is created and the editor opens. */
export function StartBlankForm({ type }: { type: Kind }) {
  return (
    <ActionForm action={createProposalAction} className="lx-card pe-card">
      {({ state, pending }) => (
        <>
          <input type="hidden" name="kind" value={type} />
          <div className="lx-form-grid">
            <label className="lx-field">
              <span className="lx-label">Client full name</span>
              <input className="lx-input" name="fullName" required maxLength={300} />
            </label>
            <label className="lx-field">
              <span className="lx-label">First name (greeting)</span>
              <input className="lx-input" name="firstName" maxLength={120} />
            </label>
            <label className="lx-field">
              <span className="lx-label">Company (optional)</span>
              <input className="lx-input" name="company" maxLength={200} />
            </label>
            <label className="lx-field">
              <span className="lx-label">Client email (optional)</span>
              <input className="lx-input" name="clientEmail" type="email" maxLength={320} />
            </label>
          </div>
          <div className="pe-save">
            <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
              {pending ? "Creating…" : "Create draft"}
            </button>
            <Outcome state={state} pending={pending} />
          </div>
        </>
      )}
    </ActionForm>
  );
}

/**
 * A lead or matter already chosen (a link from its page): one button creates the draft. `consult` is the
 * "use the marks and classes from the reviewed consult" choice, drawn only when a reviewed consult has some.
 */
export function CreateDraftForm({ leadId, matterId, type, consult }: { leadId: string; matterId: string; type: Kind; consult?: ReactNode }) {
  return (
    <ActionForm action={createProposalAction} className="lx-card pe-card">
      {({ state, pending }) => (
        <>
          <input type="hidden" name="kind" value={type} />
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="matterId" value={matterId} />
          {consult}
          <div className="pe-save">
            <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
              {pending ? "Creating…" : "Create draft"}
            </button>
            <Outcome state={state} pending={pending} />
          </div>
        </>
      )}
    </ActionForm>
  );
}
