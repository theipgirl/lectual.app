import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/lawmatics/connection", async () => {
  class LawmaticsNotConnectedError extends Error {
    constructor() {
      super("x");
      this.name = "LawmaticsNotConnectedError";
    }
  }
  return { LawmaticsNotConnectedError, firmLawmaticsClient: vi.fn(async () => ({})) };
});

import { LawmaticsApiError, type LawmaticsClient, type ListResult } from "@/lib/lawmatics/client";
import { LawmaticsNotConnectedError } from "@/lib/lawmatics/connection";
import { loadMatterInvoices } from "@/lib/billing/load";
import { BillingCard } from "@/components/billing/BillingCard";

const inv = (id: string, prospect: string, over: Record<string, unknown> = {}) => ({
  id,
  attributes: { number: 1271, status: "sent", invoiced_at: "2026-10-01", voided_at: null, amount_cents: 150000, amount_paid_cents: 50000, outstanding_amount_cents: 100000, pdf_url: "https://x.example.com/a.pdf", ...over },
  relationships: { prospect: { data: { id: prospect } } },
});

const list = (records: unknown[], over: Partial<ListResult> = {}): ListResult => ({
  records: records as never,
  included: new Map(),
  pagesFetched: 1,
  truncated: false,
  includeDropped: false,
  ...over,
});

function deps(handler: (path: string, params: Record<string, string>) => ListResult | Error) {
  const calls: Array<{ path: string; params: Record<string, string> }> = [];
  const client: LawmaticsClient = {
    get: async () => {
      throw new Error("get must not be used");
    },
    listAll: async (path, opts) => {
      calls.push({ path, params: opts?.params ?? {} });
      const out = handler(path, opts?.params ?? {});
      if (out instanceof Error) throw out;
      return out;
    },
  };
  return { deps: { getClient: async () => client }, calls };
}

describe("loadMatterInvoices", () => {
  it("not linked: no Lawmatics call at all", async () => {
    const { deps: d, calls } = deps(() => list([]));
    for (const v of [null, undefined, "", "  "]) expect(await loadMatterInvoices(v, d)).toEqual({ status: "not-linked" });
    expect(calls).toHaveLength(0);
  });

  it("not connected", async () => {
    const d = { getClient: async () => Promise.reject(new LawmaticsNotConnectedError()) };
    expect(await loadMatterInvoices("P1", d)).toEqual({ status: "not-connected" });
  });

  it("couldn't read: 401, 429, timeout, other errors, unrecognised shape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const err of [new LawmaticsApiError(401, "/invoices", "secret body"), new LawmaticsApiError(429, "/invoices", "x"), new DOMException("t", "TimeoutError"), new Error("boom")]) {
      expect(await loadMatterInvoices("P1", deps(() => err).deps)).toEqual({ status: "unavailable" });
    }
    expect(await loadMatterInvoices("P1", deps(() => list([], { unrecognisedShape: true })).deps)).toEqual({ status: "unavailable" });
  });

  it("logs nothing about contents on failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await loadMatterInvoices("P1", deps(() => new LawmaticsApiError(500, "/invoices", "Jane Doe $1,500")).deps);
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/Jane|1,500/);
  });

  it("empty is ok with none", async () => {
    const r = await loadMatterInvoices("P1", deps(() => list([])).deps);
    expect(r).toMatchObject({ status: "ok", invoices: [] });
  });

  it("sends the filter but trusts only the invoice's own prospect", async () => {
    const { deps: d, calls } = deps(() => list([inv("a", "P1"), inv("b", "P2")]));
    const r = await loadMatterInvoices("P1", d);
    expect(calls[0]).toEqual({ path: "/invoices", params: { filter_by: "prospect_id", filter_on: "P1" } });
    expect(r.status === "ok" && r.invoices.map((i) => i.id)).toEqual(["a"]);
  });

  it("truncated is its own state", async () => {
    const r = await loadMatterInvoices("P1", deps(() => list([inv("a", "P1")], { truncated: true })).deps);
    expect(r).toMatchObject({ status: "cut-short" });
  });
});

describe("BillingCard", () => {
  const html = async (records: unknown[], over: Partial<ListResult> = {}) =>
    renderToStaticMarkup(<BillingCard read={await loadMatterInvoices("P1", deps(() => list(records, over)).deps)} />);

  it("renders ok rows with padded number, money, totals, PDF link", async () => {
    const out = await html([inv("a", "P1"), inv("d", "P1", { status: "draft", amount_cents: 5000, number: 2 })]);
    expect(out).toContain("#001271");
    expect(out).toContain("$1,500.00");
    expect(out).toContain("View PDF");
    expect(out).toContain("Billed $1,500.00");
    expect(out).toContain("Amounts include USPTO fees where invoiced.");
  });
  it("flags past due", async () => {
    expect(await html([inv("a", "P1", { status: "past_due" })])).toContain('data-past-due="true"');
  });
  it("renders each state's sentence", async () => {
    expect(await html([])).toContain("No invoices in Lawmatics for this matter.");
    expect(await html([inv("a", "P1")], { truncated: true })).toContain("Showing the first 1 invoice; Lawmatics didn&#x27;t return them all.");
    expect(renderToStaticMarkup(<BillingCard read={{ status: "not-linked" }} />)).toContain("isn&#x27;t linked to Lawmatics yet");
    expect(renderToStaticMarkup(<BillingCard read={{ status: "not-connected" }} />)).toContain("Connect Lawmatics in Settings → Integrations to see invoices.");
    expect(renderToStaticMarkup(<BillingCard read={{ status: "unavailable" }} />)).toContain("Invoices couldn&#x27;t be loaded from Lawmatics right now.");
  });
});
