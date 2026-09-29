import { describe, it, expect } from "vitest";
import { cardPaymentState, settledPaymentState, type PaymentsRead } from "@/lib/payments/payment-state";
import { signingChargeForQuote } from "@/lib/payments/types";
import { payMessage, retryPolicy } from "@/lib/payments/pay-messages";

const due = signingChargeForQuote({
  quoteId: "q",
  currency: "USD",
  lines: [
    { id: "a", kind: "legal_fee", charge_at: "signing", selection: "included", selected: true, quantity: 1, unit_amount_cents: 480000 },
    { id: "b", kind: "government_fee", charge_at: "filing", selection: "included", selected: true, quantity: 2, unit_amount_cents: 35000 },
  ],
});
const nothingDue = signingChargeForQuote({
  quoteId: "q",
  currency: "USD",
  lines: [{ id: "b", kind: "government_fee", charge_at: "filing", selection: "included", selected: true, quantity: 1, unit_amount_cents: 35000 }],
});
const ok = (rows: PaymentsRead extends infer R ? (R extends { rows: infer X } ? X : never) : never): PaymentsRead => ({ status: "ok", rows });

describe("public payment state machine", () => {
  it("a failed payments read is unavailable — never 'unpaid', never a form", () => {
    expect(settledPaymentState({ status: "unavailable" }, due)).toEqual({ status: "unavailable" });
  });

  it("nothing recorded + firm set up → payable, for the snapshot's due-at-signing (no USPTO fees)", () => {
    expect(settledPaymentState(ok([]), due)).toBeNull();
    expect(cardPaymentState(due, { status: "ok", publicKey: "pk" })).toEqual({ status: "payable", amountCents: 480000, currency: "USD", publicKey: "pk" });
  });

  it("firm not connected / no operating account → manual; setup unreadable → unavailable", () => {
    expect(cardPaymentState(due, { status: "unconfigured" })).toEqual({ status: "manual", nothingDue: false });
    expect(cardPaymentState(due, { status: "unavailable" })).toEqual({ status: "unavailable" });
  });

  it("everything due at filing → manual/nothingDue, no card form", () => {
    expect(settledPaymentState(ok([]), nothingDue)).toEqual({ status: "manual", nothingDue: true });
  });

  it("no readable snapshot → manual", () => {
    expect(settledPaymentState(ok([]), null)).toEqual({ status: "manual", nothingDue: false });
  });

  it("a pending LawPay attempt → confirming (never a second form)", () => {
    expect(settledPaymentState(ok([{ purpose: "legal_fee", provider: "lawpay", status: "pending", amount_cents: 480000, currency: "USD" }]), due)).toEqual({ status: "confirming" });
  });

  it("a pending MANUAL row does not block the client", () => {
    expect(settledPaymentState(ok([{ purpose: "legal_fee", provider: "manual", status: "pending", amount_cents: 100, currency: "USD" }]), due)).toBeNull();
  });

  it("a failed attempt leaves the quote payable again (another card)", () => {
    expect(settledPaymentState(ok([{ purpose: "legal_fee", provider: "lawpay", status: "failed", amount_cents: 480000, currency: "USD" }]), due)).toBeNull();
  });

  it("a card charge that succeeded is received via card, fully", () => {
    expect(settledPaymentState(ok([{ purpose: "legal_fee", provider: "lawpay", status: "succeeded", amount_cents: 480000, currency: "USD" }]), due)).toEqual({
      status: "received",
      via: "card",
      receivedCents: 480000,
      currency: "USD",
      outstandingCents: 0,
    });
  });

  it("a MANUAL payment is 'recorded', never 'on your card' (runbook defect 2)", () => {
    const s = settledPaymentState(ok([{ purpose: "legal_fee", provider: "manual", status: "succeeded", amount_cents: 480000, currency: "USD" }]), due);
    expect(s).toMatchObject({ status: "received", via: "recorded" });
  });

  it("a PARTIAL manual payment names the balance instead of reading as settled (runbook defect 2)", () => {
    const s = settledPaymentState(ok([{ purpose: "legal_fee", provider: "manual", status: "succeeded", amount_cents: 100000, currency: "USD" }]), due);
    expect(s).toMatchObject({ status: "received", via: "recorded", receivedCents: 100000, outstandingCents: 380000 });
  });

  it("a payment in another currency can't be compared, so outstanding is unknown (null)", () => {
    const s = settledPaymentState(ok([{ purpose: "legal_fee", provider: "manual", status: "succeeded", amount_cents: 100000, currency: "EUR" }]), due);
    expect(s).toMatchObject({ status: "received", outstandingCents: null });
  });

  it("government-fee payments don't count toward the signing amount", () => {
    expect(settledPaymentState(ok([{ purpose: "government_fee", provider: "manual", status: "succeeded", amount_cents: 70000, currency: "USD" }]), due)).toBeNull();
  });
});

describe("after a pay attempt", () => {
  it("only a decline offers the form again", () => {
    expect(retryPolicy("declined")).toBe("retry");
    expect(retryPolicy("indeterminate")).toBe("close_indeterminate");
    expect(retryPolicy("charged_unrecorded")).toBe("close_indeterminate");
    expect(retryPolicy("rejected")).toBe("close_no_retry");
    expect(retryPolicy("manual")).toBe("close_no_retry");
    expect(retryPolicy("already_paid")).toBe("refresh");
    expect(retryPolicy("awaiting_confirmation")).toBe("refresh");
  });

  it("a rejection never repeats the provider's words and never suggests another card", () => {
    const m = payMessage("rejected", "Merchant account acct_123 is not active.", "Hartwell IP");
    expect(m).not.toContain("acct_123");
    expect(m).not.toMatch(/another card/);
    expect(payMessage("declined", "Insufficient funds", "X")).toContain("Insufficient funds. Nothing has been charged");
  });
});
