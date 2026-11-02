"use client";

import { createProposalAction } from "@/app/dashboard/proposals/actions";
import { generalFormValues } from "@/lib/proposal-editor/general-form";
import { ActionForm, Outcome } from "./ActionForm";
import { ExpiryField } from "./ExpiryField";
import { GeneralFields } from "./GeneralFields";
import type { NewProposalDefaults } from "./NewProposalForm";

/**
 * Spec 9: New proposal for a contract or other matter, at one flat fee. Posts `kind=general` to the same
 * `createProposalAction`, which builds the content on the server and checks it; the browser sends words and
 * dollar amounts only. On success the action redirects to the new draft's editor.
 */
export function NewGeneralProposalForm({ defaults, today }: { defaults: NewProposalDefaults; today?: string }) {
  return (
    <ActionForm action={createProposalAction} className="lx-card pe-card">
      {({ state, pending }) => (
        <>
          <input type="hidden" name="kind" value="general" />
          <input type="hidden" name="leadId" value={defaults.leadId} />
          <input type="hidden" name="matterId" value={defaults.matterId} />
          <div className="lx-form-grid">
            <label className="lx-field">
              <span className="lx-label">Client full name</span>
              <input className="lx-input" name="fullName" required maxLength={300} defaultValue={defaults.fullName} />
            </label>
            <label className="lx-field">
              <span className="lx-label">Client email</span>
              <input className="lx-input" name="clientEmail" type="email" maxLength={320} defaultValue={defaults.clientEmail} />
            </label>
            <label className="lx-field">
              <span className="lx-label">First name (greeting)</span>
              <input className="lx-input" name="firstName" maxLength={120} defaultValue={defaults.firstName} />
            </label>
            <label className="lx-field">
              <span className="lx-label">Company (optional)</span>
              <input className="lx-input" name="company" maxLength={200} defaultValue={defaults.company} />
            </label>
          </div>
          <GeneralFields values={generalFormValues(undefined)} />
          <div className="lx-form-grid">
            <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
              <span className="lx-label">Pay link</span>
              <input className="lx-input" name="payUrl" type="url" maxLength={2000} defaultValue={defaults.payUrl} placeholder="Enter custom pay link" />
            </label>
            <ExpiryField defaultValue={defaults.expiresOn} today={today} />
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
