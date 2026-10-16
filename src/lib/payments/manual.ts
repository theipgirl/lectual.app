import { parseDollarsToCents } from "@/lib/quotes/money";
import { isPaymentAccountKind, isPaymentPurpose, type PaymentAccountKind, type PaymentPurpose } from "./types";

/**
 * Pure rules for the quote builder's payments panel: validating a manual
 * ("Record a payment") entry and summarising a quote's payments for the firm.
 * The IO lives in quote-payments.ts.
 */

export type ManualPaymentInput = {
  amount: unknown;
  accountKind: unknown;
  purpose: unknown;
  occurredOn?: unknown;
  note?: unknown;
};

export type ManualPayment = {
  amountCents: number;
  accountKind: PaymentAccountKind;
  purpose: PaymentPurpose;
  occurredAt: string | null;
  note: string | null;
};

export type ManualCheck = { ok: true; payment: ManualPayment } | { ok: false; reason: string };

/**
 * The account kind is REQUIRED and explicit — no default, no inference from the
 * purpose. An earned legal fee recorded into trust is refused with a pointer:
 * an advance held in trust is a different purpose ("other"), and writing an
 * earned fee down as trust money would put a commingling claim on the record.
 */
export function checkManualPayment(input: ManualPaymentInput, now = new Date()): ManualCheck {
  const amountCents = typeof input.amount === "string" ? parseDollarsToCents(input.amount) : null;
  if (amountCents === null || !Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return { ok: false, reason: "Enter the amount received, in dollars." };
  }
  if (amountCents > 100_000_000_00) return { ok: false, reason: "That amount is too large to record here." };
  if (!isPaymentAccountKind(input.accountKind)) {
    return { ok: false, reason: "Choose which account the money went into: operating or trust." };
  }
  if (!isPaymentPurpose(input.purpose)) return { ok: false, reason: "Choose what the payment was for." };
  if (input.purpose === "legal_fee" && input.accountKind === "trust") {
    return {
      ok: false,
      reason: "An earned legal fee belongs in the operating account. If this was an advance held in trust, record it as “Advance or retainer”.",
    };
  }
  let occurredAt: string | null = null;
  if (typeof input.occurredOn === "string" && input.occurredOn.trim()) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.occurredOn.trim());
    const date = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`) : null;
    if (!date || Number.isNaN(date.getTime())) return { ok: false, reason: "Enter the date as YYYY-MM-DD." };
    if (date.getTime() > now.getTime() + 36 * 3600 * 1000) return { ok: false, reason: "The payment date can't be in the future." };
    occurredAt = date.toISOString();
  }
  const note = typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 300) : null;
  return { ok: true, payment: { amountCents, accountKind: input.accountKind, purpose: input.purpose, occurredAt, note } };
}

export const PURPOSE_LABEL: Record<PaymentPurpose, string> = {
  legal_fee: "Legal fee (earned)",
  government_fee: "USPTO / government fee",
  expense: "Expense",
  other: "Advance or retainer / other",
};

export type FirmPaymentRow = {
  purpose: string;
  provider: string;
  status: string;
  amount_cents: number;
};

export type FirmPaymentSummary =
  | { status: "nothing_due" }
  | { status: "unpaid"; dueCents: number }
  | { status: "part_paid"; receivedCents: number; dueCents: number }
  | { status: "paid"; receivedCents: number; via: "card" | "recorded" }
  | { status: "needs_reconciling"; pendingCount: number }
  | { status: "not_signed" };

/** The firm's one-line view of the signing payment. `dueCents` from the signed snapshot, or null before signing. */
export function firmPaymentSummary(rows: readonly FirmPaymentRow[], dueCents: number | null): FirmPaymentSummary {
  const signing = rows.filter((r) => r.purpose === "legal_fee");
  const pending = signing.filter((r) => r.status === "pending" && r.provider === "lawpay");
  if (pending.length > 0) return { status: "needs_reconciling", pendingCount: pending.length };
  if (dueCents === null) return { status: "not_signed" };
  const settled = signing.filter((r) => r.status === "succeeded");
  const receivedCents = settled.reduce((s, r) => s + (Number.isSafeInteger(r.amount_cents) ? r.amount_cents : 0), 0);
  if (dueCents === 0) return settled.length ? { status: "paid", receivedCents, via: settled.some((r) => r.provider === "lawpay") ? "card" : "recorded" } : { status: "nothing_due" };
  if (settled.length === 0) return { status: "unpaid", dueCents };
  if (receivedCents < dueCents) return { status: "part_paid", receivedCents, dueCents };
  return { status: "paid", receivedCents, via: settled.some((r) => r.provider === "lawpay") ? "card" : "recorded" };
}
