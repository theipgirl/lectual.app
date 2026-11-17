"use client";

import { useActionState } from "react";
import { reconcilePaymentAction, recordPaymentAction } from "@/app/dashboard/quotes/[id]/actions";
import type { ActionState } from "@/app/dashboard/quotes/errors";
import { moneyFor } from "@/lib/quotes/staff-money";
import { Notice } from "@/components/ui/Notice";
import { Pill, type PillTone } from "@/components/ui/Pill";
import { SavedNote } from "@/components/ui/SavedNote";
import { SAVING, OPTIONAL } from "@/lib/ui/words";

export type PanelPayment = {
  id: string;
  when: string;
  amountCents: number;
  currency: string;
  purposeLabel: string;
  provider: "lawpay" | "manual";
  status: string;
  accountKind: "operating" | "trust";
  accountHint: string | null;
  failureReason: string | null;
};

export type PanelSummary = { tone: "ok" | "warn" | "risk" | "mute"; text: string };

/**
 * The builder's payments panel: the signing payment's status, every payment on
 * this quote with its account kind (operating / trust — always shown), a
 * "Record a payment" form whose account kind and purpose have NO default, and,
 * for an admin, a way to resolve a LawPay attempt that is waiting to be checked.
 */
export function PaymentsPanel(props: {
  quoteId: string;
  currency: string;
  summary: PanelSummary;
  payments: PanelPayment[] | null;
  canRecord: boolean;
  canReconcile: boolean;
  cardNote: string;
}) {
  return (
    <section className="lx-card lx-pad qb-panel" aria-labelledby="qb-payments">
      <div className="qb-panel-head qb-panel-head-center">
        <h2 id="qb-payments" className="lx-h3 qb-grow">
          Payments
        </h2>
        <Pill tone={props.summary.tone}>{props.summary.text}</Pill>
      </div>
      <p className="lx-note">{props.cardNote}</p>

      {props.payments === null ? (
        <Notice tone="risk" role="alert">
          Can&apos;t show this quote&apos;s payments right now. Refresh to try again. That doesn&apos;t mean nothing was paid.
        </Notice>
      ) : props.payments.length === 0 ? (
        <div className="lx-empty">No payments recorded on this quote.</div>
      ) : (
        <div className="qb-pay-list">
          {props.payments.map((p) => (
            <div key={p.id} className="qb-pay-row">
              <span className="lx-num qb-pay-amount">
                {moneyFor(p.amountCents, p.currency)}
              </span>
              <span className="qb-pay-what">
                {p.purposeLabel} · {p.provider === "lawpay" ? "LawPay card" : "recorded by hand"}
                <span className="lx-note qb-pay-sub">
                  {p.when} · into <b>{p.accountKind === "trust" ? "trust (IOLTA)" : "operating"}</b>
                  {p.accountHint ? ` ···${p.accountHint}` : ""}
                  {p.failureReason ? ` · ${p.failureReason}` : ""}
                </span>
              </span>
              <Pill tone={statusTone(p.status)}>{statusLabel(p)}</Pill>
              {props.canReconcile && p.provider === "lawpay" && p.status === "pending" && <ReconcileForm quoteId={props.quoteId} paymentId={p.id} />}
            </div>
          ))}
        </div>
      )}

      {props.canRecord && (
        <details className="lx-disclosure-inline">
          <summary>Record a payment</summary>
          <RecordForm quoteId={props.quoteId} currency={props.currency} />
        </details>
      )}
    </section>
  );
}

function statusTone(status: string): PillTone {
  return status === "succeeded" ? "ok" : status === "pending" ? "warn" : status === "failed" ? "risk" : "mute";
}

function statusLabel(p: PanelPayment): string {
  if (p.status === "succeeded") return p.provider === "lawpay" ? "Authorised" : "Received";
  if (p.status === "pending") return "Check in LawPay";
  if (p.status === "failed") return p.provider === "lawpay" ? "Not charged" : "Failed";
  return p.status;
}

function RecordForm({ quoteId, currency }: { quoteId: string; currency: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(recordPaymentAction, {});
  return (
    <form action={action} className="qb-record-form">
      <input type="hidden" name="quoteId" value={quoteId} />
      <p className="lx-note">
        For money that reached the firm outside Lectual — a check, a wire, or a charge run in LawPay itself. Nothing is charged.
      </p>
      <div className="qb-record-pair">
        <label className="lx-field">
          <span className="lx-label">Amount ({currency})</span>
          <input name="amount" className="lx-input" inputMode="decimal" placeholder="0.00" required />
        </label>
        <label className="lx-field">
          <span className="lx-label">Date received</span>
          <input name="occurredOn" type="date" className="lx-input" />
        </label>
      </div>
      <label className="lx-field">
        <span className="lx-label">What it was for</span>
        <select name="purpose" className="lx-input" defaultValue="" required>
          <option value="" disabled>
            Choose…
          </option>
          <option value="legal_fee">Legal fee (earned)</option>
          <option value="government_fee">USPTO / government fee</option>
          <option value="expense">Expense</option>
          <option value="other">Advance or retainer / other</option>
        </select>
      </label>
      <fieldset className="qb-fieldset">
        <legend className="lx-label">Which account it went into</legend>
        {/* No default: the account kind is always chosen, never inferred. */}
        <label className="qb-radio">
          <input type="radio" name="accountKind" value="operating" required /> Operating
        </label>
        <label className="qb-radio">
          <input type="radio" name="accountKind" value="trust" /> Trust (IOLTA)
        </label>
      </fieldset>
      <label className="lx-field">
        <span className="lx-label">Note<span className="lx-optional"> {OPTIONAL}</span></span>
        <input name="note" className="lx-input" maxLength={300} placeholder="e.g. check #1042" />
      </label>
      <div className="qb-record-actions">
        <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
          {pending ? SAVING : "Record payment"}
        </button>
        {state.error && (
          <Notice tone="risk" role="alert">
            {state.error}
          </Notice>
        )}
        <SavedNote show={!!state.saved}>Recorded.</SavedNote>
      </div>
    </form>
  );
}

function ReconcileForm({ quoteId, paymentId }: { quoteId: string; paymentId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reconcilePaymentAction, {});
  return (
    <form action={action} className="qb-reconcile">
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <button type="submit" name="outcome" value="succeeded" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
        LawPay shows it charged
      </button>
      <button type="submit" name="outcome" value="failed" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={pending}>
        Not charged
      </button>
      {state.error && (
        <Notice tone="risk" role="alert">
          {state.error}
        </Notice>
      )}
    </form>
  );
}
