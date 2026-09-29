import type { ChargeableAmountResult } from "./types";

/**
 * What the client is told about paying — the pure state machine behind the
 * receipt's Pay section. No IO: the caller reads, this decides.
 *
 * FIVE STATES, and a failed read is never "unpaid":
 *   received    money is recorded against the signing amount. `via` says HOW:
 *               `card` only when a LawPay charge on this page succeeded, and
 *               `recorded` for money the firm entered itself (check, wire).
 *               `outstandingCents` > 0 is a PART payment — named, never shown as
 *               settled (runbook defect 2: a partial manual payment used to mark
 *               the whole quote received and a manual one read as "on your
 *               card").
 *   confirming  a LawPay attempt is pending: it may or may not have taken money.
 *               No form — a second press could be a second charge.
 *   payable     everything is configured and nothing is recorded. The only
 *               state with a card form.
 *   manual      the firm takes this payment elsewhere (no connection, no mapped
 *               operating account, a rejected firm credential, a quote this
 *               build won't charge, too many failed card attempts), or
 *               `nothingDue`: everything is due at filing.
 *   unavailable the payment record (or the firm's setup) could not be read.
 */
export type PublicPaymentState =
  | { status: "received"; via: "card" | "recorded"; receivedCents: number; currency: string; outstandingCents: number | null }
  | { status: "confirming" }
  | { status: "payable"; amountCents: number; currency: string; publicKey: string }
  | { status: "manual"; nothingDue: boolean }
  | { status: "unavailable" };

export type PaymentRowLike = {
  purpose?: unknown;
  provider?: unknown;
  status?: unknown;
  amount_cents?: unknown;
  currency?: unknown;
};

export type PaymentsRead = { status: "ok"; rows: readonly PaymentRowLike[] } | { status: "unavailable" };

export type CardSetup = { status: "ok"; publicKey: string } | { status: "unconfigured" } | { status: "unavailable" };

function signingRows(rows: readonly PaymentRowLike[]): PaymentRowLike[] {
  return rows.filter((r) => r.purpose === "legal_fee");
}

function cents(row: PaymentRowLike): number {
  const n = Number(row.amount_cents);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

/** Any succeeded signing-bucket row, whoever recorded it. Blocks a charge. */
export function hasSettledSigningPayment(rows: readonly PaymentRowLike[]): boolean {
  return signingRows(rows).some((r) => r.status === "succeeded");
}

/**
 * How many failed LawPay attempts a quote may collect before the card form is
 * withdrawn. The proposal link is unauthenticated and has no rate limiter, so
 * without a cap it is a card-testing endpoint on the firm's own merchant
 * account (every decline costs the firm and risks the account). Five covers a
 * client who mistypes and then tries another card.
 */
export const MAX_FAILED_CARD_ATTEMPTS = 5;

/** Failed LawPay signing attempts on this quote (declines and refusals alike). */
export function failedCardAttempts(rows: readonly PaymentRowLike[]): number {
  return signingRows(rows).filter((r) => r.status === "failed" && r.provider === "lawpay").length;
}

/** A LawPay attempt whose outcome was never established. */
export function hasUnresolvedAttempt(rows: readonly PaymentRowLike[]): boolean {
  return signingRows(rows).some((r) => r.status === "pending" && r.provider === "lawpay");
}

/**
 * Phase one: what the payment ROWS already settle, before any question about
 * the firm's card setup is asked. Returns null when nothing is settled or in
 * flight and the card question is next.
 */
export function settledPaymentState(payments: PaymentsRead, charge: ChargeableAmountResult | null): PublicPaymentState | null {
  if (payments.status !== "ok") return { status: "unavailable" };
  const settled = signingRows(payments.rows).filter((r) => r.status === "succeeded");
  if (settled.length > 0) {
    const receivedCents = settled.reduce((sum, r) => sum + cents(r), 0);
    const currencies = new Set(settled.map((r) => (typeof r.currency === "string" ? r.currency : "")).filter(Boolean));
    const currency = currencies.size === 1 ? [...currencies][0]! : null;
    let outstandingCents: number | null = null;
    if (charge?.ok && currency === charge.amount.currency) {
      outstandingCents = Math.max(0, charge.amount.amountCents - receivedCents);
    } else if (charge && !charge.ok && charge.reason === "nothing_due_at_signing") {
      outstandingCents = 0;
    }
    return {
      status: "received",
      via: settled.some((r) => r.provider === "lawpay") ? "card" : "recorded",
      receivedCents,
      currency: currency ?? (charge?.ok ? charge.amount.currency : "USD"),
      outstandingCents,
    };
  }
  if (hasUnresolvedAttempt(payments.rows)) return { status: "confirming" };
  if (!charge) return { status: "manual", nothingDue: false };
  if (!charge.ok) return { status: "manual", nothingDue: charge.reason === "nothing_due_at_signing" };
  // Too many failed card attempts: the firm takes it from here, no more forms.
  if (failedCardAttempts(payments.rows) >= MAX_FAILED_CARD_ATTEMPTS) return { status: "manual", nothingDue: false };
  return null;
}

/** Phase two: the card form, only when the firm's own setup can actually charge. */
export function cardPaymentState(charge: ChargeableAmountResult, card: CardSetup): PublicPaymentState {
  if (!charge.ok) return { status: "manual", nothingDue: charge.reason === "nothing_due_at_signing" };
  if (card.status === "unavailable") return { status: "unavailable" };
  if (card.status === "unconfigured") return { status: "manual", nothingDue: false };
  return { status: "payable", amountCents: charge.amount.amountCents, currency: charge.amount.currency, publicKey: card.publicKey };
}
