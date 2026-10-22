"use client";

import { MARK_KIND_DEFAULT_DESC, MARK_KIND_LABEL, MARK_KINDS, type MarkKind, type ProposalInclude } from "@/lib/proposals/types";
import {
  addNameAction,
  removeNameAction,
  saveAdjustmentsAction,
  saveDetailsAction,
  saveIncludesAction,
  saveMessageAction,
  saveNameAction,
  savePricingAction,
} from "@/app/dashboard/proposals/[id]/actions";
import { ActionForm, IssueList, SaveRow, type ShownIssue } from "./ActionForm";
import { IncludesFields } from "./IncludesFields";
import { PricingFields, type PricingValues } from "./PricingFields";
import { newRowId, useRows } from "./rows";

/**
 * The editor's section forms. One form per section, each posting to its own
 * server action, which re-checks the module and role and sends the whole
 * updated document through `updateProposal`. A section is a `<fieldset
 * disabled>` when the version can't be edited, so the same markup is the
 * read-only view.
 */

/**
 * `updatedAt` is the row's `updated_at` as this page rendered it. Every editing
 * form posts it back so the save can be refused if someone else saved first.
 */
type Common = { proposalId: string; updatedAt: string; editable: boolean; issues: ShownIssue[] };

function Hidden({ values }: { values: Record<string, string> }) {
  return (
    <>
      {Object.entries(values).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="lx-card pe-card">
      <header className="pe-card-head">
        <h2 className="pe-h">{title}</h2>
        {hint && <p className="lx-note pe-hint">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

/* ── details ────────────────────────────────────────────────────────────── */

export type DetailsValues = {
  fullName: string;
  firstName: string;
  company: string;
  clientEmail: string;
  title: string;
  expiresOn: string;
  payUrl: string;
};

export function DetailsForm({ proposalId, updatedAt, editable, issues, values }: Common & { values: DetailsValues }) {
  return (
    <Section title="Client and link" hint="Who this is for, when it stops being open, and where “Accept” sends them to pay.">
      <ActionForm action={saveDetailsAction}>
        {({ state, pending }) => (
          <fieldset className="pe-fieldset" disabled={!editable}>
            <Hidden values={{ proposalId, updatedAt }} />
            <div className="lx-form-grid">
              <label className="lx-field">
                <span className="lx-label">Client full name</span>
                <input className="lx-input" name="fullName" required maxLength={300} defaultValue={values.fullName} />
              </label>
              <label className="lx-field">
                <span className="lx-label">First name (greeting)</span>
                <input className="lx-input" name="firstName" maxLength={120} defaultValue={values.firstName} />
              </label>
              <label className="lx-field">
                <span className="lx-label">Company (optional)</span>
                <input className="lx-input" name="company" maxLength={200} defaultValue={values.company} />
              </label>
              <label className="lx-field">
                <span className="lx-label">Client email</span>
                <input className="lx-input" name="clientEmail" type="email" maxLength={320} defaultValue={values.clientEmail} />
              </label>
              <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lx-label">Title</span>
                <input className="lx-input" name="title" required maxLength={300} defaultValue={values.title} />
              </label>
              <label className="lx-field">
                <span className="lx-label">Open until</span>
                <input className="lx-input" name="expiresOn" type="date" defaultValue={values.expiresOn} />
              </label>
              <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lx-label">Pay link</span>
                <input className="lx-input" name="payUrl" type="url" maxLength={2000} defaultValue={values.payUrl} placeholder="Enter custom pay link" />
              </label>
            </div>
            <IssueList issues={issues} />
            <SaveRow editable={editable} state={state} pending={pending} label="Save client and link" />
          </fieldset>
        )}
      </ActionForm>
    </Section>
  );
}

/* ── message ────────────────────────────────────────────────────────────── */

export function MessageForm({ proposalId, updatedAt, editable, issues, values }: Common & { values: { greeting: string; recommendation: string; officeActionNote: string } }) {
  return (
    <Section title="Words the client reads" hint="Plain business language. Never an International Class number. “Class 1, 2, 3” counting labels are fine.">
      <ActionForm action={saveMessageAction}>
        {({ state, pending }) => (
          <fieldset className="pe-fieldset" disabled={!editable}>
            <Hidden values={{ proposalId, updatedAt }} />
            <label className="lx-field">
              <span className="lx-label">Greeting</span>
              <textarea className="lx-input" name="greeting" rows={3} maxLength={4000} defaultValue={values.greeting} />
            </label>
            <label className="lx-field">
              <span className="lx-label">Recommendation (yellow box, optional)</span>
              <textarea className="lx-input" name="recommendation" rows={3} maxLength={4000} defaultValue={values.recommendation} />
            </label>
            <label className="lx-field">
              <span className="lx-label">Office action note (optional)</span>
              <textarea className="lx-input" name="officeActionNote" rows={3} maxLength={4000} defaultValue={values.officeActionNote} />
              <span className="lx-note">The substantive office action response is never part of a package; this note says it is quoted separately.</span>
            </label>
            <IssueList issues={issues} />
            <SaveRow editable={editable} state={state} pending={pending} label="Save wording" />
          </fieldset>
        )}
      </ActionForm>
    </Section>
  );
}

/* ── package pricing ────────────────────────────────────────────────────── */

export type { PricingValues };

export function PricingForm({ proposalId, updatedAt, editable, issues, values }: Common & { values: PricingValues }) {
  return (
    <Section
      title="Package prices"
      hint="Dollars here, whole cents underneath. Totals are always worked out from these, never typed. USPTO fees are due at filing and are shown to the client separately."
    >
      <ActionForm action={savePricingAction}>
        {({ state, pending }) => (
          <fieldset className="pe-fieldset" disabled={!editable}>
            <Hidden values={{ proposalId, updatedAt }} />
            <PricingFields values={values} />
            <IssueList issues={issues} />
            <SaveRow editable={editable} state={state} pending={pending} label="Save prices" />
          </fieldset>
        )}
      </ActionForm>
    </Section>
  );
}

/* ── one brand name ─────────────────────────────────────────────────────── */

export type NameValues = {
  id: string;
  name: string;
  what: string;
  note: string;
  overrideBase: string;
  overridePerClass: string;
  marks: { id: string; kind: MarkKind; desc: string; preselected: boolean }[];
  classes: { id: string; label: string; preselected: boolean }[];
};

export function NameCard({ proposalId, updatedAt, editable, issues, value, packageName }: Common & { value: NameValues; packageName: string }) {
  const marks = useRows(value.marks);
  const classes = useRows(value.classes);

  return (
    <section className="lx-card pe-card" aria-label={`Brand name ${value.name}`}>
      <header className="pe-card-head pe-card-head-row">
        <h2 className="pe-h">{value.name || "Brand name"}</h2>
        {editable && (
          <ActionForm action={removeNameAction} confirm={`Remove ${value.name || "this brand name"} and its marks and classes? Unsaved changes in this card are lost.`}>
            {({ state, pending }) => (
              <>
                <Hidden values={{ proposalId, updatedAt, nameId: value.id }} />
                <button type="submit" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={pending}>
                  Remove brand name
                </button>
                {state.error && (
                  <span role="alert" className="pe-msg pe-msg-err">
                    {state.error}
                  </span>
                )}
              </>
            )}
          </ActionForm>
        )}
      </header>

      <ActionForm action={saveNameAction}>
        {({ state, pending }) => (
          <fieldset className="pe-fieldset" disabled={!editable}>
            <Hidden values={{ proposalId, updatedAt, nameId: value.id }} />
            <div className="lx-form-grid">
              <label className="lx-field">
                <span className="lx-label">Brand name</span>
                <input className="lx-input" name="name" required maxLength={200} defaultValue={value.name} />
              </label>
              <label className="lx-field">
                <span className="lx-label">What it is (optional)</span>
                <input className="lx-input" name="what" maxLength={200} defaultValue={value.what} placeholder="Your company name" />
              </label>
              <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lx-label">Note on this brand’s card (optional)</span>
                <textarea className="lx-input" name="note" rows={2} maxLength={2000} defaultValue={value.note} />
                <span className="lx-note">Wrap words in **double asterisks** for bold. Nothing else is formatted.</span>
              </label>
            </div>

            <div className="pe-sub">
              <div className="lx-label">A different price for this brand (optional)</div>
              <div className="lx-form-grid">
                <label className="lx-field">
                  <span className="lx-label">{packageName || "Package"} price with the included classes ($)</span>
                  <input className="lx-input" name="overrideBase" inputMode="decimal" defaultValue={value.overrideBase} placeholder="Package price" />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Per class over / under ($)</span>
                  <input className="lx-input" name="overridePerClass" inputMode="decimal" defaultValue={value.overridePerClass} placeholder="Package price" />
                </label>
              </div>
            </div>

            <div className="pe-sub">
              <div className="lx-label">Marks</div>
              <p className="lx-note pe-hint">The first ticked mark is full price. Each later ticked mark of this brand gets the second-mark discount, so order matters.</p>
              <div className="pe-rows">
                {marks.rows.map((m, i) => (
                  <div key={m.key} className="pe-mark-row">
                    <input type="hidden" name={`mark.${i}.id`} value={m.id} />
                    <select className="lx-input" name={`mark.${i}.kind`} defaultValue={m.kind} aria-label="Mark type">
                      {MARK_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {MARK_KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                    <input className="lx-input" name={`mark.${i}.desc`} defaultValue={m.desc} aria-label="What this mark protects" maxLength={600} />
                    <label className="pe-check">
                      <input type="checkbox" name={`mark.${i}.preselected`} defaultChecked={m.preselected} />
                      <span>Starts ticked</span>
                    </label>
                    {editable && (
                      <span className="pe-row-tools">
                        <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => marks.move(m.key, -1)} aria-label="Move mark up" disabled={i === 0}>
                          ↑
                        </button>
                        <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => marks.move(m.key, 1)} aria-label="Move mark down" disabled={i === marks.rows.length - 1}>
                          ↓
                        </button>
                        <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => marks.remove(m.key)}>
                          Remove
                        </button>
                      </span>
                    )}
                  </div>
                ))}
                {editable && (
                  <div className="pe-add">
                    {MARK_KINDS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        className="lx-btn lx-btn-ghost lx-btn-sm"
                        onClick={() => marks.add({ id: newRowId("m"), kind: k, desc: MARK_KIND_DEFAULT_DESC[k], preselected: true })}
                      >
                        + Add {MARK_KIND_LABEL[k].toLowerCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="pe-sub">
              <div className="lx-label">Classes (what the brand is used for)</div>
              <p className="lx-note pe-hint">Describe each in plain business language, like “Cloud-based software”. Never an International Class number.</p>
              <div className="pe-rows">
                {classes.rows.map((c, i) => (
                  <div key={c.key} className="pe-class-row">
                    <input type="hidden" name={`class.${i}.id`} value={c.id} />
                    <input className="lx-input" name={`class.${i}.label`} defaultValue={c.label} aria-label="Class description" maxLength={300} />
                    <label className="pe-check">
                      <input type="checkbox" name={`class.${i}.preselected`} defaultChecked={c.preselected} />
                      <span>Starts ticked</span>
                    </label>
                    {editable && (
                      <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => classes.remove(c.key)}>
                        Remove
                      </button>
                    )}
                  </div>
                ))}
                {editable && (
                  <div className="pe-add">
                    <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => classes.add({ id: newRowId("c"), label: "", preselected: true })}>
                      + Add class
                    </button>
                  </div>
                )}
              </div>
            </div>

            <IssueList issues={issues} />
            <SaveRow editable={editable} state={state} pending={pending} label={`Save ${value.name || "brand name"}`} />
          </fieldset>
        )}
      </ActionForm>
    </section>
  );
}

export function AddNameForm({ proposalId, updatedAt, editable }: { proposalId: string; updatedAt: string; editable: boolean }) {
  if (!editable) return null;
  return (
    <section className="lx-card pe-card">
      <ActionForm action={addNameAction}>
        {({ state, pending }) => (
          <div className="pe-add-name">
            <Hidden values={{ proposalId, updatedAt }} />
            <label className="lx-field" style={{ flex: 1, minWidth: 220 }}>
              <span className="lx-label">Add a brand name</span>
              <input className="lx-input" name="name" required maxLength={200} placeholder="e.g. Prosperall" />
            </label>
            <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
              {pending ? "Adding…" : "Add brand name"}
            </button>
            {state.error && (
              <span role="alert" className="pe-msg pe-msg-err">
                {state.error}
              </span>
            )}
          </div>
        )}
      </ActionForm>
      <p className="lx-note pe-hint" style={{ margin: "8px 0 0" }}>
        A new brand starts with a word mark and a logo mark, and no class yet. Add what it is used for before approving.
      </p>
    </section>
  );
}

/* ── adjustments ────────────────────────────────────────────────────────── */

export type AdjustmentValue = { id: string; label: string; kind: "amount" | "percent"; value: string };

export function AdjustmentsForm({ proposalId, updatedAt, editable, issues, value }: Common & { value: AdjustmentValue[] }) {
  const list = useRows(value);
  return (
    <Section title="Discounts and credits" hint="Taken off the legal fee only, never the USPTO fee. A consultation credit is a dollar amount; a referral discount might be a percent.">
      <ActionForm action={saveAdjustmentsAction}>
        {({ state, pending }) => (
          <fieldset className="pe-fieldset" disabled={!editable}>
            <Hidden values={{ proposalId, updatedAt }} />
            <div className="pe-rows">
              {list.rows.length === 0 && <p className="lx-note">No discounts or credits.</p>}
              {list.rows.map((a, i) => (
                <div key={a.key} className="pe-adj-row">
                  <input type="hidden" name={`adj.${i}.id`} value={a.id} />
                  <input className="lx-input" name={`adj.${i}.label`} defaultValue={a.label} aria-label="What the client sees" placeholder="Consultation credit" maxLength={200} />
                  <select className="lx-input" name={`adj.${i}.kind`} defaultValue={a.kind} aria-label="Dollar amount or percent">
                    <option value="amount">$ off</option>
                    <option value="percent">% off</option>
                  </select>
                  <input className="lx-input" name={`adj.${i}.value`} defaultValue={a.value} aria-label="How much" inputMode="decimal" />
                  {editable && (
                    <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => list.remove(a.key)}>
                      Remove
                    </button>
                  )}
                </div>
              ))}
              {editable && (
                <div className="pe-add">
                  <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => list.add({ id: newRowId("a"), label: "", kind: "amount", value: "" })}>
                    + Add discount or credit
                  </button>
                </div>
              )}
            </div>
            <IssueList issues={issues} />
            <SaveRow editable={editable} state={state} pending={pending} label="Save discounts" />
          </fieldset>
        )}
      </ActionForm>
    </Section>
  );
}

/* ── includes ───────────────────────────────────────────────────────────── */

export function IncludesForm({ proposalId, updatedAt, editable, issues, initial }: Common & { initial: ProposalInclude[] }) {
  return (
    <Section title="What the package includes" hint="The table the client sees under the totals. The substantive office action response is never listed here; the strategy review is fine.">
      <ActionForm action={saveIncludesAction}>
        {({ state, pending }) => (
          <fieldset className="pe-fieldset" disabled={!editable}>
            <Hidden values={{ proposalId, updatedAt }} />
            <IncludesFields initial={initial} editable={editable} />
            <IssueList issues={issues} />
            <SaveRow editable={editable} state={state} pending={pending} label="Save included items" />
          </fieldset>
        )}
      </ActionForm>
    </Section>
  );
}
