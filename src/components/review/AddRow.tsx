"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { addLeadFromReviewAction, type AddLeadState } from "@/app/dashboard/review/actions";
import {
  ADD_A_LEAD,
  ADD_ROW_ADDED,
  ADD_ROW_ANOTHER,
  ADD_ROW_BUSINESS,
  ADD_ROW_EMAIL,
  ADD_ROW_FIRST_NAME,
  ADD_ROW_LABEL,
  ADD_ROW_LAST_NAME,
  ADD_ROW_LEAD_HINT,
  ADD_ROW_OPEN_LEAD,
  ADD_ROW_OPEN_MATTER,
  ADD_ROW_SUBMIT,
  CANCEL,
  SAVING,
} from "@/lib/ui/words";

/**
 * Add a row, at the bottom of the Weekly review List, for a role that can create the record. There are no free-form rows: "Add a lead"
 * is a small inline form that makes a real lead (the Leads page's own `createLead`), and "Open a matter" goes to the matter form that
 * already exists. A role that can do neither is never given this (the page decides; the action re-checks the role).
 */
export const OPEN_MATTER_HREF = "/dashboard/matters/#open-matter";

const EMPTY: AddLeadState = {};

export function AddRow({ canAddLead, canOpenMatter }: { canAddLead: boolean; canOpenMatter: boolean }) {
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  if (!canAddLead && !canOpenMatter) return null;
  return (
    <section className="rv-addrow lx-card" aria-label={ADD_ROW_LABEL}>
      <div className="rv-addrow-btns">
        {canAddLead && (
          <button type="button" className="lx-btn lx-btn-sec" aria-expanded={open} aria-controls="rv-addrow-form" onClick={() => setOpen((o) => !o)}>
            {ADD_A_LEAD}
          </button>
        )}
        {canOpenMatter && (
          // A plain link: the page it opens reads the #open-matter hash itself and opens its form.
          <a href={OPEN_MATTER_HREF} className="lx-btn lx-btn-sec">
            {ADD_ROW_OPEN_MATTER}
          </a>
        )}
      </div>
      {canAddLead && open && (
        <div id="rv-addrow-form">
          <AddLeadForm
            key={round}
            onAnother={() => setRound((r) => r + 1)}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </section>
  );
}

export function AddLeadForm({ onAnother, onCancel }: { onAnother: () => void; onCancel: () => void }) {
  const [state, action, pending] = useActionState(addLeadFromReviewAction, EMPTY);
  if (state.saved && state.leadId) {
    return (
      <div className="rv-addrow-done" role="status">
        <p className="lx-note">{state.message ?? ADD_ROW_ADDED}</p>
        <p className="rv-addrow-acts">
          <Link href={`/dashboard/leads/${state.leadId}/`} className="lx-link">
            {ADD_ROW_OPEN_LEAD}
          </Link>
          <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={onAnother}>
            {ADD_ROW_ANOTHER}
          </button>
        </p>
      </div>
    );
  }
  return (
    <form action={action} className="rv-addrow-form">
      <label className="rv-addrow-field">
        <span className="lx-label">{ADD_ROW_FIRST_NAME}</span>
        <input className="lx-input" name="firstName" type="text" required maxLength={120} autoComplete="off" />
      </label>
      <label className="rv-addrow-field">
        <span className="lx-label">{ADD_ROW_LAST_NAME}</span>
        <input className="lx-input" name="lastName" type="text" required maxLength={120} autoComplete="off" />
      </label>
      <label className="rv-addrow-field">
        <span className="lx-label">{ADD_ROW_EMAIL}</span>
        <input className="lx-input" name="email" type="email" required maxLength={254} autoComplete="off" />
      </label>
      <label className="rv-addrow-field">
        <span className="lx-label">{ADD_ROW_BUSINESS}</span>
        <input className="lx-input" name="businessName" type="text" maxLength={200} autoComplete="off" />
      </label>
      <p className="lx-note rv-addrow-hint">{ADD_ROW_LEAD_HINT}</p>
      <div className="rv-addrow-acts">
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? SAVING : ADD_ROW_SUBMIT}
        </button>
        <button type="button" className="lx-btn lx-btn-sec" onClick={onCancel}>
          {CANCEL}
        </button>
      </div>
      <p className="rv-addrow-error lx-note" role="alert" aria-live="assertive">
        {state.error ?? ""}
      </p>
    </form>
  );
}
