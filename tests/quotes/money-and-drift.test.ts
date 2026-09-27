import { describe, it, expect } from "vitest";
import { centsToInput, formatCents, parseDollarsToCents } from "@/lib/quotes/money";
import { describeLineDrift } from "@/lib/quotes/drift";
import { endOfFirmDay, firmCivilDate } from "@/lib/quotes/firm-time";
import { chargeAtOptionsFor, expiryInputValue, quoteStatusTone } from "@/lib/quotes/labels";
import type { QuoteLineRow } from "@/lib/quotes/types";

/**
 * Pure helpers the quote surfaces share. The money pair replaces the three
 * copies lectual carried per rendering slice; the drift sentences moved out of
 * a component so they can be tested without rendering (the cases are lectual's
 * `quote-signed-copy.test.ts` "describeLineDrift" block).
 */

describe("parseDollarsToCents — string arithmetic, never a float multiply", () => {
  it("reads the shapes people type", () => {
    expect(parseDollarsToCents("1250")).toBe(125_000);
    expect(parseDollarsToCents("1,250.5")).toBe(125_050);
    expect(parseDollarsToCents("$0.00")).toBe(0);
    expect(parseDollarsToCents(" 12.34 ")).toBe(1_234);
  });

  it("is exact where a float multiply is not", () => {
    // 1.005 * 100 === 100.49999999999999 in JS; 10.05 * 100 === 1004.9999999999999.
    expect(parseDollarsToCents("10.05")).toBe(1_005);
    expect(parseDollarsToCents("0.29")).toBe(29);
  });

  it("refuses what is not an amount rather than guessing", () => {
    for (const bad of ["", "abc", "1.005", "1e3", "12.", ".5", "--1"]) {
      expect(parseDollarsToCents(bad), bad).toBeNull();
    }
  });
});

describe("formatCents and centsToInput", () => {
  it("formats integer cents as currency, sign kept on a discount", () => {
    expect(formatCents(475_000)).toBe("$4,750.00");
    expect(formatCents(-50_000)).toBe("-$500.00");
    expect(formatCents(Number.NaN)).toBe("—");
  });

  it("pre-fills a form with the magnitude only", () => {
    expect(centsToInput(125_050)).toBe("1250.50");
    expect(centsToInput(-50_000)).toBe("500.00");
    expect(centsToInput(7)).toBe("0.07");
  });

  it("round-trips through the parser", () => {
    for (const cents of [0, 1, 99, 100, 125_050, 99_999_99]) {
      expect(parseDollarsToCents(centsToInput(cents))).toBe(cents);
    }
  });
});

describe("the firm's calendar, not the server's", () => {
  it("closes a proposal at the END of the firm's day, across DST", () => {
    expect(endOfFirmDay("2026-09-30")).toBe("2026-10-01T03:59:59.000Z"); // EDT
    expect(endOfFirmDay("2026-12-15")).toBe("2026-12-16T04:59:59.000Z"); // EST
    expect(firmCivilDate(new Date(endOfFirmDay("2026-09-30")!))).toBe("2026-09-30");
  });

  it("refuses a date that does not exist", () => {
    expect(endOfFirmDay("2026-02-30")).toBeNull();
    expect(endOfFirmDay("30/09/2026")).toBeNull();
  });

  it("shows a stored expiry back in the date field as the firm's date", () => {
    expect(expiryInputValue("2026-10-01T03:59:59.000Z")).toBe("2026-09-30");
    expect(expiryInputValue(null)).toBe("");
  });
});

describe("§0 in the UI: a government fee is never offered 'at signing'", () => {
  it("drops signing for a government fee and only for it", () => {
    expect(chargeAtOptionsFor("government_fee")).toEqual(["filing", "not_charged"]);
    expect(chargeAtOptionsFor("legal_fee")).toContain("signing");
  });

  it("gives declined and withdrawn different tones — different facts", () => {
    expect(quoteStatusTone("declined")).not.toBe(quoteStatusTone("withdrawn"));
    expect(quoteStatusTone("something-new")).toBe("lx-pill-mute");
  });
});

describe("describeLineDrift: what the live rows say that the signed record does not", () => {
  const signedLine = {
    id: "l-1",
    kind: "legal_fee",
    charge_at: "signing",
    selection: "included",
    tier_group: null,
    selected: true,
    label: "Search and opinion",
    description: null,
    quantity: 1,
    unit_amount_cents: 450000,
    amount_cents: 450000,
  };

  function live(overrides: Partial<Record<keyof QuoteLineRow, unknown>> = {}): QuoteLineRow {
    return {
      id: "l-1",
      org_id: "org-1",
      quote_id: "q-1",
      kind: "legal_fee",
      charge_at: "signing",
      selection: "included",
      tier_group: null,
      selected: true,
      label: "Search and opinion",
      description: null,
      quantity: 1,
      unit_amount_cents: 450000,
      source_service_item_id: null,
      sort_index: 0,
      created_at: "2026-09-01T12:00:00.000Z",
      updated_at: "2026-09-06T12:00:00.000Z",
      ...overrides,
    } as QuoteLineRow;
  }

  it("reports nothing when the live row still matches", () => {
    expect(describeLineDrift([signedLine], [live()])).toEqual([]);
  });

  it("does not invent a change from a wire-loose number", () => {
    expect(describeLineDrift([signedLine], [live({ unit_amount_cents: "450000", quantity: "1" })])).toEqual([]);
  });

  it("reports a re-price, a deletion and an addition by name", () => {
    expect(describeLineDrift([signedLine], [live({ unit_amount_cents: 900000 })])).toEqual([
      "“Search and opinion” was signed at $4,500.00 and is now $9,000.00.",
    ]);
    const entries = describeLineDrift([signedLine], [live({ id: "l-9", label: "Rush fee" })]);
    expect(entries).toContain("“Search and opinion” has been deleted from the quote since it was signed.");
    expect(entries).toContain("“Rush fee” was added to the quote after it was signed.");
  });

  it("does not call a package or add-on the firm withheld an addition — it was never offered", () => {
    // Withheld lines are not in the signed record (only the OFFER is), and
    // their `selected: false` says so.
    expect(describeLineDrift([signedLine], [live(), live({ id: "l-7", label: "Budget search", selection: "tier_option", tier_group: "Budget", selected: false })])).toEqual([]);
    // An offered line that appears afterwards still is one.
    expect(describeLineDrift([signedLine], [live(), live({ id: "l-8", label: "Rush", selection: "optional", selected: true })])).toEqual([
      "“Rush” was added to the quote after it was signed.",
    ]);
  });

  it("does not report `selected` as drift — before signature it was the firm's offer, not the agreement", () => {
    const signed = { ...signedLine, selection: "optional", selected: false };
    expect(describeLineDrift([signed], [live({ selection: "optional", selected: true })])).toEqual([]);
  });
});
