"use client";

import { GENERAL_LIMITS } from "@/lib/proposals/validate";
import type { GeneralFormValues } from "@/lib/proposal-editor/general-form";
import { fieldId } from "@/lib/proposal-editor/checklist";
import { newRowId, useRows } from "./rows";

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
    <div className="pe-general" id={fieldId.general}>
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
