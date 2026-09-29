import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import { formatCents } from "@/lib/quotes/money";
import { PURPOSE_LABEL, checkManualPayment, type ManualPaymentInput } from "./manual";
import type { PaymentAccountKind, PaymentPurpose, PaymentStatus } from "./types";

/**
 * The quote builder's payments panel: reading a quote's payments and recording
 * one by hand, through the caller's own scoped client (RLS: crm_payment insert
 * is staff tier, update is admin tier, and there is no delete at all — a
 * payment is financial history).
 */

export type QuotePayment = {
  id: string;
  purpose: PaymentPurpose;
  provider: "lawpay" | "manual";
  status: PaymentStatus;
  amount_cents: number;
  currency: string;
  account_kind: PaymentAccountKind;
  provider_account_id: string | null;
  failure_reason: string | null;
  occurred_at: string;
};

export type QuotePaymentsRead = { status: "ok"; payments: QuotePayment[] } | { status: "unavailable" };

const COLUMNS = "id, purpose, provider, status, amount_cents, currency, account_kind, provider_account_id, failure_reason, occurred_at";

export async function listQuotePayments(quoteId: string): Promise<QuotePaymentsRead> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase.from("crm_payment").select(COLUMNS).eq("quote_id", quoteId).order("occurred_at", { ascending: false });
    if (error) return { status: "unavailable" };
    return { status: "ok", payments: (data ?? []) as QuotePayment[] };
  } catch {
    return { status: "unavailable" };
  }
}

export type RecordResult = { ok: true } | { ok: false; reason: string };

/** Records money that moved outside Lectual (check, wire, a charge run in LawPay itself). */
export async function recordManualPayment(input: ManualPaymentInput & { quoteId: string; userId: string }): Promise<RecordResult> {
  const check = checkManualPayment(input);
  if (!check.ok) return check;
  const p = check.payment;

  const supabase = await getScopedClient();
  // The quote's own org, matter and lead — read through RLS, so another firm's
  // quote id resolves to nothing.
  const { data: quote, error: quoteError } = await supabase
    .from("crm_quote")
    .select("id, org_id, currency, matter_id, lead_id, title")
    .eq("id", input.quoteId)
    .maybeSingle();
  if (quoteError) return { ok: false, reason: "Couldn't read this quote. Try again shortly." };
  if (!quote) return { ok: false, reason: "Quote not found." };

  const { error } = await supabase.from("crm_payment").insert({
    org_id: quote.org_id,
    quote_id: quote.id,
    matter_id: quote.matter_id ?? null,
    purpose: p.purpose,
    amount_cents: p.amountCents,
    currency: quote.currency || "USD",
    provider: "manual",
    provider_account_id: null,
    account_kind: p.accountKind,
    status: "succeeded",
    recorded_by: input.userId,
    ...(p.occurredAt ? { occurred_at: p.occurredAt } : {}),
  });
  if (error) {
    return { ok: false, reason: error.code === "42501" ? "You don't have permission to record payments." : "Couldn't record the payment. Try again shortly." };
  }

  // Best effort: the audit trail and the timeline.
  const summary = `${formatCents(p.amountCents, quote.currency || "USD")} recorded by hand — ${PURPOSE_LABEL[p.purpose].toLowerCase()}, into the ${p.accountKind} account.${p.note ? ` Note: ${p.note}` : ""}`;
  const payload = {
    quote_id: quote.id,
    provider: "manual",
    purpose: p.purpose,
    account_kind: p.accountKind,
    amount_cents: p.amountCents,
    currency: quote.currency || "USD",
    summary,
  };
  await supabase.from("crm_quote_event").insert({ org_id: quote.org_id, quote_id: quote.id, type: "payment_recorded", actor: "firm", actor_user_id: input.userId, payload });
  if (quote.matter_id || quote.lead_id) {
    await supabase.from("crm_activity").insert({
      org_id: quote.org_id,
      matter_id: quote.matter_id ?? null,
      lead_id: quote.matter_id ? null : (quote.lead_id ?? null),
      type: "quote_payment",
      actor_type: "user",
      actor_id: input.userId,
      payload,
    });
  }
  return { ok: true };
}

/**
 * Resolves a LawPay attempt left `pending` (LawPay gave no clear answer). An
 * admin checks LawPay and says what happened. Only status moves; the money
 * facts are untouched, so 0080's guard does not re-judge the row.
 */
export async function reconcilePendingPayment(input: { paymentId: string; outcome: "succeeded" | "failed" }): Promise<RecordResult> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_payment")
    .update(
      input.outcome === "succeeded"
        ? { status: "succeeded", updated_at: new Date().toISOString() }
        : { status: "failed", failure_reason: "Checked in LawPay by the firm: not charged.", updated_at: new Date().toISOString() },
    )
    .eq("id", input.paymentId)
    .eq("status", "pending")
    .eq("provider", "lawpay")
    .select("id");
  if (error) return { ok: false, reason: error.code === "42501" ? "Only owners and admins can resolve a payment." : "Couldn't update the payment." };
  if (!data?.length) return { ok: false, reason: "That payment isn't waiting to be checked any more, or you can't change it." };
  return { ok: true };
}
