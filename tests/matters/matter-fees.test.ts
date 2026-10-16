import { describe, it, expect } from "vitest";
import {
  FEE_KINDS,
  balanceIsOutstanding,
  hasFeeEntries,
  latestFeeEntries,
  parseFeeActivity,
  type FeeActivityLike,
} from "@/lib/matters/fees";

// Pure helpers only — no DB, so this suite always runs.

const row = (payload: unknown, created_at = "2026-08-01T00:00:00Z"): FeeActivityLike => ({
  created_at,
  payload,
});

describe("parseFeeActivity", () => {
  it("reads a tracker fee block verbatim", () => {
    const entry = parseFeeActivity(
      row({
        source: "tracker-import",
        kind: "legal_fee",
        total: "$4,750",
        paid: "$2,375",
        balance: "$2,375",
        due_date: "2026-09-15",
        source_hash: "abc",
      }),
    );
    expect(entry).toEqual({
      kind: "legal_fee",
      total: "$4,750",
      paid: "$2,375",
      balance: "$2,375",
      dueDate: "2026-09-15",
      recordedAt: "2026-08-01T00:00:00Z",
    });
  });

  it("keeps the string exactly as written — no reformatting, no recomputation", () => {
    const entry = parseFeeActivity(
      row({ source: "tracker-import", kind: "filing_fee", total: "$1,050.00", paid: "$0.00", balance: "$1,050.00" }),
    );
    // Not 1050, not "$1,050", not a balance derived from total - paid.
    expect(entry?.total).toBe("$1,050.00");
    expect(entry?.balance).toBe("$1,050.00");
  });

  it("survives a block missing keys — absent amounts read as null, never zero", () => {
    const entry = parseFeeActivity(row({ source: "tracker-import", kind: "legal_fee", total: "$500" }));
    expect(entry).toMatchObject({ kind: "legal_fee", total: "$500", paid: null, balance: null, dueDate: null });
  });

  it("ignores blank strings and non-scalar amounts rather than showing them", () => {
    const entry = parseFeeActivity(
      row({ source: "tracker-import", kind: "legal_fee", total: "   ", paid: { amount: 1 }, balance: true }),
    );
    expect(entry).toMatchObject({ total: null, paid: null, balance: null });
  });

  it("accepts a numeric amount without formatting it", () => {
    const entry = parseFeeActivity(row({ source: "tracker-import", kind: "filing_fee", total: 350 }));
    expect(entry?.total).toBe("350");
  });

  it("tolerates extra keys the card has no cell for", () => {
    const entry = parseFeeActivity(
      row({ source: "tracker-import", kind: "legal_fee", total: "$1", currency: "USD", invoice: "INV-9" }),
    );
    expect(entry?.kind).toBe("legal_fee");
  });

  it("rejects rows that are not tracker fee entries", () => {
    expect(parseFeeActivity(row({ source: "tracker-import", kind: "tracker_meta", entity: "Acme" }))).toBeNull();
    expect(parseFeeActivity(row({ source: "manual", kind: "legal_fee", total: "$1" }))).toBeNull();
    expect(parseFeeActivity(row({ kind: "legal_fee", total: "$1" }))).toBeNull();
    expect(parseFeeActivity(row(null))).toBeNull();
    expect(parseFeeActivity(row("legal_fee"))).toBeNull();
    expect(parseFeeActivity(row([{ source: "tracker-import", kind: "legal_fee" }]))).toBeNull();
    expect(parseFeeActivity({})).toBeNull();
  });
});

describe("latestFeeEntries", () => {
  const legal = (total: string, at: string) =>
    row({ source: "tracker-import", kind: "legal_fee", total }, at);

  it("returns the latest entry per kind", () => {
    const ledger = latestFeeEntries([
      legal("$100", "2026-01-01T00:00:00Z"),
      legal("$200", "2026-03-01T00:00:00Z"),
      legal("$150", "2026-02-01T00:00:00Z"),
      row({ source: "tracker-import", kind: "filing_fee", total: "$350" }, "2026-01-05T00:00:00Z"),
    ]);
    expect(ledger.legal_fee?.total).toBe("$200");
    expect(ledger.filing_fee?.total).toBe("$350");
  });

  it("gives the same answer regardless of the order rows arrive in", () => {
    const rows = [legal("$100", "2026-01-01T00:00:00Z"), legal("$200", "2026-03-01T00:00:00Z")];
    expect(latestFeeEntries(rows).legal_fee?.total).toBe("$200");
    expect(latestFeeEntries([...rows].reverse()).legal_fee?.total).toBe("$200");
  });

  it("breaks a timestamp tie on insertion order (last row wins)", () => {
    const ledger = latestFeeEntries([legal("$100", "2026-01-01T00:00:00Z"), legal("$200", "2026-01-01T00:00:00Z")]);
    expect(ledger.legal_fee?.total).toBe("$200");
  });

  it("prefers a stamped row over an unstamped one, whichever way round they come", () => {
    const stamped = legal("$200", "2026-03-01T00:00:00Z");
    const unstamped: FeeActivityLike = { payload: { source: "tracker-import", kind: "legal_fee", total: "$1" } };
    expect(latestFeeEntries([unstamped, stamped]).legal_fee?.total).toBe("$200");
    expect(latestFeeEntries([stamped, unstamped]).legal_fee?.total).toBe("$200");
  });

  it("skips non-fee rows in a mixed timeline", () => {
    const ledger = latestFeeEntries([
      row({ source: "tracker-import", text: "Called client", kind: undefined }),
      row({ from_code: "18", to_code: "19A" }),
      legal("$100", "2026-01-01T00:00:00Z"),
    ]);
    expect(ledger.legal_fee?.total).toBe("$100");
    expect(ledger.filing_fee).toBeNull();
  });

  it("returns an empty ledger for no rows", () => {
    const ledger = latestFeeEntries([]);
    expect(FEE_KINDS.every((k) => ledger[k] === null)).toBe(true);
    expect(hasFeeEntries(ledger)).toBe(false);
  });
});

describe("hasFeeEntries", () => {
  it("is true as soon as either kind is recorded", () => {
    expect(hasFeeEntries(latestFeeEntries([row({ source: "tracker-import", kind: "filing_fee" })]))).toBe(true);
  });
});

describe("balanceIsOutstanding", () => {
  it("flags a positive balance as written by the firm", () => {
    expect(balanceIsOutstanding("$2,375")).toBe(true);
    expect(balanceIsOutstanding("2375.50")).toBe(true);
    expect(balanceIsOutstanding("USD 1,050.00")).toBe(true);
  });

  it("does not flag a settled or credited balance", () => {
    expect(balanceIsOutstanding("$0.00")).toBe(false);
    expect(balanceIsOutstanding("0")).toBe(false);
    expect(balanceIsOutstanding("-$50")).toBe(false);
    expect(balanceIsOutstanding("($50)")).toBe(false);
    expect(balanceIsOutstanding("50-")).toBe(false);
  });

  it("stays quiet when it cannot read the value at all", () => {
    expect(balanceIsOutstanding(null)).toBe(false);
    expect(balanceIsOutstanding("")).toBe(false);
    expect(balanceIsOutstanding("TBD")).toBe(false);
    expect(balanceIsOutstanding("$")).toBe(false);
    expect(balanceIsOutstanding(".")).toBe(false);
  });
});
