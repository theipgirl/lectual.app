"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HOSTED_FIELDS_SCRIPT_URL, HOSTED_FIELD_IDS, HOSTED_FIELD_TYPES, type HostedFieldsGlobal } from "@/lib/payments/hosted-fields";
import { payMessage, retryPolicy } from "@/lib/payments/pay-messages";
// Types only — the module is pure, but the state is computed on the server.
import type { PublicPaymentState } from "@/lib/payments/payment-state";
import { formatCents } from "@/lib/quotes/money";
import { payQuoteAction } from "@/app/q/[token]/actions";

/**
 * The receipt's Pay section (spec §7.4) — the browser half of per-firm LawPay.
 * Ported from lectual's PayPanel.tsx (branch claude/lectual-firm-dashboard-prd-
 * f3loev) into this app's proposal styles.
 *
 * ── NO CARD DATA TOUCHES THIS PAGE OR THIS SERVER ───────────────────────────
 * Card number and CVV are typed into IFRAMES served by AffiniPay (Hosted
 * Fields), initialised with the FIRM's own operating account's public key.
 * `getPaymentToken` returns an opaque single-use token, and that token is all
 * `payQuoteAction` receives. Expiry and postal code are ordinary inputs passed
 * to AffiniPay's tokeniser, never to our server.
 *
 * ── IT NEVER SAYS "PAID" ON ITS OWN SAY-SO ──────────────────────────────────
 * Success calls `router.refresh()`; the server re-reads crm_payment and renders
 * the received state from the stored row.
 *
 * ── IT NEVER RETRIES INTO A BUTTON THAT CANNOT WORK ─────────────────────────
 * `retryPolicy` decides: a decline brings the form back; an indeterminate
 * answer removes it (no idempotency key — a retry could charge twice); a
 * firm-side refusal removes it too (the server also pauses the firm's card
 * payments, so a reload shows the calm manual state, not a live form).
 */
export function PayPanel({ token, state, firmName }: { token: string; state: PublicPaymentState; firmName: string }) {
  switch (state.status) {
    case "received": {
      const partial = state.outstandingCents !== null && state.outstandingCents > 0;
      if (partial) {
        return (
          <Panel tone="warn" heading="Part of the amount due today has been received">
            <p className="qp-pay-body">
              {firmName} has recorded <strong>{formatCents(state.receivedCents, state.currency)}</strong>
              {state.via === "card" ? " on your card" : ""}. That leaves{" "}
              <strong>{formatCents(state.outstandingCents ?? 0, state.currency)}</strong> outstanding — {firmName} will be in touch about the
              balance. Nothing further is charged on this page. USPTO filing fees are charged separately, at filing.
            </p>
          </Panel>
        );
      }
      return (
        <Panel tone="good" heading={state.via === "card" ? "Payment authorised" : "Payment received"}>
          <p className="qp-pay-body">
            {state.via === "card" ? (
              // "Authorised", not "paid": LawPay settles in its daily capture run.
              <>
                <strong>{formatCents(state.receivedCents, state.currency)}</strong> was authorised on your card and is being processed. {firmName}{" "}
                will confirm it on your file.
              </>
            ) : (
              // NOT "on your card": the firm recorded this itself (cheque, transfer).
              <>
                <strong>{formatCents(state.receivedCents, state.currency)}</strong> has been recorded against this proposal by {firmName}. Nothing was
                charged on this page.
              </>
            )}{" "}
            {state.outstandingCents === null
              ? `${firmName} will confirm whether this covers the amount due today.`
              : "USPTO filing fees on your proposal are charged separately, at filing."}
          </p>
        </Panel>
      );
    }
    case "confirming":
      return (
        <Panel tone="warn" heading="We're confirming your payment">
          <p className="qp-pay-body">
            Your signature is recorded. A card payment was started and hasn&rsquo;t been confirmed yet, so {firmName} is checking it.{" "}
            <strong>Please don&rsquo;t try to pay again</strong> — if nothing was taken, {firmName} will be in touch.
          </p>
        </Panel>
      );
    case "unavailable":
      return (
        <Panel tone="quiet" heading="Payment details couldn't be loaded">
          <p className="qp-pay-body">
            Your signature is recorded and is safe. We couldn&rsquo;t load the payment details just now — reload this page in a moment, or
            contact {firmName}. Nothing has been charged.
          </p>
        </Panel>
      );
    case "manual":
      return state.nothingDue ? (
        <Panel tone="quiet" heading="Nothing to pay today">
          <p className="qp-pay-body">
            Your signature is recorded and nothing is due at signing. USPTO filing fees are charged when {firmName} files. Nothing has been
            charged on this page.
          </p>
        </Panel>
      ) : (
        <Panel tone="quiet" heading="Paying for this work">
          <p className="qp-pay-body">
            {firmName} will send you a way to pay the amount due today. Nothing has been charged on this page.
          </p>
        </Panel>
      );
    case "payable":
      return <PayForm token={token} state={state} firmName={firmName} />;
  }
}

type FieldsStatus = "loading" | "ready" | "script_failed";

function PayForm({ token, state, firmName }: { token: string; state: Extract<PublicPaymentState, { status: "payable" }>; firmName: string }) {
  const router = useRouter();
  const [fields, setFields] = useState<FieldsStatus>("loading");
  const [submitting, setSubmitting] = useState(false);
  /** Set once and never cleared for any outcome that might have moved money. */
  const [closed, setClosed] = useState<null | "done" | "indeterminate" | "no_retry">(null);
  const [error, setError] = useState<string | null>(null);
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const hostedRef = useRef<{ getPaymentToken?: (formData: Record<string, string>) => Promise<{ id?: string }> } | null>(null);
  const initialisedRef = useRef(false);

  useEffect(() => {
    // No documented teardown, so initialise exactly once per mount.
    if (initialisedRef.current) return;
    initialisedRef.current = true;
    let cancelled = false;

    function initialise() {
      const affinipay = (window as unknown as { AffiniPay?: HostedFieldsGlobal }).AffiniPay;
      const init = affinipay?.HostedFields?.initializeFields;
      if (typeof init !== "function") {
        if (!cancelled) setFields("script_failed");
        return;
      }
      try {
        const handle = init(
          {
            publicKey: state.publicKey,
            fields: [
              { selector: `#${HOSTED_FIELD_IDS.cardNumber}`, input: { type: HOSTED_FIELD_TYPES.cardNumber, placeholder: "Card number" } },
              { selector: `#${HOSTED_FIELD_IDS.cvv}`, input: { type: HOSTED_FIELD_TYPES.cvv, placeholder: "CVV" } },
            ],
          },
          (fieldState) => {
            if (!cancelled && fieldState?.isReady) setFields("ready");
          },
        );
        hostedRef.current = handle ?? null;
      } catch {
        if (!cancelled) setFields("script_failed");
      }
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${HOSTED_FIELDS_SCRIPT_URL}"]`);
    if (existing) {
      initialise();
    } else {
      const script = document.createElement("script");
      script.src = HOSTED_FIELDS_SCRIPT_URL; // pinned version — see hosted-fields.ts
      script.async = true;
      script.onload = () => {
        if (!cancelled) initialise();
      };
      script.onerror = () => {
        if (!cancelled) setFields("script_failed");
      };
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
    };
  }, [state.publicKey]);

  const pay = useCallback(async () => {
    if (submitting || closed) return;
    setError(null);
    const tokeniser = hostedRef.current?.getPaymentToken;
    if (typeof tokeniser !== "function") {
      setError("The card form isn't ready yet. Give it a moment and try again.");
      return;
    }
    setSubmitting(true);
    let methodToken = "";
    try {
      const result = await tokeniser({ exp_month: expMonth.trim(), exp_year: expYear.trim(), postal_code: postalCode.trim() });
      methodToken = typeof result?.id === "string" ? result.id : "";
    } catch {
      methodToken = "";
    }
    if (!methodToken) {
      // No token was produced, so nothing was charged.
      setSubmitting(false);
      setError("We couldn't read those card details. Check the number, expiry, CVV and postal code, then try again. Nothing has been charged.");
      return;
    }

    const outcome = await payQuoteAction({ token, methodToken });
    if (outcome.ok) {
      setClosed("done");
      router.refresh();
      return;
    }
    const policy = retryPolicy(outcome.reason);
    if (policy === "refresh") {
      setClosed("done");
      router.refresh();
      return;
    }
    if (policy === "close_indeterminate") {
      setClosed("indeterminate");
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    setError(payMessage(outcome.reason, outcome.message, firmName));
    if (policy === "close_no_retry") setClosed("no_retry");
  }, [closed, expMonth, expYear, firmName, postalCode, router, submitting, token]);

  if (closed === "indeterminate") {
    return (
      <Panel tone="warn" heading="We're confirming your payment">
        <p className="qp-pay-body">
          Your signature is recorded. We didn&rsquo;t get a clear answer from the payment provider, so {firmName} is checking whether the payment
          went through. <strong>Please don&rsquo;t try again</strong> — they&rsquo;ll be in touch either way.
        </p>
      </Panel>
    );
  }
  if (closed === "no_retry") {
    return (
      <Panel tone="warn" heading="We couldn't take that payment">
        <p className="qp-pay-body">{error}</p>
      </Panel>
    );
  }
  if (fields === "script_failed") {
    return (
      <Panel tone="quiet" heading="Paying for this work">
        <p className="qp-pay-body">
          The secure card form couldn&rsquo;t load in this browser. Your signature is recorded — {firmName} will send you a way to pay. Nothing has
          been charged on this page.
        </p>
      </Panel>
    );
  }

  const disabledReason = closed
    ? "Submitting…"
    : submitting
      ? "Taking payment…"
      : fields !== "ready"
        ? "Loading the secure card form…"
        : !expMonth.trim() || !expYear.trim()
          ? "Enter the card's expiry date."
          : !postalCode.trim()
            ? "Enter the billing postal code."
            : null;

  return (
    <Panel tone="accent" heading="Pay the amount due today">
      <p className="qp-pay-body">
        <strong>{formatCents(state.amountCents, state.currency)}</strong> is due today under the agreement you signed, paid to {firmName}&rsquo;s
        operating account. Nothing is charged until you pay below. USPTO filing fees are not part of this — {firmName} collects them at filing.
      </p>
      <div className="qp-pay-fields">
        <label className="qp-pay-label">
          <span>Card number</span>
          {/* Replaced by an AffiniPay iframe. Empty on purpose. */}
          <div id={HOSTED_FIELD_IDS.cardNumber} className="qp-pay-hosted" />
        </label>
        <div className="qp-pay-row">
          <label className="qp-pay-label">
            <span>Exp. month</span>
            <input className="qp-pay-input" inputMode="numeric" autoComplete="cc-exp-month" placeholder="MM" maxLength={2} value={expMonth} onChange={(e) => setExpMonth(e.target.value)} disabled={submitting || closed !== null} />
          </label>
          <label className="qp-pay-label">
            <span>Exp. year</span>
            <input className="qp-pay-input" inputMode="numeric" autoComplete="cc-exp-year" placeholder="YYYY" maxLength={4} value={expYear} onChange={(e) => setExpYear(e.target.value)} disabled={submitting || closed !== null} />
          </label>
          <label className="qp-pay-label">
            <span>CVV</span>
            <div id={HOSTED_FIELD_IDS.cvv} className="qp-pay-hosted" />
          </label>
        </div>
        <label className="qp-pay-label">
          <span>Billing postal code</span>
          <input className="qp-pay-input" autoComplete="postal-code" maxLength={16} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} disabled={submitting || closed !== null} />
        </label>
      </div>
      <button type="button" className="qp-accept" data-ready={disabledReason === null} onClick={pay} disabled={disabledReason !== null} aria-describedby="qp-pay-reason">
        {submitting ? "Taking payment…" : `Pay ${formatCents(state.amountCents, state.currency)}`}
      </button>
      <p id="qp-pay-reason" role="status" className="qp-hint">
        {disabledReason ?? ""}
      </p>
      {error && (
        <p role="alert" className="qp-pay-error">
          {error}
        </p>
      )}
      <p className="qp-small">Card details go directly to {firmName}&rsquo;s payment provider (LawPay) and are never sent to or stored by this page.</p>
    </Panel>
  );
}

function Panel({ tone, heading, children }: { tone: "good" | "warn" | "quiet" | "accent"; heading: string; children: React.ReactNode }) {
  return (
    <section className="qp-pay" data-tone={tone} aria-label={heading}>
      <div className="qp-kicker">Payment</div>
      <h2 className="qp-pay-title">{heading}</h2>
      {children}
    </section>
  );
}
