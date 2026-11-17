import { describe, expect, it } from "vitest";
import { quotedMark } from "@/lib/proposals/quoted-mark";
import { chosenPackagesText, packageLineTitle } from "@/lib/proposals/name-package";

describe("quotedMark", () => {
  it("wraps the trimmed name in typographic quotation marks", () => {
    expect(quotedMark("  LOVE AS INFRASTRUCTURE ")).toBe("“LOVE AS INFRASTRUCTURE”");
  });
  it("leaves a name that is already wrapped in straight or curly quotes", () => {
    for (const n of ['"The Pleat"', "“The Pleat”", "'The Pleat'", "‘The Pleat’"]) expect(quotedMark(n)).toBe(n);
  });
  it("a lone quote character is still wrapped, and an empty name stays empty", () => {
    expect(quotedMark('"')).toBe('“"”');
    expect(quotedMark("  ")).toBe("");
  });
  it("the shared package-line helper (staff page, Lawmatics note) stays unquoted", () => {
    expect(packageLineTitle({ name: "The Pleat", package: "Enhanced" })).toBe("The Pleat — Enhanced");
    expect(chosenPackagesText([{ name: "The Pleat", package: "Enhanced", included: true }])).toBe("The Pleat — Enhanced");
  });
});
