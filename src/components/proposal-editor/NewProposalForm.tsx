"use client";

import { useState, type ReactNode } from "react";
import { createProposalAction } from "@/app/dashboard/proposals/actions";
import type { PackageOption } from "@/lib/proposals/package-list";
import { USE_CONSULT_LABEL } from "@/lib/proposals/prefill-words";
import { countChangedFields, messageInMoreOptions } from "@/lib/proposal-editor/more-options";
import { newMarkPackagePrefix } from "@/lib/proposal-editor/create-package-choice";
import { MARK_KIND_LABEL, MARK_KINDS } from "@/lib/proposals/types";
import { ActionForm, Outcome } from "./ActionForm";
import { ExpiryField } from "./ExpiryField";
import { BuilderLayout } from "./BuilderLayout";

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
  today,
}: {
  defaults: NewProposalDefaults;
  hasSettings: boolean;
  packages: PackageOption[] | null;
  defaultPackage?: string;
  consult?: ReactNode;
  /** The firm's civil date, for the expiry warning. */
  today?: string;
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
  // The More options fields are controlled so the section can say how many differ from their defaults.
  const [more, setMore] = useState({ firstName: defaults.firstName, company: defaults.company, title: defaults.title });
  const setMoreField = (key: keyof typeof more) => (e: { target: { value: string } }) => setMore((m) => ({ ...m, [key]: e.target.value }));
  const chosenOption = options.find((o) => o.name === chosen);
  const changed = countChangedFields([
    { current: more.firstName, baseline: defaults.firstName },
    { current: more.company, baseline: defaults.company },
    { current: more.title, baseline: defaults.title },
    ...(chosenOption
      ? [
          { current: fields.base, baseline: chosenOption.base },
          { current: fields.includedClasses, baseline: chosenOption.includedClasses },
          { current: fields.perClass, baseline: chosenOption.perClass },
          { current: fields.secondMarkPct, baseline: chosenOption.secondMarkPct },
          { current: fields.govPerClass, baseline: chosenOption.govPerClass },
        ]
      : []),
  ]);

  return (
    <ActionForm action={createProposalAction} className="lx-card pe-card">
      {({ state, pending }) => (
        <>
          <input type="hidden" name="leadId" value={defaults.leadId} />
          <input type="hidden" name="matterId" value={defaults.matterId} />
          <BuilderLayout
            changed={changed}
            moreOpen={messageInMoreOptions(state.error)}
            who={
              <div className="lx-form-grid">
                <label className="lx-field">
                  <span className="lx-label">Client full name</span>
                  <input className="lx-input" name="fullName" required maxLength={300} defaultValue={defaults.fullName} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Client email</span>
                  <input className="lx-input" name="clientEmail" type="email" maxLength={320} defaultValue={defaults.clientEmail} />
                </label>
              </div>
            }
            names={
              <div className="lx-form-grid">
                <label className="lx-field">
                  <span className="lx-label">First brand name (optional)</span>
                  <input className="lx-input" name="brandName" maxLength={200} defaultValue={defaults.brandName} placeholder="e.g. Prosperall" />
                  <span className="lx-note">Marks, classes and more brand names are added on the next page.</span>
                </label>
                {consult && (
                  <div className="pe-consult-use" style={{ gridColumn: "1 / -1" }}>
                    <label className="pe-check" style={{ whiteSpace: "normal" }}>
                      <input type="checkbox" name="useConsult" defaultChecked /> {USE_CONSULT_LABEL}
                    </label>
                    {consult}
                  </div>
                )}
              </div>
            }
            packageStep={
              <div className="lx-form-grid">
                {packages !== null && options.length > 0 && (
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
                    <span className="lx-note">Fills in the prices under More options. You can change any of them for this proposal, and it will say it was edited from the package.</span>
                  </label>
                )}
                <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
                  <span className="lx-label">Pay link</span>
                  <input className="lx-input" name="payUrl" type="url" maxLength={2000} defaultValue={defaults.payUrl} placeholder="Enter custom pay link" />
                </label>
                <ExpiryField defaultValue={defaults.expiresOn} today={today} />
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
              </div>
            }
            create={
              <>
                <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
                  {pending ? "Creating…" : "Create draft"}
                </button>
                <Outcome state={state} pending={pending} />
              </>
            }
            more={
              <div className="lx-form-grid">
                <label className="lx-field">
                  <span className="lx-label">First name (greeting)</span>
                  <input className="lx-input" name="firstName" maxLength={120} value={more.firstName} onChange={setMoreField("firstName")} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Company (optional)</span>
                  <input className="lx-input" name="company" maxLength={200} value={more.company} onChange={setMoreField("company")} />
                </label>
                <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
                  <span className="lx-label">Title</span>
                  <input className="lx-input" name="title" maxLength={300} value={more.title} onChange={setMoreField("title")} />
                </label>
                {packages !== null && options.length > 0 && (
                  <>
                    <label className="lx-field">
                      <span className="lx-label">Price with the included classes ($)</span>
                      <input className="lx-input" name="base" inputMode="decimal" required value={fields.base} onChange={set("base")} />
                    </label>
                    <label className="lx-field">
                      <span className="lx-label">Classes included</span>
                      <input className="lx-input" name="includedClasses" inputMode="numeric" required value={fields.includedClasses} onChange={set("includedClasses")} />
                    </label>
                    <label className="lx-field">
                      <span className="lx-label">Price per extra class ($)</span>
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
                {packages !== null && options.length > 0 && <FirstNamePackageFields packages={options.map((o) => o.name)} />}
              </div>
            }
          />
        </>
      )}
    </ActionForm>
  );
}

/**
 * One "Let the client choose a package" group, posted as `<prefix>pkgChoice` / `<prefix>pkgOption` / `<prefix>pkgDefault` (the
 * names `parsePackageChoiceFields` reads). The package boxes are always in the markup; while the group is off they are hidden
 * AND disabled, so nothing of them is posted.
 */
function PackageChoiceGroup({
  prefix,
  label,
  note,
  packages,
  off,
  onToggle,
}: {
  prefix: string;
  label: string;
  note: string;
  packages: string[];
  off?: boolean;
  onToggle?: (on: boolean) => void;
}) {
  const [on, setOn] = useState(false);
  const [ticked, setTicked] = useState<string[]>([]);
  const [def, setDef] = useState("");
  const active = on && !off;
  const tickedInOrder = packages.filter((p) => ticked.includes(p));
  const shownDefault = tickedInOrder.includes(def) ? def : tickedInOrder[0] ?? "";
  const noteId = `pe-new-pkg-${prefix || "name"}`.replace(/\./g, "-");
  return (
    <div className="pe-pkg-choice" hidden={off}>
      <label className="pe-check">
        <input
          type="checkbox"
          name={`${prefix}pkgChoice`}
          disabled={off}
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            onToggle?.(e.target.checked);
          }}
        />
        <span>{label}</span>
      </label>
      <div hidden={!active}>
        <span className="lx-note" id={noteId}>
          {note}
        </span>
        <div className="pe-pkg-options" role="group" aria-describedby={noteId}>
          {packages.map((p) => (
            <label key={p} className="pe-check">
              <input
                type="checkbox"
                name={`${prefix}pkgOption`}
                value={p}
                disabled={!active}
                checked={ticked.includes(p)}
                onChange={(e) => setTicked((prev) => (e.target.checked ? [...prev.filter((x) => x !== p), p] : prev.filter((x) => x !== p)))}
              />
              <span>{p}</span>
            </label>
          ))}
        </div>
        <label className="lx-field">
          <span className="lx-label">Starts selected</span>
          <select className="lx-input" name={`${prefix}pkgDefault`} disabled={!active} value={shownDefault} onChange={(e) => setDef(e.target.value)}>
            {tickedInOrder.length === 0 ? <option value="">Tick a package first</option> : null}
            {tickedInOrder.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

/**
 * Spec 6 / Spec 7 at create, for the FIRST brand name: the package the client chooses (for the brand name, or for each
 * mark), and its discount. The server re-reads every package name against the firm's current list
 * (`applyNewProposalPackageFields`); other brand names are set on the next page.
 */
function FirstNamePackageFields({ packages }: { packages: string[] }) {
  const [nameChoice, setNameChoice] = useState(false);
  return (
    <fieldset className="lx-field pe-pkg-choice" style={{ gridColumn: "1 / -1", border: 0, padding: 0, margin: 0 }}>
      <input type="hidden" name="pkgFields" value="1" />
      <legend className="lx-label">First brand name: package the client chooses</legend>
      <PackageChoiceGroup
        prefix=""
        label="Let the client choose a package"
        note="Tick 1 to 3 packages. The client picks one for this brand name, and it is priced at that package's prices."
        packages={packages}
        onToggle={setNameChoice}
      />
      {MARK_KINDS.map((kind) => (
        <PackageChoiceGroup
          key={kind}
          prefix={newMarkPackagePrefix(kind)}
          label={`Let the client choose a package for this mark (${MARK_KIND_LABEL[kind]})`}
          note="Tick 1 to 3 packages. This mark is priced at the package the client picks; a second mark still gets that package's second-mark discount."
          packages={packages}
          off={nameChoice}
        />
      ))}
      <label className="lx-field">
        <span className="lx-label">Discount on this brand name (%)</span>
        <input
          className="lx-input"
          name="discountPct"
          type="number"
          min={0}
          max={50}
          step={1}
          inputMode="numeric"
          placeholder="None"
          aria-describedby="pe-new-disc"
        />
        <span className="lx-note" id="pe-new-disc">
          A whole percent from 0 to 50, taken off this brand name&rsquo;s legal fee after its package price. The USPTO fee is never discounted.
        </span>
      </label>
    </fieldset>
  );
}
