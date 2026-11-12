"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { classLock } from "@/lib/proposals/class-lock";
import { DEFAULT_CLIENT_ADD, DEFAULT_CLIENT_ENTRY_PROMPT, MAX_CLIENT_ADD } from "@/lib/proposals/client-classes";
import { MARK_KIND_DEFAULT_DESC, MARK_KIND_LABEL, MARK_KINDS, type MarkKind, type ProposalInclude } from "@/lib/proposals/types";
import { addNameAction, removeNameAction } from "@/app/dashboard/proposals/[id]/actions";
import { fieldId, sectionId } from "@/lib/proposal-editor/checklist";
import { EDITOR_WORDS } from "@/lib/proposal-editor/vocabulary";
import { ActionForm, IssueList, Outcome, type ShownIssue } from "./ActionForm";
import { ExpiryField } from "./ExpiryField";
import { IncludesFields } from "./IncludesFields";
import { newRowId, useRows, type Keyed } from "./rows";
import { useUnsaved } from "./UnsavedGuard";

/**
 * The editor's sections, all inside ONE form with ONE Save (`DraftFormElement`). A section is a `<fieldset
 * disabled>` when the version can't be edited, so the same markup is the read-only view. Nothing in here has a
 * Save button: the buttons are in the side column (`EditorActions`).
 *
 * A brand name's fields are posted as `b.<n>.<field>` so several brands share the form; `runSaveDraft` strips the
 * prefix and gives each to the existing brand parser.
 */

type Editable = { editable: boolean };

function Hidden({ values }: { values: Record<string, string> }) {
  return (
    <>
      {Object.entries(values).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="lx-card pe-card" id={id} aria-label={title}>
      <header className="pe-card-head">
        <h2 className="pe-h">{title}</h2>
        {hint && <p className="lx-note pe-hint">{hint}</p>}
      </header>
      {children}
    </section>
  );
}

/* ── 1. who ─────────────────────────────────────────────────────────────── */

export type DetailsValues = { fullName: string; firstName: string; company: string; clientEmail: string; title: string };

export function WhoSection({ editable, issues, values }: Editable & { issues: ShownIssue[]; values: DetailsValues }) {
  return (
    <Section id={sectionId.who} title="Who is it for?" hint="The first name is used in the greeting.">
      <fieldset className="pe-fieldset" disabled={!editable}>
        <div className="lx-form-grid">
          <label className="lx-field">
            <span className="lx-label">Client full name</span>
            <input className="lx-input" id={fieldId.fullName} name="fullName" required maxLength={300} defaultValue={values.fullName} />
          </label>
          <label className="lx-field">
            <span className="lx-label">First name (greeting)</span>
            <input className="lx-input" id={fieldId.firstName} name="firstName" maxLength={120} defaultValue={values.firstName} />
          </label>
          <label className="lx-field">
            <span className="lx-label">Client email</span>
            <input className="lx-input" id={fieldId.clientEmail} name="clientEmail" type="email" maxLength={320} defaultValue={values.clientEmail} />
          </label>
          <label className="lx-field">
            <span className="lx-label">Company (optional)</span>
            <input className="lx-input" id={fieldId.company} name="company" maxLength={200} defaultValue={values.company} />
          </label>
          <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
            <span className="lx-label">Proposal title</span>
            <input className="lx-input" id={fieldId.title} name="title" required maxLength={300} defaultValue={values.title} />
          </label>
        </div>
        <IssueList issues={issues} />
      </fieldset>
    </Section>
  );
}

/* ── 4. message ─────────────────────────────────────────────────────────── */

export function MessageSection({
  editable,
  issues,
  values,
  general = false,
}: Editable & { issues: ShownIssue[]; values: { greeting: string; recommendation: string; officeActionNote: string }; general?: boolean }) {
  return (
    <Section id={sectionId.message} title="Message" hint="Plain business language. Never an International Class number. “Class 1, 2, 3” counting labels are fine.">
      <fieldset className="pe-fieldset" disabled={!editable}>
        <label className="lx-field">
          <span className="lx-label">Greeting</span>
          <textarea className="lx-input" id={fieldId.greeting} name="greeting" rows={3} maxLength={4000} defaultValue={values.greeting} />
        </label>
        {!general && (
          <>
            <label className="lx-field">
              <span className="lx-label">Recommendation (yellow box, optional)</span>
              <textarea className="lx-input" id={fieldId.recommendation} name="recommendation" rows={3} maxLength={4000} defaultValue={values.recommendation} />
            </label>
            <label className="lx-field">
              <span className="lx-label">Office action note (optional)</span>
              <textarea className="lx-input" id={fieldId.officeActionNote} name="officeActionNote" rows={3} maxLength={4000} defaultValue={values.officeActionNote} />
              <span className="lx-note">The substantive office action response is never part of a package; this note says it is quoted separately.</span>
            </label>
          </>
        )}
        <IssueList issues={issues} />
      </fieldset>
    </Section>
  );
}

/* ── 3. fees and payment ────────────────────────────────────────────────── */

export type PricingValues = { package: string; base: string; includedClasses: string; perClass: string; secondMarkPct: string; govPerClass: string };
export type AdjustmentValue = { id: string; label: string; kind: "amount" | "percent"; value: string };

export function FeesSection({
  editable,
  issues,
  general = false,
  payUrl,
  expiresOn,
  today,
  adjustments,
  pricing,
  hasBrandPackage,
  reduceUnderIncluded,
  customLabel,
  customHelp,
  includes,
}: Editable & {
  issues: ShownIssue[];
  general?: boolean;
  payUrl: string;
  expiresOn: string;
  today?: string;
  adjustments: AdjustmentValue[];
  /** Trademark drafts only. */
  pricing?: PricingValues;
  /** A brand has its own package: the proposal-level package control is hidden. */
  hasBrandPackage?: boolean;
  reduceUnderIncluded?: boolean;
  customLabel?: string;
  customHelp?: string;
  includes?: ProposalInclude[];
}) {
  return (
    <Section id={sectionId.fees} title="Fees and payment" hint="Totals are always worked out from the package, never typed. Packages are edited in Settings → Proposals.">
      <fieldset className="pe-fieldset" disabled={!editable}>
        <Adjustments initial={adjustments} />
        <div className="lx-form-grid">
          <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
            <span className="lx-label">Pay link</span>
            <input className="lx-input" id={fieldId.payUrl} name="payUrl" type="url" maxLength={2000} defaultValue={payUrl} placeholder="Enter custom pay link" />
          </label>
          <ExpiryField id={fieldId.expiresOn} defaultValue={expiresOn} today={today} disabled={!editable} />
          {!general && pricing && !hasBrandPackage && (
            <label className="lx-field">
              <span className="lx-label">Package for this proposal</span>
              <input className="lx-input" id={fieldId.pricing("package")} name="package" required maxLength={120} defaultValue={pricing.package} />
            </label>
          )}
        </div>
        {!general && pricing && hasBrandPackage && (
          <>
            <input type="hidden" name="package" value={pricing.package} />
            <p className="lx-note">A brand name has its own package, so the whole-proposal package is not set here. Its numbers are under Advanced pricing.</p>
          </>
        )}
        <IssueList issues={issues} />
        {!general && pricing && (
          <details className="pe-adv">
            <summary className="pe-adv-sum">{EDITOR_WORDS.advancedPricing}</summary>
            <div className="pe-adv-body">
              <div className="lx-form-grid" role="group" aria-label="Package prices">
                <label className="lx-field">
                  <span className="lx-label">Price with the included classes ($)</span>
                  <input className="lx-input" id={fieldId.pricing("base_cents")} name="base" inputMode="decimal" defaultValue={pricing.base} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Classes included</span>
                  <input className="lx-input" id={fieldId.pricing("included_classes")} name="includedClasses" inputMode="numeric" defaultValue={pricing.includedClasses} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Price per extra class ($)</span>
                  <input className="lx-input" id={fieldId.pricing("per_class_cents")} name="perClass" inputMode="decimal" defaultValue={pricing.perClass} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">Second mark discount (%)</span>
                  <input className="lx-input" id={fieldId.pricing("second_mark_discount_pct")} name="secondMarkPct" inputMode="decimal" defaultValue={pricing.secondMarkPct} />
                </label>
                <label className="lx-field">
                  <span className="lx-label">USPTO fee per class per mark ($)</span>
                  <input className="lx-input" id={fieldId.pricing("gov_per_class_cents")} name="govPerClass" inputMode="decimal" defaultValue={pricing.govPerClass} />
                </label>
                <div className="lx-field" style={{ gridColumn: "1 / -1" }}>
                  <label className="pe-check" style={{ whiteSpace: "normal" }}>
                    <input type="checkbox" name="reduceUnderIncluded" defaultChecked={reduceUnderIncluded === true} /> {customLabel}
                  </label>
                  <span className="lx-note">{customHelp}</span>
                </div>
              </div>
              <div className="lx-label">What the package includes</div>
              <p className="lx-note pe-hint">The table the client sees under the totals. The substantive office action response is never listed here; the strategy review is fine.</p>
              <input type="hidden" name="incFields" value="1" />
              <div id={fieldId.includes}>
                <IncludesFields initial={includes ?? []} editable={editable} />
              </div>
            </div>
          </details>
        )}
      </fieldset>
    </Section>
  );
}

function Adjustments({ initial }: { initial: AdjustmentValue[] }) {
  const list = useRows(initial);
  return (
    <div className="pe-sub" id={fieldId.adjustments}>
      <input type="hidden" name="adjFields" value="1" />
      <div className="lx-label">Credit or discount on the whole proposal</div>
      <p className="lx-note pe-hint">Taken off the legal fee only, never the USPTO fee. A consultation credit is a dollar amount; a referral discount might be a percent.</p>
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
            <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => list.remove(a.key)}>
              Remove
            </button>
          </div>
        ))}
        <div className="pe-add">
          <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => list.add({ id: newRowId("a"), label: "", kind: "amount", value: "" })}>
            + Add discount or credit
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── 2. what we're protecting ───────────────────────────────────────────── */

export type NameValues = {
  id: string;
  name: string;
  what: string;
  note: string;
  overrideBase: string;
  overridePerClass: string;
  marks: { id: string; kind: MarkKind; desc: string; preselected: boolean; packageChoice?: { options: string[]; default: string } | null }[];
  classes: { id: string; label: string; preselected: boolean; clientEntry?: boolean }[];
  /** "Let the client add classes": the firm's own max ("0" = none), or "" for the default. */
  clientAddMax?: string;
  packageChoice?: { options: string[]; default: string } | null;
  discountPct?: string;
};

/** Holds the marks and classes of every brand so the card and its Advanced section agree on which row is which. */
type MarkRow = NameValues["marks"][number];
type ClassRow = NameValues["classes"][number];
type NameRows = { marks: Keyed<MarkRow>[]; classes: Keyed<ClassRow>[]; next: number };

const NameRowsContext = createContext<{ rows: Record<string, NameRows>; change: (nameId: string, fn: (r: NameRows) => NameRows) => void } | null>(null);

/** Wrap the brand cards once. Give it a `key` that changes when a brand name is added or removed. */
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
  const { rowAdded, rowRemoved, markDirty } = useUnsaved();
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
    addMark: (row: MarkRow) => {
      ctx.change(value.id, (r) => ({ ...r, marks: [...r.marks, { ...row, key: `n${r.next}` }], next: r.next + 1 }));
      rowAdded();
    },
    removeMark: (key: string) => {
      ctx.change(value.id, (r) => ({ ...r, marks: r.marks.filter((x) => x.key !== key) }));
      rowRemoved();
    },
    moveMark: (key: string, by: -1 | 1) => {
      ctx.change(value.id, (r) => ({ ...r, marks: move(r.marks, key, by) }));
      markDirty();
    },
    addClass: (row: ClassRow) => {
      ctx.change(value.id, (r) => ({ ...r, classes: [...r.classes, { ...row, key: `n${r.next}` }], next: r.next + 1 }));
      rowAdded();
    },
    removeClass: (key: string) => {
      ctx.change(value.id, (r) => ({ ...r, classes: r.classes.filter((x) => x.key !== key) }));
      rowRemoved();
    },
    setClassTicked: (key: string, preselected: boolean) =>
      ctx.change(value.id, (r) => ({ ...r, classes: r.classes.map((x) => (x.key === key ? { ...x, preselected } : x)) })),
    setClassOpen: (key: string, clientEntry: boolean) =>
      ctx.change(value.id, (r) => ({ ...r, classes: r.classes.map((x) => (x.key === key ? { ...x, clientEntry } : x)) })),
  };
}

export const removeFormId = (nameId: string) => `pe-rm-${nameId}`;
export const ADD_NAME_FORM_ID = "pe-add-name";

type PackageMode = "one" | "choice" | "perMark";

function initialMode(v: NameValues): PackageMode {
  if (v.packageChoice) return "choice";
  if (v.marks.some((m) => m.packageChoice)) return "perMark";
  return "one";
}

/**
 * One brand name: its marks, classes, the package it is offered under and its discount, all in view; the rarely
 * used fields are in a closed "Advanced for this brand". Field names are prefixed `b.<index>.`.
 */
export function NameCard({
  index,
  editable,
  issues,
  value,
  packageName,
  firmPackages,
  brandCount,
}: Editable & {
  index: number;
  issues: ShownIssue[];
  value: NameValues;
  packageName: string;
  /** The firm's current package names plus any already in this proposal; null when the list couldn't be read. */
  firmPackages: string[] | null;
  brandCount: number;
}) {
  const rows = useNameRows(value);
  const p = `b.${index}.`;
  const lock = classLock({ marks: [], classes: rows.classes }, Object.fromEntries(rows.classes.map((c) => [c.id, c.preselected])));
  const [mode, setMode] = useState<PackageMode>(() => initialMode(value));
  const [ticked, setTicked] = useState<string[]>(value.packageChoice?.options ?? []);
  const [def, setDef] = useState(value.packageChoice?.default ?? "");
  const list = firmPackages ?? [];
  const tickedInOrder = list.filter((x) => ticked.includes(x));
  const shownDefault = tickedInOrder.includes(def) ? def : (tickedInOrder[0] ?? "");
  const radio = `${p}pkgMode`;

  return (
    <section className="lx-card pe-card pe-brand" id={fieldId.brand(index)} aria-label={`Brand name ${value.name}`}>
      <header className="pe-card-head pe-card-head-row">
        <h3 className="pe-h">{value.name || "Brand name"}</h3>
        {editable && (
          // The remove button belongs to a small form OUTSIDE the editor's one form (see `BrandForms`), by `form=`.
          <button type="submit" form={removeFormId(value.id)} className="lx-btn lx-btn-ghost lx-btn-sm">
            Remove brand name
          </button>
        )}
      </header>

      <fieldset className="pe-fieldset" disabled={!editable}>
        <input type="hidden" name={`${p}nameId`} value={value.id} />
        <input type="hidden" name={`${p}pkgFields`} value="1" />
        <div className="lx-form-grid">
          <label className="lx-field">
            <span className="lx-label">Brand name</span>
            <input className="lx-input" id={fieldId.brandName(index)} name={`${p}name`} required maxLength={200} defaultValue={value.name} />
          </label>
        </div>

        <div className="pe-sub" id={fieldId.brandMarks(index)}>
          <div className="lx-label">Marks</div>
          <p className="lx-note pe-hint">The first selected mark is full price. Each later selected mark of this brand gets the second-mark discount, so order matters.</p>
          <div className="pe-rows">
            {rows.marks.map((m, i) => (
              <div key={m.key} className="pe-mark-row">
                <input type="hidden" name={`${p}mark.${i}.id`} value={m.id} />
                <select className="lx-input" name={`${p}mark.${i}.kind`} defaultValue={m.kind} aria-label="Mark type">
                  {MARK_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {MARK_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
                <label className="pe-check">
                  <input type="checkbox" name={`${p}mark.${i}.preselected`} defaultChecked={m.preselected} />
                  <span>{EDITOR_WORDS.selectedToStart}</span>
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
                {mode === "perMark" && (
                  <MarkPackageChoice
                    prefix={`${p}mark.${i}.`}
                    label={`${MARK_KIND_LABEL[m.kind]} ${i + 1}`}
                    saved={value.marks.find((x) => x.id === m.id)?.packageChoice ?? null}
                    firmPackages={list}
                  />
                )}
              </div>
            ))}
            {editable && (
              <div className="pe-add">
                {MARK_KINDS.map((k) => (
                  <button key={k} type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => rows.addMark({ id: newRowId("m"), kind: k, desc: MARK_KIND_DEFAULT_DESC[k], preselected: true })}>
                    + Add {MARK_KIND_LABEL[k].toLowerCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="pe-sub" id={fieldId.brandClasses(index)}>
          <div className="lx-label">Classes (what the brand is used for)</div>
          <p className="lx-note pe-hint">
            Describe each in plain business language, like “Cloud-based software”. Never an International Class number. Every package includes one class. Not
            sure what they sell? Tick “{EDITOR_WORDS.clientDescribes}” and the box becomes the question the client answers.
          </p>
          <div className="pe-rows">
            {rows.classes.map((c, i) => {
              const locked = lock?.classId === c.id;
              return (
                <div key={c.key} className="pe-class-row">
                  <input type="hidden" name={`${p}class.${i}.id`} value={c.id} />
                  <input
                    className="lx-input"
                    name={`${p}class.${i}.label`}
                    defaultValue={c.label}
                    aria-label={c.clientEntry ? "Question the client answers" : "Class description"}
                    placeholder={c.clientEntry ? DEFAULT_CLIENT_ENTRY_PROMPT : undefined}
                    maxLength={300}
                  />
                  <label className="pe-check">
                    <input type="checkbox" name={`${p}class.${i}.clientEntry`} checked={c.clientEntry === true} onChange={(e) => rows.setClassOpen(c.key, e.target.checked)} />
                    <span>{EDITOR_WORDS.clientDescribes}</span>
                  </label>
                  <label className="pe-check">
                    {/* A disabled box is not posted, so a locked one is posted by the hidden twin beside it. */}
                    {locked ? <input type="hidden" name={`${p}class.${i}.preselected`} value="on" /> : null}
                    <input
                      type="checkbox"
                      name={locked ? undefined : `${p}class.${i}.preselected`}
                      checked={c.preselected}
                      disabled={locked}
                      onChange={(e) => rows.setClassTicked(c.key, e.target.checked)}
                    />
                    <span>{EDITOR_WORDS.selectedToStart}</span>
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
                <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => rows.addClass({ id: newRowId("c"), label: "", preselected: true, clientEntry: false })}>
                  + Add class
                </button>
              </div>
            )}
          </div>
        </div>

        <fieldset className="pe-sub pe-pkg-for" id={fieldId.brandPackage(index)} style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="lx-label">{EDITOR_WORDS.packageForBrand}</legend>
          {firmPackages === null ? (
            <>
              <span className="lx-note" role="status">
                Couldn&rsquo;t load the firm&rsquo;s packages, so this can&rsquo;t be changed right now. Refresh to try again.
              </span>
              {/* With the list unreadable the saved choice is still posted, so a save never drops it. */}
              {value.packageChoice ? (
                <>
                  <input type="hidden" name={`${p}pkgChoice`} value="on" />
                  {value.packageChoice.options.map((o) => (
                    <input key={o} type="hidden" name={`${p}pkgOption`} value={o} />
                  ))}
                  <input type="hidden" name={`${p}pkgDefault`} value={value.packageChoice.default} />
                </>
              ) : null}
              {value.marks.map((m, i) =>
                m.packageChoice ? (
                  <span key={m.id}>
                    <input type="hidden" name={`${p}mark.${i}.pkgChoice`} value="on" />
                    {m.packageChoice.options.map((o) => (
                      <input key={o} type="hidden" name={`${p}mark.${i}.pkgOption`} value={o} />
                    ))}
                    <input type="hidden" name={`${p}mark.${i}.pkgDefault`} value={m.packageChoice.default} />
                  </span>
                ) : null,
              )}
            </>
          ) : (
            <>
              <div className="pe-pkg-modes" role="radiogroup" aria-label={EDITOR_WORDS.packageForBrand}>
                <label className="pe-check">
                  <input type="radio" name={radio} value="one" checked={mode === "one"} onChange={() => setMode("one")} />
                  <span>One package{packageName ? ` (${packageName})` : ""}</span>
                </label>
                <label className="pe-check">
                  <input type="radio" name={radio} value="choice" checked={mode === "choice"} onChange={() => setMode("choice")} />
                  <span>The client chooses</span>
                </label>
                <label className="pe-check">
                  <input type="radio" name={radio} value="perMark" checked={mode === "perMark"} onChange={() => setMode("perMark")} />
                  <span>A different package for each mark</span>
                </label>
              </div>
              {mode === "one" && <span className="lx-note">Priced at the proposal&rsquo;s package, set under Fees and payment.</span>}
              {mode === "choice" && (
                <>
                  <input type="hidden" name={`${p}pkgChoice`} value="on" />
                  <span className="lx-note" id={`pe-pkg-${value.id}`}>
                    Tick 1 to 3 packages. The client picks one for this brand name, and it is priced at that package&rsquo;s prices.
                  </span>
                  <div className="pe-pkg-options" role="group" aria-describedby={`pe-pkg-${value.id}`}>
                    {list.map((x) => (
                      <label key={x} className="pe-check">
                        <input
                          type="checkbox"
                          name={`${p}pkgOption`}
                          value={x}
                          checked={ticked.includes(x)}
                          onChange={(e) => setTicked((prev) => (e.target.checked ? [...prev.filter((y) => y !== x), x] : prev.filter((y) => y !== x)))}
                        />
                        <span>{x}</span>
                      </label>
                    ))}
                  </div>
                  <label className="lx-field">
                    <span className="lx-label">{EDITOR_WORDS.selectedToStart}</span>
                    <select className="lx-input" name={`${p}pkgDefault`} value={shownDefault} onChange={(e) => setDef(e.target.value)}>
                      {tickedInOrder.length === 0 ? <option value="">Tick a package first</option> : null}
                      {tickedInOrder.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {mode === "perMark" && <span className="lx-note">Choose the packages for each mark in the Marks list above.</span>}
            </>
          )}
        </fieldset>

        <label className="lx-field">
          <span className="lx-label">{EDITOR_WORDS.discountOnBrand} (%)</span>
          <input
            className="lx-input"
            id={fieldId.brandDiscount(index)}
            name={`${p}discountPct`}
            type="number"
            min={0}
            max={50}
            step={1}
            inputMode="numeric"
            defaultValue={value.discountPct ?? ""}
            placeholder="None"
            aria-describedby={`pe-disc-${value.id}`}
          />
          <span className="lx-note" id={`pe-disc-${value.id}`}>
            A whole percent from 0 to 50, taken off this brand name&rsquo;s legal fee after its package price. The USPTO fee is never discounted.
          </span>
        </label>

        {brandCount > 1 && (
          <label className="pe-check pe-apply-all">
            <input type="checkbox" name={`${p}applyAll`} />
            <span>{EDITOR_WORDS.everyBrand}</span>
          </label>
        )}

        <details className="pe-adv">
          <summary className="pe-adv-sum">{EDITOR_WORDS.advancedBrand}</summary>
          <div className="pe-adv-body lx-form-grid">
            <label className="lx-field">
              <span className="lx-label">What it is (optional)</span>
              <input className="lx-input" name={`${p}what`} maxLength={200} defaultValue={value.what} placeholder="Your company name" />
            </label>
            <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
              <span className="lx-label">Note on this brand’s card (optional)</span>
              <textarea className="lx-input" name={`${p}note`} rows={2} maxLength={2000} defaultValue={value.note} />
              <span className="lx-note">Wrap words in **double asterisks** for bold. Nothing else is formatted.</span>
            </label>
            <label className="lx-field">
              <span className="lx-label">{packageName || "Package"} price with the included classes ($)</span>
              <input className="lx-input" name={`${p}overrideBase`} inputMode="decimal" defaultValue={value.overrideBase} placeholder="Package price" />
            </label>
            <label className="lx-field">
              <span className="lx-label">Price per extra class ($)</span>
              <input className="lx-input" name={`${p}overridePerClass`} inputMode="decimal" defaultValue={value.overridePerClass} placeholder="Package price" />
              <span className="lx-note">A brand with its own price can&rsquo;t also offer a package choice.</span>
            </label>
            <label className="lx-field pe-client-add" style={{ gridColumn: "1 / -1" }}>
              <span className="lx-label">Let the client add classes (how many, 0 to {MAX_CLIENT_ADD})</span>
              <input
                className="lx-input"
                name={`${p}clientAddMax`}
                type="number"
                min={0}
                max={MAX_CLIENT_ADD}
                step={1}
                inputMode="numeric"
                defaultValue={value.clientAddMax ?? ""}
                placeholder="Default"
                aria-describedby={`pe-client-add-${value.id}`}
              />
              <span className="lx-note" id={`pe-client-add-${value.id}`}>
                Blank is the default: up to {DEFAULT_CLIENT_ADD}, or none when the proposal is one brand name, one mark and one class. 0 is none. Each class the
                client adds is priced like any other class, and they describe it in their own words.
              </span>
            </label>
            {rows.marks.map((m, i) => (
              <label key={m.key} className="lx-field" style={{ gridColumn: "1 / -1" }}>
                <span className="lx-label">{`${MARK_KIND_LABEL[m.kind]} ${i + 1}: what it protects`}</span>
                <input className="lx-input" name={`${p}mark.${i}.desc`} aria-label="What this mark protects" maxLength={600} defaultValue={m.desc} />
              </label>
            ))}
          </div>
        </details>

        <IssueList issues={issues} />
      </fieldset>
    </section>
  );
}

/** A mark's own package choice, shown beside that mark when "A different package for each mark" is picked. */
function MarkPackageChoice({ prefix, label, saved, firmPackages }: { prefix: string; label: string; saved: { options: string[]; default: string } | null; firmPackages: string[] }) {
  const [on, setOn] = useState(!!saved);
  const [ticked, setTicked] = useState<string[]>(saved?.options ?? []);
  const [def, setDef] = useState(saved?.default ?? "");
  const tickedInOrder = firmPackages.filter((x) => ticked.includes(x));
  const shownDefault = tickedInOrder.includes(def) ? def : (tickedInOrder[0] ?? "");
  const noteId = `pe-mpkg-${prefix.replace(/\./g, "-")}`;
  return (
    <div className="pe-pkg-choice pe-mark-pkg">
      <label className="pe-check">
        <input type="checkbox" name={`${prefix}pkgChoice`} checked={on} onChange={(e) => setOn(e.target.checked)} />
        <span>{`The client chooses a package for this mark (${label})`}</span>
      </label>
      {on ? (
        <>
          <span className="lx-note" id={noteId}>
            Tick 1 to 3 packages. This mark is priced at the package the client picks; a second mark still gets that package&rsquo;s second-mark discount.
          </span>
          <div className="pe-pkg-options" role="group" aria-describedby={noteId}>
            {firmPackages.map((x) => (
              <label key={x} className="pe-check">
                <input
                  type="checkbox"
                  name={`${prefix}pkgOption`}
                  value={x}
                  checked={ticked.includes(x)}
                  onChange={(e) => setTicked((prev) => (e.target.checked ? [...prev.filter((y) => y !== x), x] : prev.filter((y) => y !== x)))}
                />
                <span>{x}</span>
              </label>
            ))}
          </div>
          <label className="lx-field">
            <span className="lx-label">{EDITOR_WORDS.selectedToStart}</span>
            <select className="lx-input" name={`${prefix}pkgDefault`} value={shownDefault} onChange={(e) => setDef(e.target.value)}>
              {tickedInOrder.length === 0 ? <option value="">Tick a package first</option> : null}
              {tickedInOrder.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
    </div>
  );
}

/**
 * The brand section: its cards, then "Add a brand name". Add and Remove are small forms of their own, drawn OUTSIDE
 * the editor's one form (see `BrandForms`); the controls here reach them through the `form` attribute.
 */
export function BrandsSection({ children, editable, issues }: Editable & { children: ReactNode; issues: ShownIssue[] }) {
  return (
    <section className="lx-card pe-card" id={sectionId.brands} aria-label="What we're protecting">
      <header className="pe-card-head">
        <h2 className="pe-h">What we&rsquo;re protecting</h2>
        <p className="lx-note pe-hint">One card per brand name, with its marks, classes and package.</p>
      </header>
      <IssueList issues={issues} />
      <div className="pe-brands">{children}</div>
      {editable && (
        <div className="pe-add-name">
          <label className="lx-field" style={{ flex: 1, minWidth: 220 }}>
            <span className="lx-label">Add a brand name</span>
            <input className="lx-input" form={ADD_NAME_FORM_ID} name="name" maxLength={200} placeholder="e.g. Prosperall" />
          </label>
          <button type="submit" form={ADD_NAME_FORM_ID} className="lx-btn lx-btn-sec">
            Add brand name
          </button>
          <p className="lx-note pe-hint" style={{ flexBasis: "100%", margin: 0 }}>
            A new brand starts with a word mark and a logo mark, and no class yet. Press Save before adding or removing a brand name, so edits in the other cards aren&rsquo;t lost.
          </p>
        </div>
      )}
    </section>
  );
}

/** The Add and Remove brand forms, placed beside (not inside) the editor's form so forms never nest. */
export function BrandForms({ proposalId, updatedAt, names, editable }: { proposalId: string; updatedAt: string; names: { id: string; name: string }[]; editable: boolean }) {
  if (!editable) return null;
  return (
    <div className="pe-brand-forms">
      <ActionForm action={addNameAction} id={ADD_NAME_FORM_ID}>
        {({ state, pending }) => (
          <>
            <Hidden values={{ proposalId, updatedAt }} />
            <Outcome state={state} pending={pending} savedText="Brand name added." />
          </>
        )}
      </ActionForm>
      {names.map((n) => (
        <ActionForm key={n.id} action={removeNameAction} id={removeFormId(n.id)} confirm={`Remove ${n.name || "this brand name"} and its marks and classes?`}>
          {({ state, pending }) => (
            <>
              <Hidden values={{ proposalId, updatedAt, nameId: n.id }} />
              <Outcome state={state} pending={pending} savedText="Brand name removed." />
            </>
          )}
        </ActionForm>
      ))}
    </div>
  );
}
