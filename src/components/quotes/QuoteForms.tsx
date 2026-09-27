"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createQuoteAction } from "@/app/dashboard/quotes/actions";
import {
  addLineAction,
  applyServiceItemAction,
  deleteLineAction,
  generateTermsAction,
  moveLineAction,
  saveTermsAction,
  sendQuoteAction,
  updateDetailsAction,
  updateLineAction,
  withdrawQuoteAction,
} from "@/app/dashboard/quotes/[id]/actions";
import type { ActionState } from "@/app/dashboard/quotes/errors";
// Pure leaf modules only — never the store, which is server-only.
import {
  CHARGE_AT_LABEL,
  KIND_LABEL,
  QUOTE_LINE_KINDS,
  QUOTE_LINE_SELECTIONS,
  SELECTION_LABEL,
  chargeAtLabel,
  chargeAtOptionsFor,
  kindLabel,
} from "@/lib/quotes/labels";
import { centsToInput, formatCents } from "@/lib/quotes/money";
import type { QuoteLineRow } from "@/lib/quotes/types";

/**
 * The quote builder's client forms. Every one posts to a server action that
 * re-checks the attorney+ gate and the store's role gate on its own — nothing
 * here is the boundary, it only renders the controls.
 */

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

function Err({ state }: { state: ActionState }) {
  return state.error ? (
    <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
      {state.error}
    </p>
  ) : null;
}

function Hidden({ values }: { values: Record<string, string> }) {
  return (
    <>
      {Object.entries(values).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

const KIND_TONE: Record<string, string> = {
  legal_fee: "lx-pill-ox",
  government_fee: "lx-pill-warn",
  expense: "lx-pill-mute",
  discount: "lx-pill-risk",
};

/* ── new quote ──────────────────────────────────────────────────────────── */

export type ClientPickerOptions = {
  leads: { value: string; label: string }[];
  matters: { value: string; label: string }[];
  contacts: { value: string; label: string }[];
};

/**
 * "New quote". On success the action redirects to the new draft's builder, so
 * there is no success state here, only the refusal. The client picker is one
 * select over leads, matters and contacts — a quote may link to any one of
 * them (all three columns are nullable) — resolved server-side through RLS, so
 * nobody types an id.
 */
export function NewQuoteForm({ options }: { options: ClientPickerOptions }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createQuoteAction, {});
  const nothing = options.leads.length + options.matters.length + options.contacts.length === 0;
  return (
    <form action={action} className="lx-form-grid">
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Title</span>
        <input className="lx-input" name="title" required maxLength={300} placeholder="e.g. Acme Co. — trademark package" />
      </label>
      <label className="lx-field">
        <span className="lx-label">Client</span>
        <select className="lx-input" name="client" defaultValue="">
          <option value="">{nothing ? "No leads or matters yet" : "Not linked"}</option>
          {options.leads.length > 0 && (
            <optgroup label="Leads">
              {options.leads.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          {options.matters.length > 0 && (
            <optgroup label="Matters">
              {options.matters.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          {options.contacts.length > 0 && (
            <optgroup label="Contacts">
              {options.contacts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <label className="lx-field">
        <span className="lx-label">Open until</span>
        <input className="lx-input" name="expiresAt" type="date" />
      </label>
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Intro (shown above the fees)</span>
        <textarea className="lx-input" name="introBody" rows={2} maxLength={4000} />
      </label>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? "Creating…" : "Create draft"}
        </button>
        <Err state={state} />
      </div>
    </form>
  );
}

/* ── lifecycle and the client link ──────────────────────────────────────── */

/**
 * Send / withdraw, and the client link once sent.
 *
 * Nothing is emailed. Sending moves the quote to `sent` (which is what makes
 * its link resolve — a draft's token reads as not found) and the firm copies
 * the link into its own email. That is deliberate: this app has no send path
 * for quotes, and the approval queue is the only way anything reaches a client
 * from Lectual itself.
 *
 * Gates on the STORED status: a firm can still withdraw a `sent` quote whose
 * expiry has passed, which is a more honest record than leaving it `sent`.
 */
export function QuoteLifecycle({ quoteId, status, publicUrl }: { quoteId: string; status: string; publicUrl: string }) {
  const [sendState, sendAction, sending] = useActionState<ActionState, FormData>(sendQuoteAction, {});
  const [withdrawState, withdrawAction, withdrawing] = useActionState<ActionState, FormData>(withdrawQuoteAction, {});
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
        {status === "draft" && (
          <form action={sendAction}>
            <Hidden values={{ quoteId }} />
            <button type="submit" className="lx-btn lx-btn-pri" disabled={sending}>
              {sending ? "Sending…" : "Send to client"}
            </button>
          </form>
        )}
        {status === "sent" &&
          (confirmWithdraw ? (
            <form action={withdrawAction} style={{ display: "flex", gap: 6, alignItems: "flex-end", flexWrap: "wrap" }}>
              <Hidden values={{ quoteId }} />
              <label className="lx-field">
                <span className="lx-label">Note (internal, optional)</span>
                <input className="lx-input" name="note" maxLength={500} style={{ width: 220 }} />
              </label>
              <button type="submit" className="lx-btn lx-btn-danger" disabled={withdrawing}>
                {withdrawing ? "Withdrawing…" : "Confirm withdraw"}
              </button>
              <button type="button" className="lx-btn lx-btn-ghost" onClick={() => setConfirmWithdraw(false)}>
                Cancel
              </button>
            </form>
          ) : (
            <button type="button" className="lx-btn lx-btn-sec" onClick={() => setConfirmWithdraw(true)}>
              Withdraw
            </button>
          ))}
      </div>
      {status === "draft" && (
        <p className="lx-note" style={{ margin: 0 }}>
          Sending opens the client link. Nothing is emailed — you copy the link into your own message.
        </p>
      )}
      {status === "sent" && (
        <div className="lx-banner lx-banner-mute" style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="lx-label" style={{ fontSize: 11 }}>
            Client link
          </span>
          <code className="lx-num" style={{ fontSize: 12.5, overflowWrap: "anywhere", flex: "1 1 260px" }}>
            {publicUrl}
          </code>
          <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={copy}>
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
      <Err state={sendState} />
      <Err state={withdrawState} />
    </div>
  );
}

/* ── header details ─────────────────────────────────────────────────────── */

export function QuoteDetailsForm(props: { quoteId: string; title: string; introBody: string | null; expiresInput: string; isLive: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateDetailsAction, {});
  return (
    <form action={action} className="lx-form-grid">
      <Hidden values={{ quoteId: props.quoteId }} />
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Title</span>
        <input className="lx-input" name="title" required maxLength={300} defaultValue={props.title} />
      </label>
      <label className="lx-field">
        <span className="lx-label">Open until</span>
        <input className="lx-input" name="expiresAt" type="date" defaultValue={props.expiresInput} />
      </label>
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Intro (shown above the fees)</span>
        <textarea className="lx-input" name="introBody" rows={3} maxLength={4000} defaultValue={props.introBody ?? ""} />
      </label>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
          {pending ? "Saving…" : "Save details"}
        </button>
        {state.saved && !pending && !state.error && (
          <span className="lx-note" style={{ color: "var(--ok)" }}>
            Saved.
          </span>
        )}
        {props.isLive && <span className="lx-note">The client sees changes the next time they open the link.</span>}
        <Err state={state} />
      </div>
    </form>
  );
}

/* ── lines ──────────────────────────────────────────────────────────────── */

export type ServiceItemOption = { id: string; label: string; unit_amount_cents: number; kind: string };

/**
 * "Pick, don't retype." Applying COPIES the item's current values onto a new
 * line (`applyServiceItem`) — nothing keeps a reference back to the library
 * row, so a later price change in Settings never reaches an already-built quote.
 */
export function ServiceItemPicker({ quoteId, items }: { quoteId: string; items: ServiceItemOption[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(applyServiceItemAction, {});
  if (items.length === 0) {
    return (
      <p className="lx-note" style={{ margin: 0 }}>
        No services in the library yet. Owners and admins add them under{" "}
        <Link href="/dashboard/settings/services/">Settings → Service library</Link>.
      </p>
    );
  }
  return (
    <form action={action} style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
      <Hidden values={{ quoteId }} />
      <label className="lx-field" style={{ flex: "1 1 260px" }}>
        <span className="lx-label">Add from the service library</span>
        <select className="lx-input" name="serviceItemId" defaultValue="" required>
          <option value="" disabled>
            Choose a service…
          </option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} — {formatCents(item.unit_amount_cents)} ({kindLabel(item.kind)})
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
        {pending ? "Adding…" : "Add"}
      </button>
      <div style={{ flexBasis: "100%" }}>
        <Err state={state} />
      </div>
    </form>
  );
}

/**
 * Kind, schedule, selection and amount — shared by the add form and a line's
 * edit form. `kind` is local state so the "Charged" options are rebuilt from
 * `chargeAtOptionsFor(kind)` on every change: the moment "Government fee
 * (USPTO)" is chosen, "At signing" is not an option being rendered, so there
 * is no click that produces it. The posted value is the hidden field, kept in
 * sync, so a stale option a browser had already rendered cannot post either.
 */
function LineFields(props: { line?: QuoteLineRow }) {
  const line = props.line;
  const [kind, setKind] = useState<string>(line?.kind ?? "legal_fee");
  const [chargeAt, setChargeAt] = useState<string>(line?.charge_at ?? "signing");
  const [selection, setSelection] = useState<string>(line?.selection ?? "included");
  const chargeAtOptions = chargeAtOptionsFor(kind);
  const effectiveChargeAt = chargeAtOptions.includes(chargeAt as never) ? chargeAt : chargeAtOptions[0];

  function onKindChange(next: string) {
    setKind(next);
    const nextOptions = chargeAtOptionsFor(next);
    if (!nextOptions.includes(chargeAt as never)) setChargeAt(nextOptions[0]);
  }

  return (
    <>
      <input type="hidden" name="chargeAt" value={effectiveChargeAt} />
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Label</span>
        <input className="lx-input" name="label" required maxLength={300} defaultValue={line?.label ?? ""} placeholder="e.g. Trademark application — one class" />
      </label>
      <label className="lx-field">
        <span className="lx-label">Kind</span>
        <select className="lx-input" name="kind" value={kind} onChange={(e) => onKindChange(e.target.value)}>
          {QUOTE_LINE_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="lx-field">
        <span className="lx-label">Charged</span>
        <select className="lx-input" value={effectiveChargeAt} onChange={(e) => setChargeAt(e.target.value)}>
          {chargeAtOptions.map((c) => (
            <option key={c} value={c}>
              {CHARGE_AT_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="lx-field">
        <span className="lx-label">Selection</span>
        <select className="lx-input" name="selection" value={selection} onChange={(e) => setSelection(e.target.value)}>
          {QUOTE_LINE_SELECTIONS.map((s) => (
            <option key={s} value={s}>
              {SELECTION_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      {selection === "tier_option" && (
        <label className="lx-field">
          <span className="lx-label">Package group</span>
          <input className="lx-input" name="tierGroup" required maxLength={120} defaultValue={line?.tier_group ?? ""} placeholder="e.g. Search" />
        </label>
      )}
      {line && selection !== "included" && (
        <>
          {/* An included line's form has no checkbox at all, so an ABSENT field
              must not read as "deselected" — the marker says it was rendered. */}
          <input type="hidden" name="selectedFieldPresent" value="1" />
          <label className="lx-field" style={{ display: "flex", gap: 8, alignItems: "center", alignSelf: "end" }}>
            <input type="checkbox" name="selected" defaultChecked={line.selected} />
            <span style={{ fontSize: 14 }}>Pre-selected for the client</span>
          </label>
        </>
      )}
      <label className="lx-field">
        <span className="lx-label">Quantity</span>
        <input className="lx-input" name="quantity" type="number" min={1} step={1} defaultValue={line?.quantity ?? 1} />
      </label>
      <label className="lx-field">
        <span className="lx-label">{kind === "discount" ? "Discount amount ($)" : "Amount ($)"}</span>
        <input
          className="lx-input lx-num"
          name="amount"
          inputMode="decimal"
          required
          defaultValue={line ? centsToInput(line.unit_amount_cents) : ""}
          placeholder="0.00"
        />
      </label>
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Description (optional)</span>
        <input className="lx-input" name="description" maxLength={2000} defaultValue={line?.description ?? ""} />
      </label>
    </>
  );
}

/** A one-off line a library item doesn't cover. */
export function AddLineForm({ quoteId }: { quoteId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addLineAction, {});
  return (
    <details className="lx-disclosure-inline">
      <summary>Add a custom line</summary>
      <form action={action} className="lx-form-grid">
        <Hidden values={{ quoteId }} />
        <LineFields />
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
          <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
            {pending ? "Adding…" : "Add line"}
          </button>
          <Err state={state} />
        </div>
      </form>
    </details>
  );
}

function SmallAction(props: { action: Action; hidden: Record<string, string>; label: string; ariaLabel?: string; disabled?: boolean; danger?: boolean; onError: (s: ActionState) => void }) {
  // The row shows one error line for all three small buttons, so each reports
  // its result up rather than rendering its own.
  const [, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const next = await props.action(prev, fd);
    props.onError(next);
    return next;
  }, {});
  return (
    <form action={action}>
      <Hidden values={props.hidden} />
      <button
        type="submit"
        className={`lx-btn lx-btn-sm ${props.danger ? "lx-btn-danger" : "lx-btn-ghost"}`}
        disabled={props.disabled || pending}
        aria-label={props.ariaLabel}
      >
        {pending ? "…" : props.label}
      </button>
    </form>
  );
}

/**
 * One line: the summary row, and — while the quote is editable (draft or sent,
 * never accepted or terminal) — edit, reorder and delete.
 */
export function QuoteLineItem(props: { line: QuoteLineRow; quoteId: string; editable: boolean; canMoveUp: boolean; canMoveDown: boolean; currency: string }) {
  const { line, quoteId, editable } = props;
  const [editing, setEditing] = useState(false);
  const [smallError, setSmallError] = useState<ActionState>({});
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev: ActionState, fd: FormData) => {
    const next = await updateLineAction(prev, fd);
    if (!next.error) setEditing(false);
    return next;
  }, {});
  const hidden = { quoteId, lineId: line.id };

  return (
    <li style={{ display: "grid", gap: 8, padding: "12px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <span className={`lx-pill ${KIND_TONE[line.kind] ?? "lx-pill-mute"}`}>{kindLabel(line.kind)}</span>
        <span className="lx-pill lx-pill-mute">{chargeAtLabel(line.charge_at)}</span>
        {line.selection !== "included" && (
          <span className={`lx-pill ${line.selected ? "lx-pill-ok" : "lx-pill-mute"}`}>
            {line.selection === "tier_option" ? `Package · ${line.tier_group ?? "—"}` : "Optional"}
            {line.selected ? " · selected" : ""}
          </span>
        )}
        <span style={{ color: "var(--ink)", fontWeight: 500, fontSize: 14.5, flex: "1 1 200px" }}>{line.label}</span>
        <span className="lx-num" style={{ whiteSpace: "nowrap" }}>
          {line.quantity > 1 ? `${line.quantity} × ${formatCents(line.unit_amount_cents, props.currency)} = ` : ""}
          {formatCents(line.quantity * line.unit_amount_cents, props.currency)}
        </span>
      </div>
      {line.description && (
        <p className="lx-note" style={{ margin: 0 }}>
          {line.description}
        </p>
      )}
      {editable && (
        <div className="lx-row-actions">
          <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </button>
          <SmallAction action={moveLineAction} hidden={{ ...hidden, direction: "up" }} label="↑" ariaLabel="Move line up" disabled={!props.canMoveUp} onError={setSmallError} />
          <SmallAction action={moveLineAction} hidden={{ ...hidden, direction: "down" }} label="↓" ariaLabel="Move line down" disabled={!props.canMoveDown} onError={setSmallError} />
          <SmallAction action={deleteLineAction} hidden={hidden} label="Remove" danger onError={setSmallError} />
        </div>
      )}
      <Err state={smallError} />
      {editable && editing && (
        <form action={action} className="lx-form-grid" style={{ paddingTop: 10, borderTop: "1px solid var(--line-2)" }}>
          <Hidden values={hidden} />
          <LineFields line={line} />
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
            <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
              {pending ? "Saving…" : "Save line"}
            </button>
            <Err state={state} />
          </div>
        </form>
      )}
    </li>
  );
}

/* ── engagement terms ───────────────────────────────────────────────────── */

/**
 * `crm_quote.terms_body` IS the engagement letter: the client page renders it
 * inside the same document as the priced lines under one typed signature, and
 * it is frozen verbatim into `accepted_snapshot`. So this is not a notes field.
 *
 * "Generate from this quote's figures" writes a draft from the quote's OWN
 * lines (`buildEngagementTerms`, pure and AI-free — no model writes a fee term)
 * and the attorney then edits it here. The two steps are separate on purpose:
 * a generator whose output went to a client without an attorney reading it
 * would be this product drafting a legal document, which is the line the UPL
 * firewall draws.
 *
 * Editing terms on a SENT quote is allowed, and the guarantee is on the accept
 * path, not in the warning: the terms are inside the agreement fingerprint, so
 * a signature made from the copy the client already had open is refused and
 * they are asked to re-read.
 */
export function TermsEditor(props: { quoteId: string; termsBody: string | null; isLive: boolean; defaultClientName: string }) {
  const [saveState, saveAction, saving] = useActionState<ActionState, FormData>(saveTermsAction, {});
  const [genState, genAction, generating] = useActionState<ActionState, FormData>(generateTermsAction, {});

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {props.isLive && (
        <p className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
          This proposal is already with the client. Changing the terms refuses any signature made from the copy they
          have open — they will be asked to re-read the new wording before signing.
        </p>
      )}

      <details className="lx-disclosure-inline">
        <summary>Generate from this quote&rsquo;s figures</summary>
        <p className="lx-note" style={{ margin: "0 0 10px" }}>
          Every amount comes from this quote&rsquo;s own lines — nothing is invented and no AI is involved. It
          replaces whatever is in the box below, so read it before sending.
        </p>
        <form action={genAction} className="lx-form-grid">
          <Hidden values={{ quoteId: props.quoteId }} />
          <label className="lx-field">
            <span className="lx-label">Client name</span>
            <input className="lx-input" name="clientName" required maxLength={200} defaultValue={props.defaultClientName} />
          </label>
          <label className="lx-field">
            <span className="lx-label">Signing entity (optional)</span>
            <input className="lx-input" name="entityName" maxLength={200} placeholder="e.g. Acme Holdings LLC" />
          </label>
          <label className="lx-field">
            <span className="lx-label">Mark (optional)</span>
            <input className="lx-input" name="markText" maxLength={200} placeholder="e.g. ACME" />
          </label>
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
            <button type="submit" className="lx-btn lx-btn-sec" disabled={generating}>
              {generating ? "Generating…" : "Generate draft"}
            </button>
            <Err state={genState} />
          </div>
        </form>
      </details>

      <form action={saveAction} style={{ display: "grid", gap: 10 }}>
        <Hidden values={{ quoteId: props.quoteId }} />
        {/* Keyed on the stored value so a regenerate re-mounts the box with the
            new draft; otherwise the uncontrolled textarea keeps its old text and
            a save would write it back over the draft that was asked for. */}
        <textarea
          key={props.termsBody ?? ""}
          className="lx-input lx-draft"
          name="termsBody"
          rows={14}
          defaultValue={props.termsBody ?? ""}
          placeholder="The engagement terms the client signs. Generate a draft above, or write them here."
          style={{ fontFamily: "var(--mono)", fontSize: 14 }}
        />
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button type="submit" className="lx-btn lx-btn-pri" disabled={saving}>
            {saving ? "Saving…" : "Save terms"}
          </button>
          {saveState.saved && !saving && !saveState.error && (
            <span className="lx-note" style={{ color: "var(--ok)" }}>
              Saved.
            </span>
          )}
          <span className="lx-note">Saved exactly as typed — the client reads this text and signs it.</span>
        </div>
        <Err state={saveState} />
      </form>
    </div>
  );
}
