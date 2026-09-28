"use client";

import { useActionState } from "react";
import { reconcilePaymentAction, recordPaymentAction } from "@/app/dashboard/quotes/[id]/actions";
import type { ActionState } from "@/app/dashboard/quotes/errors";
import { formatCents } from "@/lib/quotes/money";

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
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }} aria-labelledby="qb-payments">
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h2 id="qb-payments" className="lx-h2" style={{ fontSize: 23, flex: 1, minWidth: 180 }}>
          Payments
        </h2>
        <span className={`lx-pill lx-pill-${props.summary.tone}`}>{props.summary.text}</span>
      </div>
      <p className="lx-note" style={{ margin: 0 }}>
        {props.cardNote}
      </p>

      {props.payments === null ? (
        <div role="alert" className="lx-banner lx-banner-risk">
          We couldn&apos;t load this quote&apos;s payments. That&apos;s a problem reaching the database — it doesn&apos;t mean nothing was paid.
        </div>
      ) : props.payments.length === 0 ? (
        <div className="lx-empty">No payments recorded on this quote.</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {props.payments.map((p) => (
            <div key={p.id} style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap", borderTop: "1px solid var(--line)", paddingTop: 8 }}>
              <span className="lx-num" style={{ minWidth: 96 }}>
                {formatCents(p.amountCents, p.currency)}
              </span>
              <span style={{ flex: 1, minWidth: 200 }}>
                {p.purposeLabel} · {p.provider === "lawpay" ? "LawPay card" : "recorded by hand"}
                <span className="lx-note" style={{ display: "block" }}>
                  {p.when} · into <b>{p.accountKind === "trust" ? "trust (IOLTA)" : "operating"}</b>
                  {p.accountHint ? ` ···${p.accountHint}` : ""}
                  {p.failureReason ? ` · ${p.failureReason}` : ""}
                </span>
              </span>
              <span className={`lx-pill ${statusTone(p.status)}`}>{statusLabel(p)}</span>
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

function statusTone(status: string): string {
  return status === "succeeded" ? "lx-pill-ok" : status === "pending" ? "lx-pill-warn" : status === "failed" ? "lx-pill-risk" : "lx-pill-mute";
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
    <form action={action} style={{ display: "grid", gap: 10, marginTop: 10, maxWidth: 520 }}>
      <input type="hidden" name="quoteId" value={quoteId} />
      <p className="lx-note" style={{ margin: 0 }}>
        For money that reached the firm outside Lectual — a check, a wire, or a charge run in LawPay itself. Nothing is charged.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <label className="lx-field" style={{ display: "grid", gap: 4 }}>
          <span className="lx-label">Amount ({currency})</span>
          <input name="amount" className="lx-input" inputMode="decimal" placeholder="0.00" required />
        </label>
        <label className="lx-field" style={{ display: "grid", gap: 4 }}>
          <span className="lx-label">Date received</span>
          <input name="occurredOn" type="date" className="lx-input" />
        </label>
      </div>
      <label className="lx-field" style={{ display: "grid", gap: 4 }}>
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
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 6 }}>
        <legend className="lx-label">Which account it went into</legend>
        {/* No default: the account kind is always chosen, never inferred. */}
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="radio" name="accountKind" value="operating" required /> Operating
        </label>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="radio" name="accountKind" value="trust" /> Trust (IOLTA)
        </label>
      </fieldset>
      <label className="lx-field" style={{ display: "grid", gap: 4 }}>
        <span className="lx-label">Note (optional)</span>
        <input name="note" className="lx-input" maxLength={300} placeholder="e.g. check #1042" />
      </label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
          {pending ? "Recording…" : "Record payment"}
        </button>
        {state.error && (
          <span role="alert" className="lx-note" style={{ color: "var(--wine)" }}>
            {state.error}
          </span>
        )}
        {state.saved && (
          <span role="status" className="lx-note">
            Recorded.
          </span>
        )}
      </div>
    </form>
  );
}

function ReconcileForm({ quoteId, paymentId }: { quoteId: string; paymentId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reconcilePaymentAction, {});
  return (
    <form action={action} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="paymentId" value={paymentId} />
      <button type="submit" name="outcome" value="succeeded" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
        LawPay shows it charged
      </button>
      <button type="submit" name="outcome" value="failed" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={pending}>
        Not charged
      </button>
      {state.error && (
        <span role="alert" className="lx-note" style={{ color: "var(--wine)" }}>
          {state.error}
        </span>
      )}
    </form>
  );
}
