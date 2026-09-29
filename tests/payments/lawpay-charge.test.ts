import { describe, it, expect, vi } from "vitest";
import { createLawPayChargeClient } from "@/lib/payments/lawpay";
import type { FetchLike } from "@/lib/payments/lawpay-oauth";
import { signingChargeForQuote, type ChargeableAmount } from "@/lib/payments/types";

/** Mocked HTTP only. NEVER a live charge. */

const amount = (() => {
  const r = signingChargeForQuote({
    quoteId: "q",
    currency: "USD",
    lines: [{ id: "a", kind: "legal_fee", charge_at: "signing", selection: "included", selected: true, quantity: 1, unit_amount_cents: 480000 }],
  });
  if (!r.ok) throw new Error("fixture");
  return r.amount as ChargeableAmount;
})();

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const client = (fetchImpl: unknown) => createLawPayChargeClient({ secretKey: "sk_test_x", apiBase: "https://gateway.test", fetchImpl: fetchImpl as FetchLike });

describe("LawPay charge client (mocked)", () => {
  it("sends Basic auth with the account's secret key, the explicit account_id and the reference", async () => {
    const f = respond(200, { id: "ch_1", status: "AUTHORIZED", account_id: "acct_op", amount: 480000 });
    const r = await client(f).charge({ amount, providerAccountId: "acct_op", methodToken: "tok_1", reference: "pay-1" });
    expect(r).toMatchObject({ outcome: "succeeded", chargeId: "ch_1" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://gateway.test/v1/charges");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("sk_test_x:").toString("base64")}`);
    expect(JSON.parse(String(init.body))).toEqual({ amount: 480000, method: "tok_1", account_id: "acct_op", reference: "pay-1" });
  });

  it("refuses to send without an account id (the gateway would pick trust or operating)", async () => {
    const f = respond(200, {});
    await expect(client(f).charge({ amount, providerAccountId: " ", methodToken: "tok" })).rejects.toThrow(/account_id/);
    expect(f).not.toHaveBeenCalled();
  });

  it("402 is a card decline with the provider's words", async () => {
    const r = await client(respond(402, { messages: [{ message: "Card declined" }] })).charge({ amount, providerAccountId: "a", methodToken: "t" });
    expect(r).toMatchObject({ outcome: "failed", failure: "card", clientDetail: "Card declined" });
  });

  it("5xx and 429 are UNKNOWN, never a decline (runbook defect 5)", async () => {
    for (const status of [500, 502, 504, 429, 408]) {
      const r = await client(respond(status, {})).charge({ amount, providerAccountId: "a", methodToken: "t" });
      expect(r.outcome).toBe("unknown");
    }
  });

  it("a network failure is unknown, not failed", async () => {
    const f = vi.fn(async () => {
      throw new Error("socket hang up");
    });
    const r = await client(f).charge({ amount, providerAccountId: "a", methodToken: "t" });
    expect(r.outcome).toBe("unknown");
  });

  it("401 is a request failure that flags the credential, with no client-facing words", async () => {
    const r = await client(respond(401, { message: "Invalid API key" })).charge({ amount, providerAccountId: "a", methodToken: "t" });
    expect(r).toMatchObject({ outcome: "failed", failure: "request", credentialRejected: true });
    expect((r as { clientDetail?: string }).clientDetail).toBeUndefined();
  });

  it("a 2xx VOIDED is a request failure with no clientDetail (body may name the merchant)", async () => {
    const r = await client(respond(200, { id: "ch", status: "VOIDED", message: "Merchant account acct_x is not active." })).charge({ amount, providerAccountId: "a", methodToken: "t" });
    expect(r).toMatchObject({ outcome: "failed", failure: "request" });
    expect((r as { clientDetail?: string }).clientDetail).toBeUndefined();
  });

  it("an unrecognised status or a success with no charge id is unknown", async () => {
    expect((await client(respond(200, { id: "ch", status: "WEIRD" })).charge({ amount, providerAccountId: "a", methodToken: "t" })).outcome).toBe("unknown");
    expect((await client(respond(200, { status: "AUTHORIZED" })).charge({ amount, providerAccountId: "a", methodToken: "t" })).outcome).toBe("unknown");
  });
});
