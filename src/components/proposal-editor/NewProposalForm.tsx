"use client";

import { useState, type ReactNode } from "react";
import { createProposalAction } from "@/app/dashboard/proposals/actions";
import type { PackageOption } from "@/lib/proposals/package-list";
import { USE_CONSULT_LABEL } from "@/lib/proposals/prefill-words";
import { ActionForm, Outcome } from "./ActionForm";

export type NewProposalDefaults = {
  leadId: string;
  /** Set when the form was opened from a matter (`?matter=`). */
  matterId: string;
  fullName: string;
  firstName: string;
  company: string;
  clientEmail: string;
  /** The first brand name: the lead's or matter's mark. Editable. */
  brandName: string;
  title: string;
  expiresOn: string;
  payUrl: string;
};

/** The five numeric fields a package fills in, as the inputs hold them. */
export type PackageFields = Pick<PackageOption, "base" | "includedClasses" | "perClass" | "secondMarkPct" | "govPerClass">;

/** The values the five inputs take when `name` is picked; the current ones when it is not on the list. Pure, so it is tested without a DOM. */
export function fieldsForPackage(options: readonly PackageOption[], name: string, current: PackageFields): PackageFields {
  const o = options.find((x) => x.name === name);
  return o ? { base: o.base, includedClasses: o.includedClasses, perClass: o.perClass, secondMarkPct: o.secondMarkPct, govPerClass: o.govPerClass } : current;
}

/**
 * "New proposal": who it is for, plus a first brand name, and which of the
 * firm's packages it starts from. Choosing a package fills the five price
 * fields in the browser; they stay editable for this proposal. The server
 * re-reads the package by name and keeps only the fields that differ from it
 * (and says so on the proposal: "Edited from <package>"). `packages` is null
 * when the firm's settings couldn't be read: no dropdown is offered, and the
 * server starts from the standard prices. The included items and the office
 * action note always come from the firm's settings on the server.
 * `defaultPackage` (a name on the list) starts the dropdown, and its five
 * fields, on that package, exactly as picking it by hand would. `consult`
 * offers the "use the marks and classes from the reviewed consult" box (ticked)
 * with the page's list of what it adds; it posts only a yes, never a mark.
 * On success the action redirects to the new draft's editor.
 */
export function NewProposalForm({
  defaults,
  hasSettings,
  packages,
  defaultPackage,
  consult,
}: {
  defaults: NewProposalDefaults;
  hasSettings: boolean;
  packages: PackageOption[] | null;
  defaultPackage?: string;
  consult?: ReactNode;
}) {
  const options = packages ?? [];
  const first = options.find((o) => o.name === defaultPackage) ?? options[0];
  const [chosen, setChosen] = useState(first?.name ?? "");
  const [fields, setFields] = useState<PackageFields>(
    first
      ? { base: first.base, includedClasses: first.includedClasses, perClass: first.perClass, secondMarkPct: first.secondMarkPct, govPerClass: first.govPerClass }
      : { base: "", includedClasses: "", perClass: "", secondMarkPct: "", govPerClass: "" },
  );
  const set = (key: keyof PackageFields) => (e: { target: { value: string } }) => setFields((f) => ({ ...f, [key]: e.target.value }));

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
              <input className="lx-input" name="brandName" maxLength={200} defaultValue={defaults.brandName} placeholder="e.g. Prosperall" />
            </label>
            {consult && (
              <div className="pe-consult-use" style={{ gridColumn: "1 / -1" }}>
                <label className="pe-check" style={{ whiteSpace: "normal" }}>
                  <input type="checkbox" name="useConsult" defaultChecked /> {USE_CONSULT_LABEL}
                </label>
                {consult}
              </div>
            )}
            {packages !== null && options.length > 0 && (
              <>
                <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
                  <span className="lx-label">Package</span>
                  <select
                    className="lx-input"
                    name="package"
                    value={chosen}
                    onChange={(e) => {
                      setChosen(e.target.value);
                      setFields((f) => fieldsForPackage(options, e.target.value, f));
                    }}
                  >
                    {options.map((o) => (
                      <option key={o.name} value={o.name}>
                        {o.name} — {o.summary}
                      </option>
                    ))}
                  </select>
                  <span className="lx-note">Fills in the prices below. You can change any of them for this proposal, and it will say it was edited from the package.</span>
                </label>
                <label className="lx-field">
                  <span className="lx-label">Price with the included classes ($)</span>
                  <input className="lx-input" name="base" inputMode="decimal" required value={fields.base} onChange={set("base")} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Classes included</span>
                  <input className="lx-input" name="includedClasses" inputMode="numeric" required value={fields.includedClasses} onChange={set("includedClasses")} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Per class over / under ($)</span>
                  <input className="lx-input" name="perClass" inputMode="decimal" required value={fields.perClass} onChange={set("perClass")} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Second mark discount (%)</span>
                  <input className="lx-input" name="secondMarkPct" inputMode="decimal" required value={fields.secondMarkPct} onChange={set("secondMarkPct")} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">USPTO fee per class per mark ($)</span>
                  <input className="lx-input" name="govPerClass" inputMode="decimal" required value={fields.govPerClass} onChange={set("govPerClass")} />
                </label>
              </>
            )}
            <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
              <span className="lx-label">Pay link</span>
              <input className="lx-input" name="payUrl" type="url" maxLength={2000} defaultValue={defaults.payUrl} placeholder="Enter custom pay link" />
            </label>
          </div>
          {packages === null && (
            <p className="lx-note" role="status" style={{ margin: "12px 0 0" }}>
              Your packages couldn&apos;t be loaded just now, so no package is offered and the standard prices will be used. You can change them on the next page.
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
