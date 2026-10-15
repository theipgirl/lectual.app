"use client";

import { useActionState } from "react";
import { saveConsultDetailsAction, type ConsultActionState } from "@/app/dashboard/leads/[id]/consult-details-actions";
import {
  CONSULT_BASES,
  CONSULT_BASIS_LABEL,
  MARK_TYPES,
  MARK_TYPE_LABEL,
  formatClassLines,
  type ConsultMark,
  type StoredConsultDetails,
} from "@/lib/consult/vocab";

/**
 * One consult's details, as a form a person reviews. Every field starts at what
 * was extracted (or typed before), `unknown` stays `unknown` until a person
 * picks something else, and saving is what marks the record reviewed — only
 * then can it carry onto a matter. Read-only for roles that cannot write.
 */

const grid = { display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" } as const;

const BLANK: ConsultMark = {
  id: "",
  mark: "",
  mark_type: "unknown",
  classes: [],
  filing_basis: "unknown",
  extracted_basis: null,
  basis_evidence: null,
  first_use_date: null,
};

function MarkFields({ i, mark, label }: { i: number; mark: ConsultMark; label: string }) {
  const corrected = mark.extracted_basis !== null && mark.extracted_basis !== mark.filing_basis;
  return (
    <fieldset style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 12, margin: 0, display: "grid", gap: 10, minWidth: 0 }}>
      <legend className="lx-label" style={{ padding: "0 6px" }}>
        {label}
      </legend>
      <input type="hidden" name={`m${i}_id`} value={mark.id} />
      <div style={grid}>
        <label className="lx-field">
          <span className="lx-label">Mark</span>
          <input className="lx-input" name={`m${i}_text`} defaultValue={mark.mark} maxLength={200} />
        </label>
        <label className="lx-field">
          <span className="lx-label">Word or design</span>
          <select className="lx-input" name={`m${i}_type`} defaultValue={mark.mark_type}>
            {MARK_TYPES.map((t) => (
              <option key={t} value={t}>
                {MARK_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={grid}>
        <label className="lx-field">
          <span className="lx-label">Filing basis</span>
          <select className="lx-input" name={`m${i}_basis`} defaultValue={mark.filing_basis}>
            {CONSULT_BASES.map((b) => (
              <option key={b} value={b}>
                {CONSULT_BASIS_LABEL[b]}
              </option>
            ))}
          </select>
        </label>
        <label className="lx-field">
          <span className="lx-label">First use (if stated)</span>
          <input className="lx-input" type="date" name={`m${i}_first_use`} defaultValue={mark.first_use_date ?? ""} />
        </label>
      </div>
      {mark.basis_evidence && (
        <p className="lx-note" style={{ margin: 0 }}>
          From the call: “{mark.basis_evidence}”
        </p>
      )}
      {corrected && (
        <p className="lx-note" style={{ margin: 0 }}>
          The drafting agent read {CONSULT_BASIS_LABEL[mark.extracted_basis!]}; this was corrected on review.
        </p>
      )}
      <label className="lx-field">
        <span className="lx-label">Classes and goods/services</span>
        <textarea className="lx-input" name={`m${i}_classes`} rows={3} defaultValue={formatClassLines(mark.classes)} placeholder={"25: Clothing, namely t-shirts\n35: Online retail store services"} />
        <span className="lx-note">One per line, as “class: goods”. A line without a class number is goods whose class wasn’t stated.</span>
      </label>
      {mark.id && (
        <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 14 }}>
          <input type="checkbox" name={`m${i}_remove`} /> Remove this mark
        </label>
      )}
    </fieldset>
  );
}

export function ConsultDetailsForm({
  leadId,
  noteId,
  details,
}: {
  leadId: string;
  noteId: string | null;
  details: StoredConsultDetails | null;
}) {
  const [state, action, pending] = useActionState<ConsultActionState, FormData>(saveConsultDetailsAction, {});
  const marks = details?.marks ?? [];
  const reviewed = Boolean(details?.review);
  return (
    <form action={action} style={{ display: "grid", gap: 12 }}>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="noteId" value={noteId ?? ""} />
      <input type="hidden" name="rev" value={details ? String(details.rev) : "none"} />
      <input type="hidden" name="markCount" value={marks.length + 1} />
      {marks.length === 0 && details && (
        <p className="lx-note" style={{ margin: 0 }}>
          No marks were identified on this consult. Add one below, or leave it empty and confirm that there are none.
        </p>
      )}
      {marks.map((m, i) => (
        <MarkFields key={m.id} i={i} mark={m} label={`Mark ${i + 1}`} />
      ))}
      {marks.length === 0 ? (
        <MarkFields i={0} mark={BLANK} label="Add a mark" />
      ) : (
        <details className="lx-disclosure-inline">
          <summary>Add another mark</summary>
          <MarkFields i={marks.length} mark={BLANK} label="New mark" />
        </details>
      )}
      <div style={grid}>
        <label className="lx-field">
          <span className="lx-label">Package discussed</span>
          <input className="lx-input" name="package" defaultValue={details?.recommended_package ?? ""} maxLength={200} />
        </label>
        <label className="lx-field">
          <span className="lx-label">Discount discussed</span>
          <input className="lx-input" name="discount" defaultValue={details?.discount_discussed ?? ""} maxLength={200} />
        </label>
      </div>
      <p className="lx-note" style={{ margin: 0 }}>
        The package and discount are a note of what was said. They don’t change any quote: prices come only from the quote itself.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
          {pending ? "Saving…" : reviewed ? "Save changes" : "Confirm and mark reviewed"}
        </button>
        <span className="lx-note">Saving marks this reviewed by you. Nothing is sent.</span>
      </div>
      {state.error && (
        <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
          {state.error}
        </p>
      )}
    </form>
  );
}
