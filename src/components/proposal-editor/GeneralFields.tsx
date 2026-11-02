"use client";

import { saveGeneralAction } from "@/app/dashboard/proposals/[id]/actions";
import { GENERAL_LIMITS } from "@/lib/proposals/validate";
import type { GeneralFormValues } from "@/lib/proposal-editor/general-form";
import { ActionForm, IssueList, SaveRow, type ShownIssue } from "./ActionForm";
import { ExpiryField } from "./ExpiryField";
import { newRowId, useRows } from "./rows";
import { UnsavedPill } from "./UnsavedGuard";

/**
 * Spec 9: the fields of a general (flat-fee) proposal: the matter, a summary, the work (each piece with hours and
 * an hourly rate, or a value), the flat fee, the "Not included" lines and a terms note. Every word is typed by staff;
 * nothing here writes text for the client and no amount is worked out in the browser (the server and the client page
 * price through `quoteProposal`). Used by New proposal and by the editor.
 */
export function GeneralFields({ values, editable = true }: { values: GeneralFormValues; editable?: boolean }) {
  const start = values.items.length > 0 ? values.items : [{ id: "", label: "", hours: "", rate: "", value: "" }];
  const list = useRows(start);
  return (
    <div className="pe-general">
      <label className="lx-field">
        <span className="lx-label">Matter</span>
        <input
          className="lx-input"
          name="matterTitle"
          required
          maxLength={GENERAL_LIMITS.matterTitle}
          defaultValue={values.matterTitle}
          placeholder="e.g. Management agreement: notice of non-renewal and termination"
        />
      </label>
      <label className="lx-field">
        <span className="lx-label">Summary (optional)</span>
        <textarea className="lx-input" name="summary" rows={3} maxLength={GENERAL_LIMITS.summary} defaultValue={values.summary} />
        <span className="lx-note">A short paragraph the client reads above the work.</span>
      </label>

      <fieldset className="lx-field pe-general-work" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="lx-label">What we&rsquo;ll do</legend>
        <span className="lx-note">Each piece of work with its hours and hourly rate, or a value. Their total is shown to the client as the value of the work; the client pays the flat fee.</span>
        <div className="pe-rows">
          <div className="pe-work-head" aria-hidden="true">
            <span>Work</span>
            <span>Hours</span>
            <span>Rate ($/hr)</span>
            <span>Or value ($)</span>
            <span />
          </div>
          {list.rows.map((row, i) => (
            <div key={row.key} className="pe-work-row">
              <input type="hidden" name={`item.${i}.id`} value={row.id} />
              <input className="lx-input" name={`item.${i}.label`} defaultValue={row.label} aria-label={`Work ${i + 1}`} maxLength={GENERAL_LIMITS.itemLabel} />
              <input className="lx-input" name={`item.${i}.hours`} defaultValue={row.hours} aria-label={`Work ${i + 1} hours`} inputMode="decimal" placeholder="1.5" />
              <input className="lx-input" name={`item.${i}.rate`} defaultValue={row.rate} aria-label={`Work ${i + 1} hourly rate`} inputMode="decimal" placeholder="500" />
              <input className="lx-input" name={`item.${i}.value`} defaultValue={row.value} aria-label={`Work ${i + 1} value`} inputMode="decimal" />
              {editable && list.rows.length > 1 ? (
                <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => list.remove(row.key)} aria-label={`Remove work ${i + 1}`}>
                  Remove
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
        </div>
        {editable && list.rows.length < GENERAL_LIMITS.items && (
          <button
            type="button"
            className="lx-btn lx-btn-sec lx-btn-sm"
            onClick={() => list.add({ id: newRowId("w"), label: "", hours: "", rate: "", value: "" })}
          >
            Add a piece of work
          </button>
        )}
      </fieldset>

      <label className="lx-field">
        <span className="lx-label">Flat fee ($)</span>
        <input className="lx-input" name="fee" required inputMode="decimal" defaultValue={values.fee} placeholder="500" />
        <span className="lx-note">What the client pays. A flat fee only: never a percentage.</span>
      </label>
      <label className="lx-field">
        <span className="lx-label">Not included (one per line, optional)</span>
        <textarea className="lx-input" name="excludes" rows={3} defaultValue={values.excludes} />
      </label>
      <label className="lx-field">
        <span className="lx-label">Terms note (optional)</span>
        <textarea className="lx-input" name="termsNote" rows={2} maxLength={GENERAL_LIMITS.termsNote} defaultValue={values.termsNote} />
      </label>
    </div>
  );
}

export const generalFormId = (proposalId: string) => `pe-general-${proposalId}`;

/** The editor's one section for a general draft. Tracked for unsaved changes, so "Save and create link" waits for it. */
export function GeneralForm({
  proposalId,
  updatedAt,
  editable,
  issues,
  values,
  greeting,
  payUrl,
  expiresOn,
  today,
}: {
  proposalId: string;
  updatedAt: string;
  editable: boolean;
  issues: ShownIssue[];
  values: GeneralFormValues;
  greeting: string;
  payUrl: string;
  expiresOn: string;
  today?: string;
}) {
  const id = generalFormId(proposalId);
  return (
    <section className="lx-card pe-card">
      <header className="pe-card-head">
        <h2 className="pe-h">
          Matter and flat fee <UnsavedPill formId={id} />
        </h2>
        <p className="lx-note pe-hint">A contract or other matter at one flat fee. No packages, classes or USPTO fees.</p>
      </header>
      <ActionForm action={saveGeneralAction} id={id} unsavedLabel="Matter and flat fee">
        {({ state, pending }) => (
          <fieldset className="pe-fieldset" disabled={!editable}>
            <input type="hidden" name="proposalId" value={proposalId} />
            <input type="hidden" name="updatedAt" value={updatedAt} />
            <label className="lx-field">
              <span className="lx-label">Greeting</span>
              <textarea className="lx-input" name="greeting" rows={3} maxLength={4000} defaultValue={greeting} />
            </label>
            <GeneralFields values={values} editable={editable} />
            <div className="lx-form-grid">
              <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lx-label">Pay link</span>
                <input className="lx-input" name="payUrl" type="url" maxLength={2000} defaultValue={payUrl} placeholder="Enter custom pay link" />
              </label>
              <ExpiryField defaultValue={expiresOn} today={today} disabled={!editable} />
            </div>
            <IssueList issues={issues} />
            <SaveRow editable={editable} state={state} pending={pending} label="Save matter and fee" formId={id} />
          </fieldset>
        )}
      </ActionForm>
    </section>
  );
}
