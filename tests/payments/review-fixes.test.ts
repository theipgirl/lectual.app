import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Adversarial-review fixes for per-firm LawPay. NOTHING HERE TALKS TO LAWPAY:
 * the charge is a vi.fn() and the database is an in-memory fake.
 */

/* ───────────────────────── mocks for payAcceptedQuote ───────────────────── */

const state = vi.hoisted(() => ({
  paymentRows: [] as Record<string, unknown>[],
  chargeOutcome: null as unknown,
  chargeCalls: 0,
  markCalls: [] as unknown[],
}));

vi.mock("@/lib/quotes/public", () => ({
  readPublicQuote: vi.fn(async () => ({
    status: "ok",
    handle: { quoteId: "q1", orgId: "org1" },
    view: {
      status: "accepted",
      acceptedSnapshot: {
        currency: "USD",
        quote: { title: "Trademark" },
        lines: [{ id: "a", kind: "legal_fee", charge_at: "signing", selection: "included", selected: true, quantity: 1, unit_amount_cents: 150000 }],
        totals: { due_at_signing: 150000, due_at_filing: 0 },
      },
    },
  })),
}));

function chain(result: unknown) {
  const self: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) self[m] = () => self;
  self.maybeSingle = async () => ({ data: null, error: null });
  self.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return self;
}

vi.mock("@/lib/db/admin", () => ({
  getAdminClient: () => ({
    from: (table: string) => ({
      select: () => chain(table === "crm_payment" ? { data: state.paymentRows, error: null } : { data: null, error: null }),
      insert: async () => ({ error: null }),
    }),
  }),
}));

vi.mock("@/lib/payments/accounts", () => ({
  loadPublicRouteOperatingAccount: vi.fn(async () => ({
    status: "ok",
    account: { provider: "lawpay", accountKind: "operating", providerAccountId: "acct_op", label: null, verifiedAt: "2026-09-27" },
  })),
}));

vi.mock("@/lib/payments/lawpay-connection", () => ({
  loadChargeCredentials: vi.fn(async () => ({ status: "ok", secretKey: "sk_test", publicKey: "pk_test", mode: "test", connectionId: "c1" })),
  markConnectionNeedsAttention: vi.fn(async (input: unknown) => {
    state.markCalls.push(input);
  }),
}));

vi.mock("@/lib/payments/registry", () => ({
  chargeQuoteAtSigning: vi.fn(async () => {
    state.chargeCalls += 1;
    return state.chargeOutcome;
  }),
}));

import { payAcceptedQuote } from "@/lib/quotes/public-payment";
import { MAX_FAILED_CARD_ATTEMPTS, settledPaymentState } from "@/lib/payments/payment-state";
import { payMessage, retryPolicy } from "@/lib/payments/pay-messages";
import { signingChargeForQuote } from "@/lib/payments/types";
import { readSealedAccount, sealedGatewayPayload } from "@/lib/payments/lawpay-accounts";
import type { LawPayAccount } from "@/lib/payments/lawpay-oauth";

beforeEach(() => {
  state.paymentRows = [];
  state.chargeOutcome = null;
  state.chargeCalls = 0;
  state.markCalls = [];
});

describe("a refusal of ONE request never pauses the firm's card payments", () => {
  it("a 4xx that is not a credential rejection: row failed, form stays, firm NOT paused", async () => {
    state.chargeOutcome = { status: "failed", paymentId: "p1", failure: "request", detail: "Invalid method token", credentialRejected: false };
    const r = await payAcceptedQuote({ token: "t", methodToken: "junk-token-from-an-anonymous-caller" }, new Date());
    expect(r).toEqual({ ok: false, reason: "not_processed" });
    expect(state.markCalls).toHaveLength(0);
    expect(retryPolicy("not_processed")).toBe("retry");
    expect(payMessage("not_processed", "Invalid method token", "Hartwell IP")).not.toContain("Invalid method token");
  });

  it("a 401/403 on the firm's key pauses the firm (reauth) and closes the form", async () => {
    state.chargeOutcome = { status: "failed", paymentId: "p1", failure: "request", detail: "Unauthorized", credentialRejected: true };
    const r = await payAcceptedQuote({ token: "t", methodToken: "tok" }, new Date());
    expect(r).toEqual({ ok: false, reason: "rejected" });
    expect(state.markCalls).toHaveLength(1);
    expect(state.markCalls[0]).toMatchObject({ orgId: "org1" });
  });
});

describe("the link can't be used to test cards", () => {
  const failed = { purpose: "legal_fee", provider: "lawpay", status: "failed", amount_cents: 150000, currency: "USD" };

  it(`after ${MAX_FAILED_CARD_ATTEMPTS} failed attempts nothing is sent to LawPay`, async () => {
    state.paymentRows = Array.from({ length: MAX_FAILED_CARD_ATTEMPTS }, () => failed);
    state.chargeOutcome = { status: "succeeded" };
    const r = await payAcceptedQuote({ token: "t", methodToken: "tok" }, new Date());
    expect(r).toEqual({ ok: false, reason: "manual" });
    expect(state.chargeCalls).toBe(0);
  });

  it("one fewer still allows another card", async () => {
    state.paymentRows = Array.from({ length: MAX_FAILED_CARD_ATTEMPTS - 1 }, () => failed);
    state.chargeOutcome = { status: "failed", paymentId: "p", failure: "card", detail: "Declined", credentialRejected: false };
    const r = await payAcceptedQuote({ token: "t", methodToken: "tok" }, new Date());
    expect(r).toMatchObject({ ok: false, reason: "declined" });
    expect(state.chargeCalls).toBe(1);
  });

  it("the receipt stops offering the form at the cap", () => {
    const due = signingChargeForQuote({
      quoteId: "q",
      currency: "USD",
      lines: [{ id: "a", kind: "legal_fee", charge_at: "signing", selection: "included", selected: true, quantity: 1, unit_amount_cents: 1000 }],
    });
    const rows = Array.from({ length: MAX_FAILED_CARD_ATTEMPTS }, () => failed);
    expect(settledPaymentState({ status: "ok", rows }, due)).toEqual({ status: "manual", nothingDue: false });
    expect(settledPaymentState({ status: "ok", rows: rows.slice(1) }, due)).toBeNull();
  });
});

describe("the charge equals the figure that was SIGNED", () => {
  const lines = [{ id: "a", kind: "legal_fee", charge_at: "signing", selection: "included", selected: true, quantity: 1, unit_amount_cents: 150000 }];

  it("a recomputation that differs from the frozen total is refused, not charged", () => {
    const r = signingChargeForQuote({ quoteId: "q", currency: "USD", lines, signedDueAtSigningCents: 120000 });
    expect(r).toMatchObject({ ok: false, reason: "snapshot_mismatch" });
    const same = signingChargeForQuote({ quoteId: "q", currency: "USD", lines, signedDueAtSigningCents: 150000 });
    expect(same.ok).toBe(true);
  });

  it("the proposal page refuses to charge a snapshot whose totals disagree with its lines", async () => {
    const { readPublicQuote } = await import("@/lib/quotes/public");
    vi.mocked(readPublicQuote).mockResolvedValueOnce({
      status: "ok",
      handle: { quoteId: "q1", orgId: "org1" },
      view: { status: "accepted", acceptedSnapshot: { currency: "USD", quote: { title: "T" }, lines, totals: { due_at_signing: 99, due_at_filing: 0 } } },
    } as never);
    state.chargeOutcome = { status: "succeeded" };
    const r = await payAcceptedQuote({ token: "t", methodToken: "tok" }, new Date());
    expect(r).toEqual({ ok: false, reason: "manual" });
    expect(state.chargeCalls).toBe(0);
  });
});

describe("trust vs operating is decided by the SEALED copy of LawPay's flag", () => {
  const accounts: LawPayAccount[] = [
    { id: "op1", name: "Operating", type: "MerchantAccount", trust_account: false, mode: "test", public_key: "pk1", currency: "USD" },
    { id: "tr1", name: "IOLTA", type: "MerchantAccount", trust_account: true, mode: "test", public_key: "pk2", currency: "USD" },
  ];
  const sealed = sealedGatewayPayload({ accounts, secrets: { "test:op1": "sk_op", "test:tr1": "sk_tr" } });

  it("returns the operating key for the operating account", () => {
    expect(readSealedAccount(sealed, { accountId: "op1", mode: "test", kind: "operating" })).toEqual({ secretKey: "sk_op" });
  });

  it("an IOLTA account relabelled 'not trust' in the readable column still can't be charged as operating", () => {
    expect(readSealedAccount(sealed, { accountId: "tr1", mode: "test", kind: "operating" })).toBeNull();
  });

  it("wrong mode, unknown account, old unversioned payload, or no kind → null", () => {
    expect(readSealedAccount(sealed, { accountId: "op1", mode: "live", kind: "operating" })).toBeNull();
    expect(readSealedAccount(sealed, { accountId: "nope", mode: "test", kind: "operating" })).toBeNull();
    expect(readSealedAccount({ "test:op1": "sk_op" }, { accountId: "op1", mode: "test", kind: "operating" })).toBeNull();
    expect(readSealedAccount(sealed, { accountId: "op1", mode: "test", kind: undefined })).toBeNull();
  });

  it("the sealed payload carries no public data beyond id, mode and trust flag", () => {
    expect(sealed.accounts).toEqual([
      { id: "op1", mode: "test", trust_account: false },
      { id: "tr1", mode: "test", trust_account: true },
    ]);
  });
});
