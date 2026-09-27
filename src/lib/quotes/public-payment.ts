import "server-only";

import { getAdminClient } from "@/lib/db/admin";
import { loadPublicRouteOperatingAccount } from "@/lib/payments/accounts";
import { lawPayApiBase } from "@/lib/payments/lawpay-config";
import { loadChargeCredentials, markConnectionNeedsAttention } from "@/lib/payments/lawpay-connection";
import { createLawPayChargeClient } from "@/lib/payments/lawpay";
import {
  MAX_FAILED_CARD_ATTEMPTS,
  cardPaymentState,
  failedCardAttempts,
  hasSettledSigningPayment,
  hasUnresolvedAttempt,
  settledPaymentState,
  type CardSetup,
  type PaymentsRead,
  type PublicPaymentState,
} from "@/lib/payments/payment-state";
import { chargeQuoteAtSigning, type PaymentWriteClient } from "@/lib/payments/registry";
import { signingChargeForQuote, type ChargeableAmountResult } from "@/lib/payments/types";
import type { QuoteLineInput } from "./pricing";
import { readPublicQuote, type PublicQuoteHandle, type QuoteAcceptedSnapshot } from "./public";

/**
 * THE SIGNING PAYMENT ON THE CLIENT'S PROPOSAL PAGE (spec §7.4).
 *
 * Ported from lectual (branch claude/lectual-firm-dashboard-prd-f3loev,
 * src/lib/quotes/public-payment.ts) and inherits `public.ts`'s rule: the token
 * is the entire boundary, every read is a column allowlist, every write is
 * fenced by the id and org_id read off the token's own row.
 *
 * Changed for per-firm LawPay: no `lawpay` module and no LAWPAY_SECRET_KEY /
 * LAWPAY_PUBLIC_KEY. The firm must have connected ITS OWN LawPay account and
 * mapped an operating account; the keys come from that connection, looked up
 * by the quote's org_id.
 *
 * ── SIGNATURE FIRST, PAYMENT SECOND, AND THEY FAIL SEPARATELY ───────────────
 * `acceptPublicQuote` records the signature and charges nothing. The Pay
 * section lives on the receipt, and `payAcceptedQuote` runs only against a
 * quote that is ALREADY accepted. A declined card can never cost a signature,
 * and a signature is never rolled back for a payment outcome.
 *
 * ── THE AMOUNT IS THE SIGNED SNAPSHOT'S DUE-AT-SIGNING, NOTHING ELSE ────────
 * From `accepted_snapshot` through `signingChargeForQuote` — never the live
 * lines (a re-price after signing must not move the charge) and never anything
 * the browser sent. USPTO government fees are due at filing and are never part
 * of it; the firm collects them later.
 *
 * ── TO OPERATING, EXPLICITLY ────────────────────────────────────────────────
 * The account is the firm's mapped OPERATING account. There is no default.
 */

function adminDb() {
  return getAdminClient();
}

/** Payment columns this route may read. Not the account id, not the charge id. */
const PAYMENT_COLUMNS = "purpose, provider, status, amount_cents, currency";

async function readQuotePayments(db: ReturnType<typeof adminDb>, handle: PublicQuoteHandle): Promise<PaymentsRead> {
  try {
    const { data, error } = await db
      .from("crm_payment")
      .select(PAYMENT_COLUMNS)
      .eq("quote_id", handle.quoteId)
      // On a service-role connection this filter IS the scoping.
      .eq("org_id", handle.orgId);
    if (error) return { status: "unavailable" };
    return { status: "ok", rows: data ?? [] };
  } catch {
    return { status: "unavailable" };
  }
}

function snapshotCharge(quoteId: string, snapshot: QuoteAcceptedSnapshot | null): ChargeableAmountResult | null {
  if (!snapshot) return null;
  const signed = snapshot.totals?.due_at_signing;
  // The frozen figure the client signed. A snapshot without a readable one
  // can't be charged online (parseAcceptedSnapshot already requires a number).
  if (typeof signed !== "number" || !Number.isSafeInteger(signed)) return null;
  return signingChargeForQuote({
    quoteId,
    currency: snapshot.currency,
    lines: snapshot.lines as readonly QuoteLineInput[],
    signedDueAtSigningCents: signed,
  });
}

/** Can this firm take the signing payment by card right now? Service role, fenced on orgId. */
async function cardSetup(db: ReturnType<typeof adminDb>, orgId: string): Promise<CardSetup & { accountId?: string }> {
  const account = await loadPublicRouteOperatingAccount({ db, orgId });
  if (account.status === "unavailable") return { status: "unavailable" };
  if (account.status === "unmapped") return { status: "unconfigured" };
  const creds = await loadChargeCredentials({ db, orgId, accountId: account.account.providerAccountId, kind: "operating" });
  if (creds.status !== "ok") return creds;
  return { status: "ok", publicKey: creds.publicKey, accountId: account.account.providerAccountId };
}

/**
 * The receipt's Pay section state for an ACCEPTED quote. Never charges.
 * What is already paid is read FIRST; if that read fails the answer is
 * `unavailable` — never a card form and never "unpaid".
 */
export async function readPublicPaymentState(input: {
  handle: PublicQuoteHandle;
  snapshot: QuoteAcceptedSnapshot | null;
}): Promise<PublicPaymentState> {
  let db: ReturnType<typeof adminDb>;
  try {
    db = adminDb();
  } catch {
    return { status: "unavailable" };
  }
  const payments = await readQuotePayments(db, input.handle);
  const charge = snapshotCharge(input.handle.quoteId, input.snapshot);
  const settled = settledPaymentState(payments, charge);
  if (settled) return settled;
  const card = await cardSetup(db, input.handle.orgId);
  return cardPaymentState(charge!, card);
}

/**
 * For the LIVE (pre-signature) page: will this firm offer a card form after
 * signing? Answered from the FIRM's setup alone, never from the lines — runbook
 * defect 4 was this answer depending on a package the client hadn't picked yet.
 * Null = couldn't tell (the page then says nothing either way).
 */
export async function firmTakesCardPayments(handle: PublicQuoteHandle): Promise<boolean | null> {
  try {
    const card = await cardSetup(adminDb(), handle.orgId);
    return card.status === "ok" ? true : card.status === "unconfigured" ? false : null;
  } catch {
    return null;
  }
}

/* ──────────────────────────────── paying ────────────────────────────────── */

export type PayRefusal =
  | "not_found"
  | "not_accepted"
  | "already_paid"
  | "awaiting_confirmation"
  | "manual"
  | "declined"
  | "not_processed"
  | "rejected"
  | "indeterminate"
  | "charged_unrecorded"
  | "unavailable";

export type PayResult = { ok: true; amountCents: number; currency: string } | { ok: false; reason: PayRefusal; message?: string };

/**
 * Charge the signing amount on an already-accepted quote. Everything is
 * re-resolved from the TOKEN: the only caller-supplied values used are the
 * token and the opaque single-use payment token. Nothing the caller sends is a
 * lookup key or an amount.
 */
export async function payAcceptedQuote(input: { token: string; methodToken: string }, now: Date): Promise<PayResult> {
  const methodToken = (input.methodToken ?? "").trim();
  if (!methodToken || methodToken.length > 4096) return { ok: false, reason: "unavailable" };

  const read = await readPublicQuote(input.token, now);
  if (read.status === "not_found") return { ok: false, reason: "not_found" };
  if (read.status !== "ok") return { ok: false, reason: "unavailable" };
  if (read.view.status !== "accepted") return { ok: false, reason: "not_accepted" };
  const snapshot = read.view.acceptedSnapshot;
  // An unreadable signed record: what the client agreed to pay can't be
  // established, and the live lines are not a substitute.
  if (!snapshot) return { ok: false, reason: "manual" };

  let db: ReturnType<typeof adminDb>;
  try {
    db = adminDb();
  } catch {
    return { ok: false, reason: "unavailable" };
  }

  const payments = await readQuotePayments(db, read.handle);
  if (payments.status !== "ok") return { ok: false, reason: "unavailable" };
  if (hasSettledSigningPayment(payments.rows)) return { ok: false, reason: "already_paid" };
  if (hasUnresolvedAttempt(payments.rows)) return { ok: false, reason: "awaiting_confirmation" };
  // The link is unauthenticated: cap the attempts so it can't be used to test cards.
  if (failedCardAttempts(payments.rows) >= MAX_FAILED_CARD_ATTEMPTS) return { ok: false, reason: "manual" };

  const charge = snapshotCharge(read.handle.quoteId, snapshot);
  if (!charge || !charge.ok) return { ok: false, reason: "manual" };

  const account = await loadPublicRouteOperatingAccount({ db, orgId: read.handle.orgId });
  if (account.status === "unavailable") return { ok: false, reason: "unavailable" };
  if (account.status !== "ok") return { ok: false, reason: "manual" };
  const creds = await loadChargeCredentials({ db, orgId: read.handle.orgId, accountId: account.account.providerAccountId, kind: "operating" });
  if (creds.status === "unavailable") return { ok: false, reason: "unavailable" };
  if (creds.status !== "ok") return { ok: false, reason: "manual" };

  const targets = await readQuoteTargets(db, read.handle);
  const outcome = await chargeQuoteAtSigning({
    db: db as unknown as PaymentWriteClient,
    orgId: read.handle.orgId,
    quoteId: read.handle.quoteId,
    matterId: targets.matterId,
    amount: charge.amount,
    account: account.account,
    client: createLawPayChargeClient({ secretKey: creds.secretKey, apiBase: lawPayApiBase() }),
    methodToken,
    recordedBy: null,
  });

  const event = (state: EventState, detail?: string, amountCents = charge.amount.amountCents) =>
    recordPaymentEvents({ db, handle: read.handle, targets, snapshot, state, amountCents, currency: charge.amount.currency, mode: creds.mode, detail, now });

  switch (outcome.status) {
    case "succeeded":
      await event(outcome.accountMismatch ? "account_mismatch" : "succeeded");
      return { ok: true, amountCents: outcome.amountCents, currency: outcome.currency };
    case "failed":
      if (outcome.failure === "card") return { ok: false, reason: "declined", message: outcome.clientDetail };
      if (outcome.credentialRejected) {
        // LawPay refused the FIRM's key (401/403). No card can work until the
        // firm reconnects, so the connection is flagged (every proposal of this
        // firm stops offering a form) and the firm gets a timeline row.
        await markConnectionNeedsAttention({ db, orgId: read.handle.orgId, detail: `LawPay rejected the firm's credentials on a client payment: ${outcome.detail}` });
        await event("rejected", outcome.detail);
        return { ok: false, reason: "rejected" };
      }
      // Any other refusal (a 4xx, a 2xx VOIDED) is about THIS request, and the
      // request carries a payment token the anonymous caller chose. It must not
      // pause the firm's card payments: otherwise anyone holding one proposal
      // link could switch off every client's card form with a junk token. The
      // row is failed (nothing moved), the firm sees it, and the attempt cap
      // bounds the retries.
      await event("refused", outcome.detail);
      return { ok: false, reason: "not_processed" };
    case "indeterminate":
    case "charged_unrecorded":
      await event(outcome.status, outcome.detail);
      return { ok: false, reason: outcome.status };
    default:
      if (outcome.reason === "already_open") return { ok: false, reason: "awaiting_confirmation" };
      return { ok: false, reason: outcome.reason === "record_write_failed" ? "unavailable" : "manual" };
  }
}

async function readQuoteTargets(db: ReturnType<typeof adminDb>, handle: PublicQuoteHandle): Promise<{ matterId: string | null; leadId: string | null }> {
  try {
    const { data } = await db.from("crm_quote").select("matter_id, lead_id").eq("id", handle.quoteId).eq("org_id", handle.orgId).maybeSingle();
    return { matterId: data?.matter_id ?? null, leadId: data?.lead_id ?? null };
  } catch {
    return { matterId: null, leadId: null };
  }
}

type EventState = "succeeded" | "account_mismatch" | "indeterminate" | "charged_unrecorded" | "rejected" | "refused";

function summarizeForStaff(state: EventState, detail: string | undefined, mode: "test" | "live"): string {
  const test = mode === "test" ? " (LawPay test mode — no real money)" : "";
  switch (state) {
    case "succeeded":
      return `Card payment authorised at signing, to the operating account${test}.`;
    case "account_mismatch":
      return `Card payment authorised, but LawPay reported a different account than the mapped operating account — check it in LawPay${test}.`;
    case "indeterminate":
      return `Card payment attempted and LawPay gave no clear answer — it may or may not have been taken. Check LawPay, then mark it on the quote's payments panel${test}.`;
    case "charged_unrecorded":
      return `Card payment went through and was NOT fully recorded. Reconcile it in LawPay before anyone charges again${test}.`;
    case "rejected":
      return (
        `LawPay rejected the firm's credentials before any card was charged — nothing was taken. Card payments are paused until LawPay is reconnected in Settings → Integrations${test}.` +
        (detail ? ` LawPay said: ${detail.slice(0, 300)}` : "")
      );
    case "refused":
      return (
        `LawPay refused a card payment attempt on this proposal — nothing was taken, and card payments stay on. If this keeps happening, check the operating account in LawPay${test}.` +
        (detail ? ` LawPay said: ${detail.slice(0, 300)}` : "")
      );
  }
}

/**
 * The quote's audit trail and the matter/lead timeline, so the firm sees every
 * card outcome that needs a person. Best effort: the money already moved (or
 * didn't) and an audit insert failing must not change what the client is told.
 */
async function recordPaymentEvents(input: {
  db: ReturnType<typeof adminDb>;
  handle: PublicQuoteHandle;
  targets: { matterId: string | null; leadId: string | null };
  snapshot: QuoteAcceptedSnapshot;
  state: EventState;
  amountCents: number;
  currency: string;
  mode: "test" | "live";
  detail?: string;
  now: Date;
}): Promise<void> {
  const { db, handle, state } = input;
  const payload = {
    quote_id: handle.quoteId,
    title: input.snapshot.quote.title,
    // Never a "total": the two figures stay separate (§0).
    due_at_signing_cents: input.amountCents,
    due_at_filing_cents: input.snapshot.totals.due_at_filing,
    currency: input.currency,
    provider: "lawpay",
    account_kind: "operating",
    mode: input.mode,
    payment_state: state,
    needs_reconciliation: state === "indeterminate" || state === "charged_unrecorded" || state === "account_mismatch",
    needs_firm_action: state === "rejected",
    summary: summarizeForStaff(state, input.detail, input.mode),
    ...(input.detail ? { detail: input.detail.slice(0, 500) } : {}),
    occurred_at: input.now.toISOString(),
  };
  try {
    const { error } = await db
      .from("crm_quote_event")
      .insert({ org_id: handle.orgId, quote_id: handle.quoteId, type: "payment_recorded", actor: "client", payload });
    if (error) console.error(`[payments] quote event not recorded quote=${handle.quoteId} state=${state}`, error.code);
  } catch (err) {
    console.error(`[payments] quote event not recorded quote=${handle.quoteId}`, err);
  }
  if (!input.targets.matterId && !input.targets.leadId) return;
  try {
    const { error } = await db.from("crm_activity").insert({
      org_id: handle.orgId,
      matter_id: input.targets.matterId,
      lead_id: input.targets.matterId ? null : input.targets.leadId,
      type: "quote_payment",
      actor_type: "system",
      payload,
    });
    if (error) console.error(`[payments] quote_payment activity not recorded quote=${handle.quoteId}`, error.code);
  } catch (err) {
    console.error(`[payments] quote_payment activity not recorded quote=${handle.quoteId}`, err);
  }
}
