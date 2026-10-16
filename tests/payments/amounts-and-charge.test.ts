import { describe, it, expect, vi } from "vitest";
import { signingChargeForQuote, type ChargeableAmount } from "@/lib/payments/types";
import { chargeQuoteAtSigning, type PaymentWriteClient } from "@/lib/payments/registry";
import type { LawPayChargeClient } from "@/lib/payments/lawpay";
import type { OperatingPaymentAccount } from "@/lib/payments/accounts";

/**
 * NOTHING HERE TALKS TO LAWPAY. The charge client is a fake; every "charge" is
 * a call into a vi.fn(). No network, no card, no money.
 */

const SNAPSHOT_LINES = [
  { id: "a", kind: "legal_fee", charge_at: "signing", selection: "included", tier_group: null, selected: true, label: "Search", quantity: 1, unit_amount_cents: 150000 },
  { id: "b", kind: "legal_fee", charge_at: "signing", selection: "optional", tier_group: null, selected: true, label: "Add-on", quantity: 2, unit_amount_cents: 25000 },
  { id: "c", kind: "legal_fee", charge_at: "signing", selection: "optional", tier_group: null, selected: false, label: "Not taken", quantity: 1, unit_amount_cents: 99900 },
  { id: "d", kind: "government_fee", charge_at: "filing", selection: "included", tier_group: null, selected: true, label: "USPTO", quantity: 2, unit_amount_cents: 35000 },
];

describe("signingChargeForQuote — the amount comes from the signed snapshot's due-at-signing only", () => {
  it("sums only selected signing lines; USPTO fees are never in it", () => {
    const r = signingChargeForQuote({ quoteId: "q1", currency: "USD", lines: SNAPSHOT_LINES });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.amount.amountCents).toBe(200000);
      expect(r.amount.quoteId).toBe("q1");
    }
  });

  it("a government fee marked for signing blocks the charge instead of being swept in", () => {
    const lines = [...SNAPSHOT_LINES, { id: "e", kind: "government_fee", charge_at: "signing", selection: "included", selected: true, quantity: 1, unit_amount_cents: 35000 }];
    const r = signingChargeForQuote({ quoteId: "q1", currency: "USD", lines });
    expect(r.ok).toBe(false);
  });

  it("nothing due at signing is its own refusal (filing-only quote)", () => {
    const r = signingChargeForQuote({ quoteId: "q1", currency: "USD", lines: [SNAPSHOT_LINES[3]] });
    expect(r).toMatchObject({ ok: false, reason: "nothing_due_at_signing" });
  });

  it("refuses non-USD and an unchosen package", () => {
    expect(signingChargeForQuote({ quoteId: "q", currency: "EUR", lines: SNAPSHOT_LINES }).ok).toBe(false);
    const tier = [
      { id: "t1", kind: "legal_fee", charge_at: "signing", selection: "tier_option", tier_group: "Basic", selected: false, quantity: 1, unit_amount_cents: 1000 },
      { id: "t2", kind: "legal_fee", charge_at: "signing", selection: "tier_option", tier_group: "Premium", selected: false, quantity: 1, unit_amount_cents: 5000 },
    ];
    expect(signingChargeForQuote({ quoteId: "q", currency: "USD", lines: tier }).ok).toBe(false);
  });
});

type Call = { op: "insert" | "update"; values: Record<string, unknown>; at: number };

function fakeDb(opts: { insertError?: { code: string; message?: string }; updateError?: { message: string } } = {}) {
  const calls: Call[] = [];
  let clock = 0;
  const db: PaymentWriteClient = {
    from: () => ({
      insert: (values) => ({
        select: () => ({
          single: async () => {
            calls.push({ op: "insert", values, at: clock++ });
            return opts.insertError ? { data: null, error: opts.insertError } : { data: { id: "pay-1" }, error: null };
          },
        }),
      }),
      update: (values) => ({
        eq: async () => {
          calls.push({ op: "update", values, at: clock++ });
          return { error: opts.updateError ?? null };
        },
      }),
    }),
  };
  return { db, calls, tick: () => clock++ };
}

const operating = { provider: "lawpay", accountKind: "operating", providerAccountId: "acct_op", label: "Operating", verifiedAt: "2026-09-27T00:00:00Z" } as unknown as OperatingPaymentAccount;

function amountFor(quoteId = "q1"): ChargeableAmount {
  const r = signingChargeForQuote({ quoteId, currency: "USD", lines: SNAPSHOT_LINES });
  if (!r.ok) throw new Error("fixture");
  return r.amount;
}

describe("chargeQuoteAtSigning — pending row first, then exactly one charge", () => {
  it("writes the pending row BEFORE calling LawPay, to the operating account, and records success", async () => {
    const { db, calls, tick } = fakeDb();
    let chargedAt = -1;
    const client: LawPayChargeClient = {
      baseUrl: "x",
      charge: vi.fn(async (req) => {
        chargedAt = tick();
        expect(req.providerAccountId).toBe("acct_op");
        expect(req.amount.amountCents).toBe(200000);
        expect(req.reference).toBe("pay-1");
        return { outcome: "succeeded" as const, chargeId: "ch_1", accountId: "acct_op", amountCents: 200000, currency: "USD", providerStatus: "AUTHORIZED" };
      }),
    };
    const out = await chargeQuoteAtSigning({ db, orgId: "o1", quoteId: "q1", amount: amountFor(), account: operating, client, methodToken: "tok" });
    expect(out.status).toBe("succeeded");
    const insert = calls.find((c) => c.op === "insert")!;
    expect(insert.at).toBeLessThan(chargedAt);
    expect(insert.values).toMatchObject({ status: "pending", provider: "lawpay", account_kind: "operating", purpose: "legal_fee", amount_cents: 200000, provider_account_id: "acct_op" });
    expect(calls.find((c) => c.op === "update")!.values).toMatchObject({ status: "succeeded", provider_charge_id: "ch_1" });
  });

  it("a second attempt refused by the one-charge index (23505) never reaches LawPay", async () => {
    const { db } = fakeDb({ insertError: { code: "23505" } });
    const charge = vi.fn();
    const out = await chargeQuoteAtSigning({ db, orgId: "o1", quoteId: "q1", amount: amountFor(), account: operating, client: { baseUrl: "x", charge }, methodToken: "tok" });
    expect(out).toMatchObject({ status: "not_attempted", reason: "already_open" });
    expect(charge).not.toHaveBeenCalled();
  });

  it("a failed row write means no charge at all", async () => {
    const { db } = fakeDb({ insertError: { code: "XX000" } });
    const charge = vi.fn();
    const out = await chargeQuoteAtSigning({ db, orgId: "o1", quoteId: "q1", amount: amountFor(), account: operating, client: { baseUrl: "x", charge }, methodToken: "tok" });
    expect(out).toMatchObject({ status: "not_attempted", reason: "record_write_failed" });
    expect(charge).not.toHaveBeenCalled();
  });

  it("refuses an earned fee bound for a trust account before writing anything", async () => {
    const { db, calls } = fakeDb();
    const trust = { ...operating, accountKind: "trust" } as unknown as OperatingPaymentAccount;
    const charge = vi.fn();
    await expect(chargeQuoteAtSigning({ db, orgId: "o1", quoteId: "q1", amount: amountFor(), account: trust, client: { baseUrl: "x", charge }, methodToken: "tok" })).rejects.toThrow(/operating/);
    expect(calls).toHaveLength(0);
    expect(charge).not.toHaveBeenCalled();
  });

  it("refuses an amount computed for a different quote", async () => {
    const { db } = fakeDb();
    await expect(
      chargeQuoteAtSigning({ db, orgId: "o1", quoteId: "q1", amount: amountFor("other"), account: operating, client: { baseUrl: "x", charge: vi.fn() }, methodToken: "tok" }),
    ).rejects.toThrow(/another quote/);
  });

  it("an indeterminate answer leaves the row pending (no update, no retry)", async () => {
    const { db, calls } = fakeDb();
    const charge = vi.fn(async () => ({ outcome: "unknown" as const, detail: "timeout" }));
    const out = await chargeQuoteAtSigning({ db, orgId: "o1", quoteId: "q1", amount: amountFor(), account: operating, client: { baseUrl: "x", charge }, methodToken: "tok" });
    expect(out.status).toBe("indeterminate");
    expect(charge).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.op === "update")).toHaveLength(0);
  });

  it("a refusal before sending closes the row as failed so it can't block the quote forever", async () => {
    const { db, calls } = fakeDb();
    const charge = vi.fn(async () => {
      throw new Error("no token");
    });
    const out = await chargeQuoteAtSigning({ db, orgId: "o1", quoteId: "q1", amount: amountFor(), account: operating, client: { baseUrl: "x", charge }, methodToken: "tok" });
    expect(out).toMatchObject({ status: "not_attempted", reason: "refused_before_send" });
    expect(calls.find((c) => c.op === "update")!.values).toMatchObject({ status: "failed" });
  });

  it("a charge that succeeded but could not be recorded is loud, never 'paid'", async () => {
    const { db } = fakeDb({ updateError: { message: "boom" } });
    const charge = vi.fn(async () => ({ outcome: "succeeded" as const, chargeId: "ch", accountId: null, amountCents: null, currency: null, providerStatus: "AUTHORIZED" }));
    const out = await chargeQuoteAtSigning({ db, orgId: "o1", quoteId: "q1", amount: amountFor(), account: operating, client: { baseUrl: "x", charge }, methodToken: "tok" });
    expect(out.status).toBe("charged_unrecorded");
  });

  it("flags a gateway that reports a different account than the mapped one", async () => {
    const { db } = fakeDb();
    const charge = vi.fn(async () => ({ outcome: "succeeded" as const, chargeId: "ch", accountId: "acct_other", amountCents: 200000, currency: "USD", providerStatus: "AUTHORIZED" }));
    const out = await chargeQuoteAtSigning({ db, orgId: "o1", quoteId: "q1", amount: amountFor(), account: operating, client: { baseUrl: "x", charge }, methodToken: "tok" });
    expect(out).toMatchObject({ status: "succeeded", accountMismatch: true });
  });
});
