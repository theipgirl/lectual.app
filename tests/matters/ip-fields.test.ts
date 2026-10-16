import { describe, it, expect } from "vitest";
import {
  blankToNull,
  filingBasisLabel,
  formatCivilDate,
  formatInternationalClasses,
  isFilingBasis,
  parseCivilDate,
  parseInternationalClasses,
} from "@/lib/matters/ip-fields";
import {
  MATTER_STATUSES,
  isMatterStatus,
  matterStatusLabel,
  matterStatusOptions,
} from "@/lib/matters/status";

// Pure modules — no DB, so this suite always runs.

describe("parseInternationalClasses", () => {
  it("parses commas, spaces, and semicolons alike", () => {
    expect(parseInternationalClasses("9, 25 35;41")).toEqual([9, 25, 35, 41]);
  });

  it("sorts and de-duplicates", () => {
    expect(parseInternationalClasses("35, 9, 35")).toEqual([9, 35]);
  });

  it("accepts zero-padded class numbers as filed", () => {
    expect(parseInternationalClasses("009, 025")).toEqual([9, 25]);
  });

  it("returns null for blank input — an empty array is not 'no classes'", () => {
    expect(parseInternationalClasses("")).toBeNull();
    expect(parseInternationalClasses("   ")).toBeNull();
    expect(parseInternationalClasses(null)).toBeNull();
    expect(parseInternationalClasses(undefined)).toBeNull();
  });

  it("throws rather than silently dropping something the attorney typed", () => {
    expect(() => parseInternationalClasses("9, apparel")).toThrow(/not an international class/i);
    expect(() => parseInternationalClasses("0")).toThrow(/out of range/i);
    expect(() => parseInternationalClasses("46")).toThrow(/out of range/i);
    expect(() => parseInternationalClasses("9.5")).toThrow();
  });

  it("accepts both ends of the Nice range", () => {
    expect(parseInternationalClasses("1, 45")).toEqual([1, 45]);
  });
});

describe("formatInternationalClasses", () => {
  it("round-trips through the parser", () => {
    const parsed = parseInternationalClasses("35, 9, 41");
    expect(formatInternationalClasses(parsed)).toBe("9, 35, 41");
    expect(parseInternationalClasses(formatInternationalClasses(parsed))).toEqual(parsed);
  });

  it("renders nothing at all when there are no classes", () => {
    expect(formatInternationalClasses(null)).toBe("");
    expect(formatInternationalClasses([])).toBe("");
  });
});

describe("blankToNull", () => {
  it("turns an empty or whitespace-only field into null, and trims the rest", () => {
    expect(blankToNull("")).toBeNull();
    expect(blankToNull("   ")).toBeNull();
    expect(blankToNull(null)).toBeNull();
    expect(blankToNull("  88123456 ")).toBe("88123456");
  });
});

describe("parseCivilDate", () => {
  it("accepts a browser date value", () => {
    expect(parseCivilDate("2026-08-09")).toBe("2026-08-09");
  });

  it("treats a blank field as 'not recorded'", () => {
    expect(parseCivilDate("")).toBeNull();
    expect(parseCivilDate(null)).toBeNull();
  });

  it("rejects a hand-crafted or impossible value", () => {
    expect(() => parseCivilDate("09/08/2026")).toThrow(/valid date/i);
    expect(() => parseCivilDate("2026-02-30")).toThrow(/real calendar date/i);
    expect(() => parseCivilDate("2026-13-01")).toThrow();
  });
});

describe("formatCivilDate", () => {
  it("formats in UTC so a date column never shifts a day", () => {
    // A naive local render of 2026-01-01 lands on 31 Dec 2025 west of Greenwich.
    expect(formatCivilDate("2026-01-01")).toMatch(/2026/);
    expect(formatCivilDate("2026-01-01")).not.toMatch(/2025/);
  });

  it("returns null (not a placeholder) for an absent or malformed value", () => {
    expect(formatCivilDate(null)).toBeNull();
    expect(formatCivilDate("")).toBeNull();
    expect(formatCivilDate("soon")).toBeNull();
  });
});

describe("filing basis", () => {
  it("recognises exactly the five statutory bases", () => {
    for (const basis of ["1a", "1b", "44d", "44e", "66a"]) {
      expect(isFilingBasis(basis)).toBe(true);
    }
    expect(isFilingBasis("1c")).toBe(false);
    expect(isFilingBasis("")).toBe(false);
  });

  it("labels name the statute", () => {
    expect(filingBasisLabel("1a")).toMatch(/1\(a\)/);
    expect(filingBasisLabel("1b")).toMatch(/1\(b\)/);
    expect(filingBasisLabel("66a")).toMatch(/66\(a\)/);
  });

  it("has no label for an unrecorded basis — the field stays empty", () => {
    expect(filingBasisLabel(null)).toBeNull();
    expect(filingBasisLabel(undefined)).toBeNull();
  });
});

describe("matter status vocabulary", () => {
  it("is the lifecycle only — prosecution state is not in it", () => {
    expect(MATTER_STATUSES).toEqual(["open", "on_hold", "closed"]);
    expect(isMatterStatus("registered")).toBe(false);
    expect(isMatterStatus("abandoned")).toBe(false);
  });

  it("labels the vocabulary and humanizes a legacy value rather than dropping it", () => {
    expect(matterStatusLabel("on_hold")).toBe("On hold");
    expect(matterStatusLabel("archived_2024")).toBe("archived 2024");
  });

  it("always offers the full vocabulary, with legacy values appended", () => {
    expect(matterStatusOptions([])).toEqual(["open", "on_hold", "closed"]);
    expect(matterStatusOptions(["open", "weird"])).toEqual([
      "open",
      "on_hold",
      "closed",
      "weird",
    ]);
  });
});
