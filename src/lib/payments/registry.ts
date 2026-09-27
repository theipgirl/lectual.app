import {
  PaymentAdapterError,
  purposeAllowsAccountKind,
  type ChargeableAmount,
  type PaymentPurpose,
} from "./types";
import type { LawPayChargeClient } from "./lawpay";
import type { OperatingPaymentAccount } from "./accounts";

/**
 * The ONE sanctioned way to run a signing charge. Ported from lectual's
 * registry.ts (branch claude/lectual-firm-dashboard-prd-f3loev) with the module
 * gate replaced: the caller hands in a `LawPayChargeClient` built from THIS
 * firm's own connection (lawpay-connection.ts, fenced by the quote's org_id), so
 * there is no deployment-wide key through which another firm's charge could go.
 *
 * ── THE ORDER IS THE SAFETY ─────────────────────────────────────────────────
 *   1. Refuse an earned fee bound for trust (also a DB CHECK, 0076).
 *   2. Check the amount belongs to this quote.
 *   3. **Write a `pending` crm_payment row.** If that fails, NOTHING is sent.
 *      lectual 0076's partial unique index `crm_payment_one_open_signing_charge`
 *      makes a second concurrent attempt fail right here (23505), before any
 *      request reaches LawPay — the double-charge guarantee lives in the DB.
 *   4. Charge exactly once, sending the row id as `reference`.
 *   5. Update the row to succeeded / failed, or leave it pending when LawPay's
 *      answer did not establish whether money moved.
 *
 * Nothing here retries: LawPay documents no idempotency key.
 */

/** The minimum a client must do to record a payment — satisfied by the service-role client. */
export type PaymentWriteClient = {
  from(table: "crm_payment"): {
    insert(values: Record<string, unknown>): {
      select(columns: string): {
        single(): PromiseLike<{ data: { id?: string } | null; error: { code?: string; message?: string } | null }>;
      };
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: string): PromiseLike<{ error: { code?: string; message?: string } | null }>;
    };
  };
};

export type QuoteChargeInput = {
  db: PaymentWriteClient;
  /** From the quote row, never a request. Stamps the payment's tenant. */
  orgId: string;
  quoteId: string;
  matterId?: string | null;
  /** Branded; only `signingChargeForQuote()` over the signed snapshot makes one. */
  amount: ChargeableAmount;
  /** The firm's mapped OPERATING account. A trust account does not type-check. */
  account: OperatingPaymentAccount;
  /** Built from the same firm's connection, for this account. */
  client: LawPayChargeClient;
  methodToken: string;
  recordedBy?: string | null;
};

export type QuoteChargeOutcome =
  | { status: "succeeded"; paymentId: string; chargeId: string; amountCents: number; currency: string; accountMismatch: boolean }
  | { status: "failed"; paymentId: string; failure: "card" | "request"; detail: string; clientDetail?: string; credentialRejected: boolean }
  | { status: "indeterminate"; paymentId: string; detail: string }
  | { status: "charged_unrecorded"; paymentId: string; chargeId: string; detail: string }
  | { status: "not_attempted"; reason: "already_open" | "record_write_failed" | "refused_before_send"; detail: string; paymentId?: string };

export async function chargeQuoteAtSigning(input: QuoteChargeInput): Promise<QuoteChargeOutcome> {
  const { account, amount } = input;
  const purpose: PaymentPurpose = "legal_fee";

  // 1. Earned fee → operating only. The type already says so; this is for the
  //    JS caller, the `any`, and `{ ...operating, accountKind: "trust" }`.
  if (!purposeAllowsAccountKind(purpose, account.accountKind)) {
    throw new PaymentAdapterError(
      `Refusing to charge: a ${purpose} may not be paid into the firm's ${account.accountKind} account. Earned fees belong in operating.`,
    );
  }
  // 2.
  if (amount.quoteId !== input.quoteId) {
    throw new PaymentAdapterError(`Refusing to charge: the amount was computed for another quote.`);
  }

  // 3. The row FIRST.
  const insert = await input.db
    .from("crm_payment")
    .insert({
      org_id: input.orgId,
      quote_id: input.quoteId,
      matter_id: input.matterId ?? null,
      purpose,
      amount_cents: amount.amountCents,
      currency: amount.currency,
      provider: "lawpay",
      provider_account_id: account.providerAccountId,
      // NOT NULL, never inferred: the firm's own declared mapping.
      account_kind: account.accountKind,
      status: "pending",
      recorded_by: input.recordedBy ?? null,
    })
    .select("id")
    .single();

  const paymentId = insert.data?.id;
  if (insert.error || !paymentId) {
    if (insert.error?.code === "23505") {
      // Another attempt on this quote is pending or succeeded — the one-charge
      // index refused this one before anything was sent.
      return { status: "not_attempted", reason: "already_open", detail: "An earlier payment on this quote is already recorded or in progress." };
    }
    console.error("[payments] refusing to charge: could not write the pending crm_payment row:", insert.error?.code ?? "no id returned");
    return { status: "not_attempted", reason: "record_write_failed", detail: "We could not record this payment, so no card was charged." };
  }

  // 4. Exactly one attempt.
  let result;
  try {
    result = await input.client.charge({
      amount,
      providerAccountId: account.providerAccountId,
      methodToken: input.methodToken,
      reference: paymentId,
    });
  } catch (err) {
    // A refusal BEFORE any request left this server. Nothing was sent, so the
    // row is closed as failed — a pending row here would block the quote's
    // payment forever behind a charge that never happened (lectual's port left
    // it pending and called that a known sharp edge).
    const detail = `Not sent to LawPay: ${errorText(err)}`.slice(0, 500);
    await input.db.from("crm_payment").update({ status: "failed", failure_reason: detail }).eq("id", paymentId);
    return { status: "not_attempted", reason: "refused_before_send", detail, paymentId };
  }

  // 5. Record what happened.
  if (result.outcome === "succeeded") {
    // provider_account_id is NOT overwritten with the echo: 0076's guard pins
    // it to the mapped account, and a gateway that charged a different account
    // is a reconciliation fact, surfaced as `accountMismatch`.
    const accountMismatch = result.accountId !== null && result.accountId !== account.providerAccountId;
    const update = await input.db
      .from("crm_payment")
      .update({ status: "succeeded", provider_charge_id: result.chargeId })
      .eq("id", paymentId);
    if (update.error) {
      console.error(`[payments] CHARGED BUT NOT RECORDED — payment ${paymentId}, provider charge ${result.chargeId}:`, update.error.message ?? "write error");
      return {
        status: "charged_unrecorded",
        paymentId,
        chargeId: result.chargeId,
        detail: "The payment went through but could not be fully recorded. Do not charge again — reconcile it first.",
      };
    }
    return { status: "succeeded", paymentId, chargeId: result.chargeId, amountCents: amount.amountCents, currency: amount.currency, accountMismatch };
  }

  if (result.outcome === "failed") {
    const update = await input.db
      .from("crm_payment")
      .update({
        status: "failed",
        failure_reason: result.detail.slice(0, 500),
        ...(result.chargeId ? { provider_charge_id: result.chargeId } : {}),
      })
      .eq("id", paymentId);
    if (update.error) console.error(`[payments] declined charge left pending — payment ${paymentId}:`, update.error.message ?? "write error");
    return {
      status: "failed",
      paymentId,
      failure: result.failure,
      detail: result.detail,
      clientDetail: result.clientDetail,
      credentialRejected: Boolean(result.credentialRejected),
    };
  }

  // Indeterminate: the row stays pending (0068 forbids a failure_reason on a
  // non-failed row), which keeps the one-charge index closed until a human
  // reconciles it in the builder's payments panel.
  return { status: "indeterminate", paymentId, detail: result.detail };
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
