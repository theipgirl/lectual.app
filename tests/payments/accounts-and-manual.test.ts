import { describe, it, expect } from "vitest";
import { accountFitsKind, candidateAccounts, checkMappingRequest, parseStoredAccounts } from "@/lib/payments/lawpay-accounts";
import { checkManualPayment, firmPaymentSummary } from "@/lib/payments/manual";
import type { LawPayAccount } from "@/lib/payments/lawpay-oauth";

const accounts: LawPayAccount[] = [
  { id: "op1", name: "Operating", type: "MerchantAccount", trust_account: false, mode: "test", public_key: "pk1", currency: "USD" },
  { id: "op2", name: "Second operating", type: "AchAccount", trust_account: false, mode: "test", public_key: "pk2", currency: "USD" },
  { id: "tr1", name: "IOLTA", type: "MerchantAccount", trust_account: true, mode: "test", public_key: "pk3", currency: "USD" },
  { id: "live1", name: "Live op", type: "MerchantAccount", trust_account: false, mode: "live", public_key: "pk4", currency: "USD" },
];

describe("mapping a LawPay account — the kind is explicit and never inferred", () => {
  const base = { accounts, mode: "test" as const, otherKindAccountId: null, confirmed: "yes" };

  it("requires the kind", () => {
    expect(checkMappingRequest({ ...base, kind: undefined, accountId: "op1" })).toMatchObject({ ok: false });
    expect(checkMappingRequest({ ...base, kind: "", accountId: "op1" })).toMatchObject({ ok: false });
    expect(checkMappingRequest({ ...base, kind: "primary", accountId: "op1" })).toMatchObject({ ok: false });
  });

  it("an IOLTA account can't be operating, and a non-trust account can't be trust", () => {
    expect(checkMappingRequest({ ...base, kind: "operating", accountId: "tr1" })).toMatchObject({ ok: false, reason: expect.stringMatching(/trust/) });
    expect(checkMappingRequest({ ...base, kind: "trust", accountId: "op1" })).toMatchObject({ ok: false });
  });

  it("refuses a live account on a test connection, an unknown id, and one account for both roles", () => {
    expect(checkMappingRequest({ ...base, kind: "operating", accountId: "live1" })).toMatchObject({ ok: false });
    expect(checkMappingRequest({ ...base, kind: "operating", accountId: "typed-by-hand" })).toMatchObject({ ok: false });
    expect(checkMappingRequest({ ...base, kind: "operating", accountId: "op1", otherKindAccountId: "op1" })).toMatchObject({ ok: false });
  });

  it("requires the admin's confirmation", () => {
    expect(checkMappingRequest({ ...base, confirmed: null, kind: "operating", accountId: "op1" })).toMatchObject({ ok: false });
  });

  it("accepts the right pairings", () => {
    expect(checkMappingRequest({ ...base, kind: "operating", accountId: "op2" })).toMatchObject({ ok: true });
    expect(checkMappingRequest({ ...base, kind: "trust", accountId: "tr1" })).toMatchObject({ ok: true });
  });

  it("offers only in-mode accounts whose trust flag matches — and there can be several, so none is preselected", () => {
    expect(candidateAccounts(accounts, "operating", "test").map((a) => a.id)).toEqual(["op1", "op2"]);
    expect(candidateAccounts(accounts, "trust", "test").map((a) => a.id)).toEqual(["tr1"]);
    expect(accountFitsKind(accounts[0], "operating", "live")).toBe(false);
  });

  it("parses stored accounts defensively", () => {
    expect(parseStoredAccounts([{ id: "x", type: "MerchantAccount", trust_account: "yes", mode: "test" }, "junk", null])).toEqual([]);
    expect(parseStoredAccounts(accounts)).toHaveLength(4);
  });
});

describe("Record a payment (manual)", () => {
  it("the account kind is required, with no default", () => {
    expect(checkManualPayment({ amount: "100", purpose: "legal_fee", accountKind: undefined })).toMatchObject({ ok: false });
    expect(checkManualPayment({ amount: "100", purpose: "legal_fee", accountKind: "" })).toMatchObject({ ok: false });
  });

  it("an earned legal fee can't be recorded into trust", () => {
    expect(checkManualPayment({ amount: "100", purpose: "legal_fee", accountKind: "trust" })).toMatchObject({ ok: false });
    expect(checkManualPayment({ amount: "100", purpose: "other", accountKind: "trust" })).toMatchObject({ ok: true });
  });

  it("parses dollars exactly and refuses nonsense", () => {
    expect(checkManualPayment({ amount: "1,250.50", purpose: "legal_fee", accountKind: "operating" })).toMatchObject({ ok: true, payment: { amountCents: 125050 } });
    for (const amount of ["", "0", "-5", "abc", "1.005"]) {
      expect(checkManualPayment({ amount, purpose: "legal_fee", accountKind: "operating" }).ok).toBe(false);
    }
    expect(checkManualPayment({ amount: "10", purpose: "tip", accountKind: "operating" }).ok).toBe(false);
  });

  it("refuses a date in the future", () => {
    const now = new Date("2026-09-27T12:00:00Z");
    expect(checkManualPayment({ amount: "10", purpose: "expense", accountKind: "operating", occurredOn: "2026-12-01" }, now).ok).toBe(false);
    expect(checkManualPayment({ amount: "10", purpose: "expense", accountKind: "operating", occurredOn: "2026-09-20" }, now)).toMatchObject({ ok: true });
  });
});

describe("firm payment summary", () => {
  it("names part payments, pending attempts and card vs recorded", () => {
    expect(firmPaymentSummary([], null)).toEqual({ status: "not_signed" });
    expect(firmPaymentSummary([], 480000)).toEqual({ status: "unpaid", dueCents: 480000 });
    expect(firmPaymentSummary([{ purpose: "legal_fee", provider: "manual", status: "succeeded", amount_cents: 1000 }], 480000)).toEqual({ status: "part_paid", receivedCents: 1000, dueCents: 480000 });
    expect(firmPaymentSummary([{ purpose: "legal_fee", provider: "lawpay", status: "succeeded", amount_cents: 480000 }], 480000)).toMatchObject({ status: "paid", via: "card" });
    expect(firmPaymentSummary([{ purpose: "legal_fee", provider: "lawpay", status: "pending", amount_cents: 480000 }], 480000)).toMatchObject({ status: "needs_reconciling" });
    expect(firmPaymentSummary([], 0)).toEqual({ status: "nothing_due" });
  });
});
