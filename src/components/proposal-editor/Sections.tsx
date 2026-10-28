"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { classLock } from "@/lib/proposals/class-lock";
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
import type { PricingValues } from "./PricingFields";
import { newRowId, useRows, type Keyed } from "./rows";

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
};

/** The form ids that let More options fields belong to a step's form. */
export const detailsFormId = (proposalId: string) => `pe-details-${proposalId}`;
export const pricingFormId = (proposalId: string) => `pe-pricing-${proposalId}`;
export const nameFormId = (proposalId: string, nameId: string) => `pe-name-${proposalId}-${nameId}`;

/** Step 1: who the proposal is for. The rest of this form's fields are in More options (`DetailsMoreFields`). */
export function DetailsForm({ proposalId, updatedAt, editable, issues, values }: Common & { values: DetailsValues }) {
  return (
    <Section title="Client" hint="Who this is for. Its title, greeting name and expiry date are under More options.">
      <ActionForm action={saveDetailsAction} id={detailsFormId(proposalId)}>
        {({ state, pending }) => (
          <fieldset className="pe-fieldset" disabled={!editable}>
            <Hidden values={{ proposalId, updatedAt }} />
            <div className="lx-form-grid">
              <label className="lx-field">
                <span className="lx-label">Client full name</span>
                <input className="lx-input" name="fullName" required maxLength={300} defaultValue={values.fullName} />
              </label>
              <label className="lx-field">
                <span className="lx-label">Client email</span>
                <input className="lx-input" name="clientEmail" type="email" maxLength={320} defaultValue={values.clientEmail} />
              </label>
            </div>
            <IssueList issues={issues} />
            <SaveRow editable={editable} state={state} pending={pending} label="Save client" />
          </fieldset>
        )}
      </ActionForm>
    </Section>
  );
}

/** More options: the rest of the client form (greeting name, company, title, expiry date). Saved with Step 1's button. */
export function DetailsMoreFields({ proposalId, editable, values }: { proposalId: string; editable: boolean; values: DetailsValues }) {
  const form = detailsFormId(proposalId);
  return (
    <div className="lx-form-grid" role="group" aria-label="Client details, title and expiry">
      <label className="lx-field">
        <span className="lx-label">First name (greeting)</span>
        <input className="lx-input" name="firstName" form={form} disabled={!editable} maxLength={120} defaultValue={values.firstName} />
      </label>
      <label className="lx-field">
        <span className="lx-label">Company (optional)</span>
        <input className="lx-input" name="company" form={form} disabled={!editable} maxLength={200} defaultValue={values.company} />
      </label>
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Title</span>
        <input className="lx-input" name="title" form={form} disabled={!editable} required maxLength={300} defaultValue={values.title} />
      </label>
      <label className="lx-field">
        <span className="lx-label">Open until</span>
        <input className="lx-input" name="expiresOn" form={form} disabled={!editable} type="date" defaultValue={values.expiresOn} />
      </label>
      <p className="lx-note" style={{ gridColumn: "1 / -1", margin: 0 }}>
        Saved with the Client step&apos;s button.
      </p>
    </div>
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

/* ── package and pay link ──────────────────────────────────────────────── */

export type { PricingValues };

/** Step 3: the package name and where "Accept" sends the client to pay. The prices are in More options (`PricingMoreFields`). */
export function PricingForm({ proposalId, updatedAt, editable, issues, values, payUrl }: Common & { values: PricingValues; payUrl: string }) {
  return (
    <Section title="Package and pay link" hint="Totals are always worked out from the package, never typed. Packages are edited in Settings → Proposals; this proposal can change its own numbers under More options.">
      <ActionForm action={savePricingAction} id={pricingFormId(proposalId)}>
        {({ state, pending }) => (
          <fieldset className="pe-fieldset" disabled={!editable}>
            <Hidden values={{ proposalId, updatedAt }} />
            <div className="lx-form-grid">
              <label className="lx-field">
                <span className="lx-label">Package name</span>
                <input className="lx-input" name="package" required maxLength={120} defaultValue={values.package} />
              </label>
              <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lx-label">Pay link</span>
                <input className="lx-input" name="payUrl" type="url" maxLength={2000} defaultValue={payUrl} placeholder="Enter custom pay link" />
              </label>
            </div>
            <IssueList issues={issues} />
            <SaveRow editable={editable} state={state} pending={pending} label="Save package and pay link" />
          </fieldset>
        )}
      </ActionForm>
    </Section>
  );
}

/**
 * More options: the five package numbers and the custom-package switch. They belong to Step 3's form and
 * are saved with its button. `oneClassFlat` / `oneClassCustom` are the legal fee for one class under each
 * rule, worked out by the pricing engine (the page passes them as words).
 */
export function PricingMoreFields({
  proposalId,
  editable,
  values,
  reduceUnderIncluded,
  customLabel,
  customHelp,
}: {
  proposalId: string;
  editable: boolean;
  values: PricingValues;
  reduceUnderIncluded: boolean;
  customLabel: string;
  customHelp: string;
}) {
  const form = pricingFormId(proposalId);
  const common = { form, disabled: !editable } as const;
  return (
    <div className="lx-form-grid" role="group" aria-label="Package prices">
      <label className="lx-field">
        <span className="lx-label">Price with the included classes ($)</span>
        <input className="lx-input" name="base" {...common} inputMode="decimal" required defaultValue={values.base} />
      </label>
      <label className="lx-field">
        <span className="lx-label">Classes included</span>
        <input className="lx-input" name="includedClasses" {...common} inputMode="numeric" required defaultValue={values.includedClasses} />
      </label>
      <label className="lx-field">
        <span className="lx-label">Price per extra class ($)</span>
        <input className="lx-input" name="perClass" {...common} inputMode="decimal" required defaultValue={values.perClass} />
      </label>
      <label className="lx-field">
        <span className="lx-label">Second mark discount (%)</span>
        <input className="lx-input" name="secondMarkPct" {...common} inputMode="decimal" required defaultValue={values.secondMarkPct} />
      </label>
      <label className="lx-field">
        <span className="lx-label">USPTO fee per class per mark ($)</span>
        <input className="lx-input" name="govPerClass" {...common} inputMode="decimal" required defaultValue={values.govPerClass} />
      </label>
      <div className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <label className="pe-check" style={{ whiteSpace: "normal" }}>
          <input type="checkbox" name="reduceUnderIncluded" {...common} defaultChecked={reduceUnderIncluded} /> {customLabel}
        </label>
        <span className="lx-note">{customHelp}</span>
      </div>
      <p className="lx-note" style={{ gridColumn: "1 / -1", margin: 0 }}>
        Saved with the Package and pay link step&apos;s button.
      </p>
    </div>
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

/* The marks and classes of every brand name are held in one place, because Step 2 draws their pickers and
 * More options draws the same marks' descriptions: both must agree on which row is which. */

type MarkRow = NameValues["marks"][number];
type ClassRow = NameValues["classes"][number];
type NameRows = { marks: Keyed<MarkRow>[]; classes: Keyed<ClassRow>[]; next: number };

const NameRowsContext = createContext<{
  rows: Record<string, NameRows>;
  change: (nameId: string, fn: (r: NameRows) => NameRows) => void;
} | null>(null);

/** Wrap the builder once. Give it a `key` that changes when a brand name is added or removed. */
export function NameRowsProvider({ names, children }: { names: NameValues[]; children: ReactNode }) {
  const [rows, setRows] = useState<Record<string, NameRows>>(() =>
    Object.fromEntries(
      names.map((n) => [
        n.id,
        {
          marks: n.marks.map((m, i) => ({ ...m, key: `m${i}` })),
          classes: n.classes.map((c, i) => ({ ...c, key: `c${i}` })),
          next: Math.max(n.marks.length, n.classes.length),
        },
      ]),
    ),
  );
  const change = (nameId: string, fn: (r: NameRows) => NameRows) => setRows((all) => (all[nameId] ? { ...all, [nameId]: fn(all[nameId]) } : all));
  return <NameRowsContext.Provider value={{ rows, change }}>{children}</NameRowsContext.Provider>;
}

function useNameRows(value: NameValues) {
  const ctx = useContext(NameRowsContext);
  if (!ctx) throw new Error("NameCard needs a NameRowsProvider above it.");
  const mine = ctx.rows[value.id] ?? { marks: [], classes: [], next: 0 };
  const move = <T extends object>(list: Keyed<T>[], key: string, by: -1 | 1): Keyed<T>[] => {
    const i = list.findIndex((r) => r.key === key);
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  };
  return {
    marks: mine.marks,
    classes: mine.classes,
    addMark: (row: MarkRow) => ctx.change(value.id, (r) => ({ ...r, marks: [...r.marks, { ...row, key: `n${r.next}` }], next: r.next + 1 })),
    removeMark: (key: string) => ctx.change(value.id, (r) => ({ ...r, marks: r.marks.filter((x) => x.key !== key) })),
    moveMark: (key: string, by: -1 | 1) => ctx.change(value.id, (r) => ({ ...r, marks: move(r.marks, key, by) })),
    setMarkDesc: (key: string, desc: string) => ctx.change(value.id, (r) => ({ ...r, marks: r.marks.map((x) => (x.key === key ? { ...x, desc } : x)) })),
    addClass: (row: ClassRow) => ctx.change(value.id, (r) => ({ ...r, classes: [...r.classes, { ...row, key: `n${r.next}` }], next: r.next + 1 })),
    removeClass: (key: string) => ctx.change(value.id, (r) => ({ ...r, classes: r.classes.filter((x) => x.key !== key) })),
    setClassTicked: (key: string, preselected: boolean) =>
      ctx.change(value.id, (r) => ({ ...r, classes: r.classes.map((x) => (x.key === key ? { ...x, preselected } : x)) })),
  };
}

/** Step 2: one brand name, its marks and its classes. Its note, own price and mark descriptions are under More options (`NameMoreFields`). */
export function NameCard({ proposalId, updatedAt, editable, issues, value }: Common & { value: NameValues; packageName: string }) {
  const rows = useNameRows(value);
  // Every package includes one class: the class that is the only one ticked cannot be unticked.
  const lock = classLock(
    { marks: [], classes: rows.classes },
    Object.fromEntries(rows.classes.map((c) => [c.id, c.preselected])),
  );

  return (
    <section className="lx-card pe-card" aria-label={`Brand name ${value.name}`}>
      <header className="pe-card-head pe-card-head-row">
        <h3 className="pe-h">{value.name || "Brand name"}</h3>
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

      <ActionForm action={saveNameAction} id={nameFormId(proposalId, value.id)}>
        {({ state, pending }) => (
          <fieldset className="pe-fieldset" disabled={!editable}>
            <Hidden values={{ proposalId, updatedAt, nameId: value.id }} />
            <div className="lx-form-grid">
              <label className="lx-field">
                <span className="lx-label">Brand name</span>
                <input className="lx-input" name="name" required maxLength={200} defaultValue={value.name} />
              </label>
            </div>

            <div className="pe-sub">
              <div className="lx-label">Marks</div>
              <p className="lx-note pe-hint">The first ticked mark is full price. Each later ticked mark of this brand gets the second-mark discount, so order matters.</p>
              <div className="pe-rows">
                {rows.marks.map((m, i) => (
                  <div key={m.key} className="pe-mark-row">
                    <input type="hidden" name={`mark.${i}.id`} value={m.id} />
                    <select className="lx-input" name={`mark.${i}.kind`} defaultValue={m.kind} aria-label="Mark type">
                      {MARK_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {MARK_KIND_LABEL[k]}
                        </option>
                      ))}
                    </select>
                    <label className="pe-check">
                      <input type="checkbox" name={`mark.${i}.preselected`} defaultChecked={m.preselected} />
                      <span>Starts ticked</span>
                    </label>
                    {editable && (
                      <span className="pe-row-tools">
                        <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => rows.moveMark(m.key, -1)} aria-label="Move mark up" disabled={i === 0}>
                          ↑
                        </button>
                        <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => rows.moveMark(m.key, 1)} aria-label="Move mark down" disabled={i === rows.marks.length - 1}>
                          ↓
                        </button>
                        <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => rows.removeMark(m.key)}>
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
                        onClick={() => rows.addMark({ id: newRowId("m"), kind: k, desc: MARK_KIND_DEFAULT_DESC[k], preselected: true })}
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
              <p className="lx-note pe-hint">Describe each in plain business language, like “Cloud-based software”. Never an International Class number. Every package includes one class.</p>
              <div className="pe-rows">
                {rows.classes.map((c, i) => {
                  const locked = lock?.classId === c.id;
                  return (
                    <div key={c.key} className="pe-class-row">
                      <input type="hidden" name={`class.${i}.id`} value={c.id} />
                      <input className="lx-input" name={`class.${i}.label`} defaultValue={c.label} aria-label="Class description" maxLength={300} />
                      <label className="pe-check">
                        {/* A disabled box is not posted, so a locked one is posted by the hidden twin beside it. */}
                        {locked ? <input type="hidden" name={`class.${i}.preselected`} value="on" /> : null}
                        <input
                          type="checkbox"
                          name={locked ? undefined : `class.${i}.preselected`}
                          checked={c.preselected}
                          disabled={locked}
                          onChange={(e) => rows.setClassTicked(c.key, e.target.checked)}
                        />
                        <span>Starts ticked</span>
                        {locked ? <span className="pe-lock">{lock.text}</span> : null}
                      </label>
                      {editable && (
                        <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => rows.removeClass(c.key)}>
                          Remove
                        </button>
                      )}
                    </div>
                  );
                })}
                {editable && (
                  <div className="pe-add">
                    <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => rows.addClass({ id: newRowId("c"), label: "", preselected: true })}>
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

/** More options, per brand name: what it is, its note, its own price, and what each mark protects. Saved with that brand's button in Step 2. */
export function NameMoreFields({ proposalId, editable, value, packageName }: { proposalId: string; editable: boolean; value: NameValues; packageName: string }) {
  const rows = useNameRows(value);
  const form = nameFormId(proposalId, value.id);
  const common = { form, disabled: !editable } as const;
  return (
    <fieldset className="pe-fieldset" style={{ border: 0, padding: 0, margin: 0 }} aria-label={`More about ${value.name || "this brand name"}`}>
      <div className="lx-label">{value.name || "Brand name"}</div>
      <div className="lx-form-grid">
        <label className="lx-field">
          <span className="lx-label">What it is (optional)</span>
          <input className="lx-input" name="what" {...common} maxLength={200} defaultValue={value.what} placeholder="Your company name" />
        </label>
        <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
          <span className="lx-label">Note on this brand’s card (optional)</span>
          <textarea className="lx-input" name="note" {...common} rows={2} maxLength={2000} defaultValue={value.note} />
          <span className="lx-note">Wrap words in **double asterisks** for bold. Nothing else is formatted.</span>
        </label>
        <label className="lx-field">
          <span className="lx-label">{packageName || "Package"} price with the included classes ($)</span>
          <input className="lx-input" name="overrideBase" {...common} inputMode="decimal" defaultValue={value.overrideBase} placeholder="Package price" />
        </label>
        <label className="lx-field">
          <span className="lx-label">Price per extra class ($)</span>
          <input className="lx-input" name="overridePerClass" {...common} inputMode="decimal" defaultValue={value.overridePerClass} placeholder="Package price" />
        </label>
        {rows.marks.map((m, i) => (
          <label key={m.key} className="lx-field" style={{ gridColumn: "1 / -1" }}>
            <span className="lx-label">{`${MARK_KIND_LABEL[m.kind]} ${i + 1}: what it protects`}</span>
            <input
              className="lx-input"
              name={`mark.${i}.desc`}
              {...common}
              aria-label="What this mark protects"
              maxLength={600}
              value={m.desc}
              onChange={(e) => rows.setMarkDesc(m.key, e.target.value)}
            />
          </label>
        ))}
      </div>
    </fieldset>
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
        A new brand starts with a word mark and a logo mark, and no class yet. Add what it is used for before creating the link.
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
