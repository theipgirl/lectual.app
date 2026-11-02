import { describe, expect, it } from "vitest";
import {
  cutShortLine,
  formatInvoiceNumber,
  invoiceTotals,
  isPastDue,
  normalizeInvoice,
  normalizeInvoices,
  statusWord,
} from "@/lib/billing/invoices";

const inv = (over: Record<string, unknown> = {}, prospect: string | null = "P1", id = String(Math.random())) => ({
  id,
  type: "invoice",
  attributes: {
    number: 1271,
    status: "sent",
    invoiced_at: "2026-10-01",
    due_at: "2026-10-31",
    voided_at: null,
    amount_cents: 100000,
    amount_paid_cents: 25000,
    outstanding_amount_cents: 75000,
    pdf_url: "https://files.example.com/i.pdf",
    ...over,
  },
  relationships: prospect === null ? {} : { prospect: { data: { id: prospect, type: "prospect" } } },
});

describe("normalizeInvoices", () => {
  it("drops invoices for another prospect or naming none", () => {
    const rows = normalizeInvoices([inv({}, "P1", "a"), inv({}, "P2", "b"), inv({}, null, "c")], "P1");
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });
  it("drops invoices with unreadable amounts, and duplicates", () => {
    const rows = normalizeInvoices([inv({ amount_cents: "10" }, "P1", "a"), inv({ amount_cents: 1.5 }, "P1", "b"), inv({}, "P1", "c"), inv({}, "P1", "c")], "P1");
    expect(rows.map((r) => r.id)).toEqual(["c"]);
  });
  it("sorts newest first", () => {
    const rows = normalizeInvoices(
      [inv({ invoiced_at: "2026-01-05", number: 1 }, "P1", "old"), inv({ invoiced_at: "2026-09-05", number: 5 }, "P1", "new"), inv({ invoiced_at: null, created_at: null }, "P1", "undated")],
      "P1",
    );
    expect(rows.map((r) => r.id)).toEqual(["new", "old", "undated"]);
  });
  it("falls back to created_at and computes outstanding from cents when absent", () => {
    const row = normalizeInvoice(inv({ invoiced_at: null, created_at: "2026-08-02T10:00:00Z", outstanding_amount_cents: undefined }) as never, "P1")!;
    expect(row.date).toBe("2026-08-02");
    expect(row.outstandingCents).toBe(75000);
  });
  it("keeps only an https pdf link", () => {
    expect(normalizeInvoice(inv({ pdf_url: "http://x.com/a.pdf" }) as never, "P1")!.pdfUrl).toBeNull();
    expect(normalizeInvoice(inv({ pdf_url: "javascript:alert(1)" }) as never, "P1")!.pdfUrl).toBeNull();
    expect(normalizeInvoice(inv() as never, "P1")!.pdfUrl).toMatch(/^https:/);
  });
  it("matches a numeric prospect id", () => {
    const rec = inv({}, "123");
    (rec.relationships as { prospect: { data: { id: unknown } } }).prospect.data.id = 123;
    expect(normalizeInvoice(rec as never, "123")).not.toBeNull();
  });
});

describe("words and numbers", () => {
  it("zero-pads to six", () => {
    expect(formatInvoiceNumber(1271)).toBe("001271");
    expect(formatInvoiceNumber(7)).toBe("000007");
    expect(formatInvoiceNumber(1234567)).toBe("1234567");
    expect(formatInvoiceNumber(null)).toBe("—");
  });
  it("names statuses, and void wins", () => {
    expect(statusWord({ status: "partially_paid", voided: false })).toBe("Partially paid");
    expect(statusWord({ status: "past_due", voided: false })).toBe("Past due");
    expect(statusWord({ status: "paid", voided: true })).toBe("Void");
    expect(statusWord({ status: "unknown", voided: false })).toBe("Status unknown");
    expect(isPastDue({ status: "past_due", voided: true })).toBe(false);
  });
  it("normalizes an unrecognised status to unknown", () => {
    expect(normalizeInvoice(inv({ status: "weird" }) as never, "P1")!.status).toBe("unknown");
  });
  it("words the cut-short line", () => {
    expect(cutShortLine(1)).toBe("Showing the first 1 invoice; Lawmatics didn't return them all.");
    expect(cutShortLine(40)).toBe("Showing the first 40 invoices; Lawmatics didn't return them all.");
  });
});

describe("invoiceTotals", () => {
  it("leaves void and draft out and adds integer cents", () => {
    const rows = normalizeInvoices(
      [
        inv({ amount_cents: 10, amount_paid_cents: 1, outstanding_amount_cents: 9 }, "P1", "a"),
        inv({ amount_cents: 20, amount_paid_cents: 20, outstanding_amount_cents: 0, status: "paid" }, "P1", "b"),
        inv({ amount_cents: 999, amount_paid_cents: 0, outstanding_amount_cents: 999, status: "draft" }, "P1", "c"),
        inv({ amount_cents: 888, amount_paid_cents: 0, outstanding_amount_cents: 888, voided_at: "2026-10-02" }, "P1", "d"),
      ],
      "P1",
    );
    expect(invoiceTotals(rows)).toEqual({ billedCents: 30, paidCents: 21, outstandingCents: 9, counted: 2 });
  });
  it("is zero for none", () => {
    expect(invoiceTotals([])).toEqual({ billedCents: 0, paidCents: 0, outstandingCents: 0, counted: 0 });
  });
});
