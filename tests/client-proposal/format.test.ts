import { describe, expect, it } from "vitest";
import { brandForSlug, formatCivilDate, money, paragraphs, richSegments, safeHttpsUrl } from "@/components/client-proposal/format";

describe("richSegments", () => {
  it("parses **bold** and leaves the rest as plain text", () => {
    expect(richSegments("**A note from Rebecca.** Both are included.")).toEqual([
      { bold: true, text: "A note from Rebecca." },
      { bold: false, text: " Both are included." },
    ]);
  });

  it("never produces markup: HTML stays literal text, including inside bold", () => {
    const evil = '<img src=x onerror=alert(1)> **<script>alert(1)</script>** & "quotes"';
    const segments = richSegments(evil);
    // Every segment is a plain {bold,text} pair; React renders `text` as a text node.
    expect(segments.every((s) => Object.keys(s).sort().join() === "bold,text")).toBe(true);
    expect(segments.map((s) => s.text).join("")).toBe('<img src=x onerror=alert(1)> <script>alert(1)</script> & "quotes"');
    expect(segments.find((s) => s.bold)?.text).toBe("<script>alert(1)</script>");
  });

  it("treats an unmatched or empty ** as text", () => {
    expect(richSegments("a ** b")).toEqual([{ bold: false, text: "a ** b" }]);
    expect(richSegments("****")).toEqual([{ bold: false, text: "****" }]);
    expect(richSegments("**open")).toEqual([{ bold: false, text: "**open" }]);
  });

  it("is total on non-strings", () => {
    expect(richSegments(undefined)).toEqual([]);
    expect(richSegments(42)).toEqual([]);
  });
});

describe("money", () => {
  it("formats whole dollars without cents and others with", () => {
    expect(money(495_000)).toBe("$4,950");
    expect(money(0)).toBe("$0");
    expect(money(330_000)).toBe("$3,300");
    expect(money(1_050)).toBe("$10.50");
    expect(money(5)).toBe("$0.05");
  });
  it("uses a real minus for credits and zeroes unreadable numbers", () => {
    expect(money(-45_000)).toBe("−$450");
    expect(money(Number.NaN)).toBe("$0");
  });
});

describe("formatCivilDate", () => {
  it("names the day without a time zone moving it", () => {
    expect(formatCivilDate("2026-10-26")).toBe("Monday, October 26, 2026");
    expect(formatCivilDate("2026-12-31")).toBe("Thursday, December 31, 2026");
  });
  it("rejects nonsense", () => {
    expect(formatCivilDate("2026-02-31")).toBeNull();
    expect(formatCivilDate("soon")).toBeNull();
    expect(formatCivilDate(null)).toBeNull();
  });
});

describe("safeHttpsUrl", () => {
  it("accepts https only", () => {
    expect(safeHttpsUrl("https://app.lawmatics.com/forms/share/abc")).toBe("https://app.lawmatics.com/forms/share/abc");
    expect(safeHttpsUrl("http://example.com")).toBeNull();
    expect(safeHttpsUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpsUrl("")).toBeNull();
    expect(safeHttpsUrl(undefined)).toBeNull();
  });
});

describe("paragraphs / brandForSlug", () => {
  it("splits on blank lines", () => {
    expect(paragraphs("one\n\n two \n\n\nthree")).toEqual(["one", "two", "three"]);
  });
  it("only rpb-law gets the RPB brand", () => {
    expect(brandForSlug("rpb-law")).toBe("rpb");
    expect(brandForSlug("acme-ip")).toBe("neutral");
    expect(brandForSlug(undefined)).toBe("neutral");
  });
});
