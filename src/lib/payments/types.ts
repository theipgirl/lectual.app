/**
 * The payment contract, and the one module whose job is to make a category of
 * mistake impossible to compile.
 *
 * Ported from lectual (branch claude/lectual-firm-dashboard-prd-f3loev,
 * src/lib/payments/types.ts). Changed for lectual.app: there is no `lawpay`
 * module gate and no deployment-wide secret key. A firm can charge only through
 * the LawPay account IT connected (lawpay-connection.ts), so "this firm
 * connected its own account" replaces the module as the gate.
 *
 * ── WHAT IS AT RISK ─────────────────────────────────────────────────────────
 *  1. A charge raised against an amount that arrived in a request body. The
 *     client page `/q/[token]` is unauthenticated. So the charge takes a
 *     BRANDED `ChargeableAmount` that only `signingChargeForQuote()` produces,
 *     from the signed snapshot's lines.
 *  2. A charge raised with no `account_id`. LawPay's gateway "automatically
 *     selects the primary merchant or eCheck account" when it is omitted, and
 *     for a law firm trust (IOLTA) vs operating is a Rule 1.15 question, not a
 *     routing detail. `providerAccountId` is required with no default, and the
 *     adapter throws before sending without one.
 *  3. An explicit account on the wrong side of the books. A signing charge is an
 *     earned flat fee and belongs in OPERATING. See
 *     `PAYMENT_ACCOUNT_KINDS_FOR_PURPOSE`, the registry's runtime check, and
 *     lectual 0080's CHECK `crm_payment_lawpay_legal_fee_operating`.
 */

import { quoteBlockers, quoteTotals, type QuoteBlocker, type QuoteLineInput } from "@/lib/quotes/pricing";

/** Providers a `crm_payment` row may name (0068's check constraint). */
export const PAYMENT_RECORD_PROVIDERS = ["lawpay", "manual"] as const;
export type PaymentRecordProvider = (typeof PAYMENT_RECORD_PROVIDERS)[number];

/**
 * Trust/IOLTA or operating. `crm_payment.account_kind` is NOT NULL with no
 * default, and so is this type: there is no "unspecified" member.
 */
export const PAYMENT_ACCOUNT_KINDS = ["trust", "operating"] as const;
export type PaymentAccountKind = (typeof PAYMENT_ACCOUNT_KINDS)[number];

export function isPaymentAccountKind(value: unknown): value is PaymentAccountKind {
  return value === "trust" || value === "operating";
}

export const PAYMENT_PURPOSES = ["legal_fee", "government_fee", "expense", "other"] as const;
export type PaymentPurpose = (typeof PAYMENT_PURPOSES)[number];

export function isPaymentPurpose(value: unknown): value is PaymentPurpose {
  return typeof value === "string" && (PAYMENT_PURPOSES as readonly string[]).includes(value);
}

/**
 * Which side of the books each purpose may be CHARGED into. An earned legal fee
 * is the firm's own money and may not go into trust (commingling). It
 * constrains what Lectual will charge; it does not constrain what a firm may
 * RECORD by hand, because refusing to record money that already moved does not
 * un-move it.
 */
export const PAYMENT_ACCOUNT_KINDS_FOR_PURPOSE: Record<PaymentPurpose, readonly PaymentAccountKind[]> = {
  legal_fee: ["operating"],
  government_fee: ["trust", "operating"],
  expense: ["trust", "operating"],
  other: ["trust", "operating"],
};

export type TrustChargeablePurpose = Exclude<PaymentPurpose, "legal_fee">;

export function purposeAllowsAccountKind(purpose: PaymentPurpose, accountKind: PaymentAccountKind): boolean {
  return PAYMENT_ACCOUNT_KINDS_FOR_PURPOSE[purpose].includes(accountKind);
}

export const PAYMENT_STATUSES = ["pending", "succeeded", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/* ──────────────────────── the branded charge amount ─────────────────────── */

declare const chargeableAmountBrand: unique symbol;

/**
 * An amount safe to charge because pricing.ts computed it from the firm's own
 * stored lines. Constructible ONLY by `signingChargeForQuote()`. Carries the
 * quote id so an amount for one quote cannot be charged against another.
 */
export type ChargeableAmount = {
  readonly amountCents: number;
  readonly currency: string;
  readonly quoteId: string;
  readonly [chargeableAmountBrand]: "computed-by-quotes/pricing.ts";
};

export type ChargeableAmountRefusal =
  | { reason: "quote_blocked"; message: string; blocker: QuoteBlocker }
  | { reason: "nothing_due_at_signing"; message: string }
  | { reason: "not_a_positive_amount"; message: string }
  | { reason: "unsupported_currency"; message: string }
  | { reason: "snapshot_mismatch"; message: string };

export type ChargeableAmountResult = { ok: true; amount: ChargeableAmount } | ({ ok: false } & ChargeableAmountRefusal);

/**
 * THE ONLY WAY TO MAKE AN AMOUNT THIS SUBSYSTEM WILL CHARGE.
 *
 * `lines` MUST be the SIGNED SNAPSHOT's lines (crm_quote.accepted_snapshot),
 * read server-side. NEVER lines parsed from a request body: this function would
 * price a fabricated $1 line and brand it.
 *
 * It charges `dueAtSigning` and nothing else. `quoteTotals` buckets every
 * `government_fee` line to filing whatever its `charge_at` says, so there is no
 * arrangement of line data by which a USPTO fee reaches a signing charge
 * (spec §0: government fees are collected at filing).
 */
export function signingChargeForQuote(input: {
  quoteId: string;
  currency: string;
  lines: readonly QuoteLineInput[];
  /**
   * The snapshot's FROZEN `totals.due_at_signing` — the figure the client read
   * and signed. When given, the recomputed amount must equal it exactly, or
   * nothing is charged: a later change to the pricing code must never move a
   * charge away from what was signed.
   */
  signedDueAtSigningCents?: number;
}): ChargeableAmountResult {
  const currency = (input.currency || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { ok: false, reason: "unsupported_currency", message: `This quote's currency (${input.currency || "unset"}) is not a currency code.` };
  }
  if (currency !== "USD") {
    // LawPay's documented charge request carries no currency field.
    return { ok: false, reason: "unsupported_currency", message: `Online payment is available for USD quotes only; this quote is in ${currency}.` };
  }

  const [blocker] = quoteBlockers(input.lines);
  if (blocker) return { ok: false, reason: "quote_blocked", message: blocker.message, blocker };

  const amountCents = quoteTotals(input.lines, currency).dueAtSigning;
  if (input.signedDueAtSigningCents !== undefined && input.signedDueAtSigningCents !== amountCents) {
    return {
      ok: false,
      reason: "snapshot_mismatch",
      message: "The amount due at signing no longer recomputes to the figure that was signed, so it can't be charged online.",
    };
  }
  if (amountCents === 0) return { ok: false, reason: "nothing_due_at_signing", message: "Nothing on this quote is due at signing." };
  if (!Number.isSafeInteger(amountCents) || amountCents < 0) {
    return { ok: false, reason: "not_a_positive_amount", message: "The amount due at signing is not a positive whole number of cents." };
  }
  return { ok: true, amount: { amountCents, currency, quoteId: input.quoteId } as ChargeableAmount };
}

/* ───────────────────────────── adapter contract ─────────────────────────── */

export type ProviderChargeRequest = {
  readonly amount: ChargeableAmount;
  /** REQUIRED. From crm_org_payment_account. No default anywhere. */
  readonly providerAccountId: string;
  /** Single-use Hosted Fields token. Never logged, never in an error message. */
  readonly methodToken: string;
  /** The local crm_payment.id, sent as `reference` for reconciliation. */
  readonly reference?: string;
  readonly timeoutMs?: number;
};

/**
 * One charge attempt, with a deliberate third member. LawPay documents NO
 * idempotency key, so an answer that does not establish whether money moved is
 * `unknown` — never `failed` (invites a second charge) and never `succeeded`
 * (invents a payment).
 */
export type ProviderChargeResult =
  | {
      outcome: "succeeded";
      chargeId: string;
      accountId: string | null;
      amountCents: number | null;
      currency: string | null;
      providerStatus: string | null;
    }
  | {
      outcome: "failed";
      /**
       * `card`: the gateway decided about the card (402). Another card is a
       * real next move. `request`: the gateway refused OUR request (401/403,
       * 4xx, a 2xx VOIDED). The client can do nothing; the firm must.
       */
      failure: "card" | "request";
      /** For the firm and crm_payment.failure_reason. */
      detail: string;
      /** The provider's own words, set ONLY on a 402 card decision. */
      clientDetail?: string;
      /** The gateway refused our credential (401/403): the connection needs attention. */
      credentialRejected?: boolean;
      chargeId?: string;
      providerStatus?: string;
    }
  | { outcome: "unknown"; detail: string; chargeId?: string; providerStatus?: string };

/** Thrown before any network call when the caller asked for something this layer must refuse. */
export class PaymentAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PaymentAdapterError";
  }
}
