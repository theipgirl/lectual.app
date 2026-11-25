import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMPLIMENTARY_LINE, HELD_SUFFIX, NONE_LINE, findListed, finalizeJudgment, packageLines } from "@/lib/consult-prep/judge/pricing";
import { AMOUNT_REMOVED, PACKAGE_NAME_REMOVED, makeScrubber } from "@/lib/consult-prep/judge/scrub";
import type { PackageJudgment } from "@/lib/consult-prep/judge/schemas";
import { DISPUTE_JUDGMENT, GENERAL_JUDGMENT, OTHER_PACKAGES, PACKAGES, TRADEMARK_JUDGMENT } from "./fixtures";

beforeEach(() => {
  vi.stubGlobal("fetch", () => {
    throw new Error("network is not allowed");
  });
});
afterEach(() => vi.unstubAllGlobals());

function pkg(over: Partial<PackageJudgment> = {}): PackageJudgment {
  return {
    choice: "Enhanced",
    reasoning: "Content creator with one priority mark.",
    classesToFileNow: [41, 35, 9],
    priorityClass: 41,
    pending: null,
    pdfMarks: [],
    ...over,
  };
}

function lines(p: PackageJudgment, o: { packages?: typeof PACKAGES; markConfirmed?: boolean; complimentary?: boolean; credit?: number | null; expiry?: string | null } = {}) {
  return packageLines(p, {
    markConfirmed: o.markConfirmed ?? true,
    packages: o.packages ?? PACKAGES,
    scrub: makeScrubber(false).scrub,
    complimentary: o.complimentary,
    consultCreditCents: o.credit === undefined ? 20_000 : o.credit,
    expiryLabel: o.expiry === undefined ? "October 29, 2026" : o.expiry,
  });
}

// A sign before OR after the number ("$1,950", "1950$"), any currency sign, full-width included.
const AMOUNT = /[$＄€£]\s?[\d０-９]|[\d０-９]\s?[$＄€£]/;
const WORD_AMOUNT = /\b\d[\d,. ]*\s?(USD|EUR|GBP|CAD|dollars|bucks|grand)\b/i;

describe("packageLines", () => {
  it("settled Enhanced with 3 classes renders the firm's price, included classes, add-on math, gov fee and credit", () => {
    const b = lines(pkg());
    expect(b.kind).toBe("settled");
    if (b.kind !== "settled") return;
    const text = b.lines.join("\n");
    expect(text).toContain("Enhanced — $3,250 legal fee, 2 classes included.");
    expect(text).toContain("Classes to file now: Class 41, Class 35, Class 9 (priority: Class 41).");
    expect(text).toContain("1 additional class × $825 = $825");
    expect(text).toContain("Government filing fees: 3 × $350 = $1,050 (separate, never discounted; $350 per class).");
    expect(text).toContain(
      "Consult credit: the $200 strategy-session fee is credited toward the legal fee if the client engages by October 29, 2026, once per proposal, and only if the fee cleared.",
    );
    expect(b.package.package).toBe("Enhanced");
  });

  it("every amount comes from the firm's list: another firm prints its own figures and nothing of the first", () => {
    const b = lines(pkg({ choice: "Premier Plus", classesToFileNow: [41, 35, 9, 25], priorityClass: 41 }), { packages: OTHER_PACKAGES, credit: 25_000, expiry: "November 1, 2026" });
    if (b.kind !== "settled") throw new Error("expected settled");
    const text = b.lines.join("\n");
    expect(text).toContain("Premier Plus — $4,100 legal fee, 3 classes included.");
    expect(text).toContain("1 additional class × $900 = $900");
    expect(text).toContain("4 × $400 = $1,600");
    expect(text).toContain("the $250 strategy-session fee");
    expect(text).toContain("by November 1, 2026");
    for (const old of ["1,950", "3,250", "4,950", "$825", "$350", "$200"]) expect(text).not.toContain(old);
    const allowed = new Set(["$4,100", "$900", "$400", "$1,600", "$250"]);
    for (const m of text.match(/\$[\d,]+/g) ?? []) expect(allowed.has(m), m).toBe(true);
  });

  it("finds the package by name, ignoring case; HELD, NONE and unknown names are not on the list", () => {
    expect(findListed(PACKAGES, " concierge ")?.package).toBe("Concierge");
    expect(findListed(PACKAGES, "HELD")).toBeNull();
    expect(findListed(PACKAGES, "")).toBeNull();
    expect(findListed(PACKAGES, "Platinum")).toBeNull();
  });

  it("a choice that is not on the list is held, never priced", () => {
    const b = lines(pkg({ choice: "Platinum" }));
    expect(b.kind).toBe("held");
    expect(JSON.stringify(b)).not.toMatch(AMOUNT);
  });

  it("additional-class math and no negative math", () => {
    const concierge = lines(pkg({ choice: "Concierge", classesToFileNow: [41, 35], priorityClass: 41 }));
    if (concierge.kind !== "settled") throw new Error("expected settled");
    expect(concierge.lines.join("\n")).not.toMatch(/additional class|-\$|−/);
    const essential = lines(pkg({ choice: "Essential", classesToFileNow: [41, 35, 9], priorityClass: 41 }));
    if (essential.kind !== "settled") throw new Error("expected settled");
    expect(essential.lines.join("\n")).toContain("2 additional classes × $825 = $1,650");
  });

  it("government fee separate and never folded into the legal fee line", () => {
    const b = lines(pkg({ choice: "Essential", classesToFileNow: [41], priorityClass: 41 }));
    if (b.kind !== "settled") throw new Error("expected settled");
    expect(b.lines.find((l) => l.startsWith("Government filing fees"))).toBe("Government filing fees: 1 × $350 = $350 (separate, never discounted; $350 per class).");
    expect(b.lines[0]).toBe("Essential — $1,950 legal fee, 1 class included.");
  });

  it("no consult credit set for the firm: no credit line at all; no expiry: no date clause", () => {
    for (const credit of [null, 0]) {
      const b = lines(pkg(), { credit });
      if (b.kind !== "settled") throw new Error("expected settled");
      expect(b.lines.join("\n")).not.toMatch(/credit/i);
    }
    const noDate = lines(pkg(), { expiry: null });
    if (noDate.kind !== "settled") throw new Error("expected settled");
    expect(noDate.lines.at(-1)).toBe("Consult credit: the $200 strategy-session fee is credited toward the legal fee, once per proposal, and only if the fee cleared.");
  });

  it("held / tbd / open class count gives no amount", () => {
    const cases = [
      lines(pkg({ choice: "HELD", classesToFileNow: [], priorityClass: null, pending: "mark not chosen; costs about $1,950 or 2000 dollars" })),
      lines(pkg(), { markConfirmed: false }),
      lines(pkg({ classesToFileNow: [], priorityClass: null })),
      lines(pkg({ pending: "the client may add a third class" })),
    ];
    for (const b of cases) {
      expect(b.kind).toBe("held");
      if (b.kind !== "held") continue;
      const all = `${b.line}\n${b.reasoning}`;
      expect(all).not.toMatch(AMOUNT);
      expect(all).not.toMatch(WORD_AMOUNT);
      expect(b.line).toContain(HELD_SUFFIX);
      expect(b.line).toMatch(/^Held( \(leaning [\w ]+\))? — /);
    }
    expect((cases[0] as { line: string }).line).toContain(AMOUNT_REMOVED);
    expect((cases[1] as { line: string }).line).toContain("the mark is not confirmed yet");
    expect((cases[2] as { line: string }).line).toContain("the class count is still open");
    expect((cases[3] as { line: string }).line).toContain("Held (leaning Enhanced) — the client may add a third class.");
  });

  it("NONE gives the 'packages don't fit' line", () => {
    expect(lines(pkg({ choice: "NONE", classesToFileNow: [], priorityClass: null }))).toMatchObject({ kind: "none", line: NONE_LINE });
    expect(NONE_LINE).not.toMatch(AMOUNT);
  });

  it("held pending text with bypass forms quotes no amount", () => {
    const b = lines(pkg({ choice: "HELD", classesToFileNow: [], priorityClass: null, pending: "class count open; would be 1950$ or two grand or ＄1,950 or 1950 EUR or 1 950 dollars" }));
    expect(b.kind).toBe("held");
    if (b.kind !== "held") return;
    expect(b.line).not.toMatch(AMOUNT);
    expect(b.line).not.toMatch(/[$＄]|grand|1950|1,950|EUR/);
    expect(b.line).toBe(`Held — class count open; would be ${Array(5).fill(AMOUNT_REMOVED).join(" or ")}. ${HELD_SUFFIX}`);
  });

  describe("complimentary consult (skill STEP 6)", () => {
    it("no credit, the complimentary line instead; everything else unchanged", () => {
      const b = lines(pkg(), { complimentary: true });
      if (b.kind !== "settled") throw new Error("expected settled");
      const text = b.lines.join("\n");
      expect(b.lines).toContain(COMPLIMENTARY_LINE);
      expect(COMPLIMENTARY_LINE).not.toMatch(/\d/);
      expect(text).not.toMatch(/credited|strategy-session fee|Consult credit:/);
      expect(text).toContain("Enhanced — $3,250 legal fee, 2 classes included.");
    });

    it("held and NONE packages never show the complimentary line or a credit", () => {
      const held = lines(pkg(), { markConfirmed: false, complimentary: true });
      if (held.kind === "held") expect(held.line).not.toMatch(/Complimentary|credit/);
      expect(lines(pkg({ choice: "NONE", classesToFileNow: [], priorityClass: null }), { complimentary: true })).toMatchObject({ kind: "none", line: NONE_LINE });
    });
  });

  it("the model reasoning is scrubbed", () => {
    const b = lines(pkg({ reasoning: "Worth it at $3,250 plus 350 dollars a class." }));
    expect(b.reasoning).not.toMatch(AMOUNT);
    expect(b.reasoning).toContain(AMOUNT_REMOVED);
  });
});

describe("finalizeJudgment: the one place model prose is scrubbed", () => {
  const base = { packages: PACKAGES, markConfirmed: true, consultCreditCents: 20_000, expiryLabel: "October 29, 2026" };

  it("a trademark judgment prints the firm's package block and scrubs every model string", () => {
    const j = {
      ...TRADEMARK_JUDGMENT,
      clientSnapshot: "Runs a conference; budget is $5,000.",
      flagsToProbe: ["Ask if two grand is realistic."],
      trademark: {
        ...TRADEMARK_JUDGMENT.trademark!,
        riskRead: "Leans yellow; a fee of 1950 would be too high.",
        package: { ...TRADEMARK_JUDGMENT.trademark!.package, reasoning: "Enhanced fits at $3,250." },
      },
    };
    const f = finalizeJudgment(j, { ...base, route: "TRADEMARK" });
    const all = JSON.stringify(f.judgment);
    expect(all).not.toMatch(/\$5,000|two grand|1950|\$3,250/);
    expect(f.judgment.clientSnapshot).toBe(`Runs a conference; budget is ${AMOUNT_REMOVED}.`);
    expect(f.package?.kind).toBe("settled");
    if (f.package?.kind === "settled") {
      expect(f.package.lines[0]).toBe("Enhanced — $3,250 legal fee, 2 classes included.");
      expect(f.package.reasoning).not.toMatch(/\$/);
    }
    expect(f.scrubbed.currency + f.scrubbed.priceSentences).toBeGreaterThanOrEqual(4);
    // The firm's own price lines are not scrubbed.
    expect(f.package?.kind === "settled" && f.package.lines.join("")).toContain("$3,250");
  });

  it("an unconfirmed mark holds the package whatever the model chose", () => {
    const f = finalizeJudgment(TRADEMARK_JUDGMENT, { ...base, route: "TRADEMARK", markConfirmed: false });
    expect(f.package).toMatchObject({ kind: "held" });
    expect(JSON.stringify(f.package)).not.toMatch(AMOUNT);
  });

  it("on the general and dispute paths the firm's package names are removed and no trademark block or package prints", () => {
    const j = {
      ...GENERAL_JUDGMENT,
      natureOfMatter: "He asked about the Concierge package for his marks.",
      general: { ...GENERAL_JUDGMENT.general!, scopeAndEngagement: "Not the Enhanced tier; a General LOE.", documentsNeeded: ["Concierge docs"] },
      trademark: TRADEMARK_JUDGMENT.trademark,
    };
    const f = finalizeJudgment(j, { ...base, route: "GENERAL" });
    expect(f.package).toBeNull();
    expect(f.judgment.trademark).toBeNull();
    expect(JSON.stringify(f.judgment)).not.toMatch(/Concierge|Enhanced/);
    expect(f.judgment.natureOfMatter).toContain(PACKAGE_NAME_REMOVED);
    expect(f.scrubbed.packageNames).toBeGreaterThanOrEqual(3);
    const d = finalizeJudgment({ ...DISPUTE_JUDGMENT, dispute: { disputeSnapshot: "Offer Essential at $3,000." } }, { ...base, route: "DISPUTE" });
    expect(d.judgment.dispute?.disputeSnapshot).not.toMatch(/Essential|\$3,000/);
  });

  it("the package names scrubbed are the firm's own", () => {
    const j = { ...GENERAL_JUDGMENT, natureOfMatter: "Maybe the Launch plan, not Concierge." };
    const f = finalizeJudgment(j, { ...base, packages: OTHER_PACKAGES, route: "GENERAL" });
    expect(f.judgment.natureOfMatter).toBe(`Maybe the ${PACKAGE_NAME_REMOVED}, not Concierge.`);
  });
});
