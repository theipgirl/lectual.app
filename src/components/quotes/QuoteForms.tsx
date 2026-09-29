"use client";

import { useActionState } from "react";
import { createQuoteAction } from "@/app/dashboard/quotes/actions";
import { generateTermsAction, saveTermsAction, updateDetailsAction } from "@/app/dashboard/quotes/[id]/actions";
import type { ActionState } from "@/app/dashboard/quotes/errors";

/**
 * The quote pages' client forms: New quote, the header details and the
 * engagement terms. The builder itself is QuoteBuilder.tsx. Every one posts to
 * a server action that re-checks the attorney+ gate and the store's role gate
 * on its own — nothing here is the boundary, it only renders the controls.
 */

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
export function TermsEditor(props: { quoteId: string; termsBody: string | null; isLive: boolean; defaultClientName: string; defaultMark?: string | null }) {
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
            <input className="lx-input" name="markText" maxLength={200} placeholder="e.g. ACME" defaultValue={props.defaultMark ?? ""} />
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
