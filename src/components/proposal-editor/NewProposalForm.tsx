"use client";

import { createProposalAction } from "@/app/dashboard/proposals/actions";
import type { PackageChoicesRead } from "@/lib/proposals/packages";
import { formatDollars } from "@/lib/proposal-editor/events";
import { ActionForm, Outcome } from "./ActionForm";

export type NewProposalDefaults = {
  leadId: string;
  /** Set when the form was opened from a matter (`?matter=`). */
  matterId: string;
  fullName: string;
  firstName: string;
  company: string;
  clientEmail: string;
  title: string;
  expiresOn: string;
  payUrl: string;
};

/**
 * "New proposal": who it is for, plus a first brand name. Prices, the included
 * items and the office action note come from the firm's settings on the server.
 * A package picked from the service library posts only its id; the server reads
 * the item itself and sets the package name and base price from it.
 * On success the action redirects to the new draft's editor.
 */
export function NewProposalForm({
  defaults,
  hasSettings,
  packages,
}: {
  defaults: NewProposalDefaults;
  hasSettings: boolean;
  packages: PackageChoicesRead;
}) {
  return (
    <ActionForm action={createProposalAction} className="lx-card pe-card">
      {({ state, pending }) => (
        <>
          <input type="hidden" name="leadId" value={defaults.leadId} />
          <input type="hidden" name="matterId" value={defaults.matterId} />
          <div className="lx-form-grid">
            <label className="lx-field">
              <span className="lx-label">Client full name</span>
              <input className="lx-input" name="fullName" required maxLength={300} defaultValue={defaults.fullName} />
            </label>
            <label className="lx-field">
              <span className="lx-label">First name (greeting)</span>
              <input className="lx-input" name="firstName" maxLength={120} defaultValue={defaults.firstName} />
            </label>
            <label className="lx-field">
              <span className="lx-label">Company (optional)</span>
              <input className="lx-input" name="company" maxLength={200} defaultValue={defaults.company} />
            </label>
            <label className="lx-field">
              <span className="lx-label">Client email</span>
              <input className="lx-input" name="clientEmail" type="email" maxLength={320} defaultValue={defaults.clientEmail} />
            </label>
            <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
              <span className="lx-label">Title</span>
              <input className="lx-input" name="title" maxLength={300} defaultValue={defaults.title} />
            </label>
            <label className="lx-field">
              <span className="lx-label">Open until</span>
              <input className="lx-input" name="expiresOn" type="date" defaultValue={defaults.expiresOn} />
            </label>
            <label className="lx-field">
              <span className="lx-label">First brand name (optional)</span>
              <input className="lx-input" name="brandName" maxLength={200} placeholder="e.g. Prosperall" />
            </label>
            {packages.status === "ok" && packages.choices.length > 0 && (
              <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lx-label">Package from your service library</span>
                <select className="lx-input" name="serviceItemId" defaultValue="">
                  <option value="">Standard prices (from Settings)</option>
                  {packages.choices.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} · {formatDollars(c.amountCents)}
                    </option>
                  ))}
                </select>
                <span className="lx-note">Sets the package name and its base price. Every other price stays your standard, and you can change all of it on the next page.</span>
              </label>
            )}
            <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
              <span className="lx-label">Pay link (https)</span>
              <input className="lx-input" name="payUrl" type="url" maxLength={2000} defaultValue={defaults.payUrl} />
            </label>
          </div>
          {packages.status === "unavailable" && (
            <p className="lx-note" role="status" style={{ margin: "12px 0 0" }}>
              The service library couldn&apos;t be loaded, so the standard prices will be used.
            </p>
          )}
          {!hasSettings && (
            <p className="lx-note" style={{ margin: "12px 0 0" }}>
              Your firm hasn’t saved its standard prices yet, so this starts from the default Concierge prices. An admin can change them in Settings.
            </p>
          )}
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
