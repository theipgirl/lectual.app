import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROPOSAL_PRICING,
  MAX_PACKAGES,
  classCountLabel,
  findPackage,
  normalisePackages,
  packageOption,
  validatePackages,
  withPackages,
} from "@/lib/proposals/package-list";
import { standardProposalPricing, type ProposalPricing } from "@/lib/proposals/types";
import { validateSettingInput } from "@/lib/proposals/validate";
import { parsePackageList, parseSettingsPricing, pricingFromPackage } from "@/lib/proposal-editor/form";

const concierge: ProposalPricing = { ...DEFAULT_PROPOSAL_PRICING };
const enhanced: ProposalPricing = { package: "Enhanced", base_cents: 325_000, included_classes: 2, per_class_cents: 70_000, second_mark_discount_pct: 15, gov_per_class_cents: 35_000 };
const essential: ProposalPricing = { package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 60_000, second_mark_discount_pct: 10, gov_per_class_cents: 35_000 };

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}
const row = (n: number, p: Partial<Record<string, string>> = {}) => ({
  [`pkg.${n}.package`]: p.package ?? "Concierge",
  [`pkg.${n}.base`]: p.base ?? "4950.00",
  [`pkg.${n}.includedClasses`]: p.includedClasses ?? "3",
  [`pkg.${n}.perClass`]: p.perClass ?? "825.00",
  [`pkg.${n}.secondMarkPct`]: p.secondMarkPct ?? "20",
  [`pkg.${n}.govPerClass`]: p.govPerClass ?? "350.00",
});

describe("normalisePackages", () => {
  it("turns a legacy flat pricing object into one package equal to today's Concierge", () => {
    expect(normalisePackages({})).toEqual([concierge]);
    expect(normalisePackages(null)).toEqual([concierge]);
    expect(normalisePackages(undefined)).toEqual([concierge]);
    expect(normalisePackages({ package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 })).toEqual([concierge]);
  });

  it("builds the one package from whatever flat fields are well-formed, the defaults for the rest", () => {
    expect(normalisePackages({ package: "Signature", base_cents: 300_000, second_mark_discount_pct: 15 })).toEqual([
      { ...concierge, package: "Signature", base_cents: 300_000, second_mark_discount_pct: 15 },
    ]);
  });

  it("round-trips a packages array, in order", () => {
    const list = [concierge, enhanced, essential];
    expect(normalisePackages({ packages: list })).toEqual(list);
    expect(normalisePackages(withPackages({}, list))).toEqual(list);
  });

  it("uses the list as is, ignoring flat fields that disagree with it", () => {
    expect(normalisePackages({ package: "Old", base_cents: 1, packages: [enhanced] })).toEqual([enhanced]);
  });

  it("never throws on malformed input and falls back to the flat fields", () => {
    const junk: unknown[] = [
      { packages: "nope" },
      { packages: [] },
      { packages: [null, 4, "x", [], {}] },
      { packages: [{ package: "", base_cents: 1 }] },
      { packages: [{ ...enhanced, base_cents: -1 }] },
      { packages: [{ ...enhanced, base_cents: 1.5 }] },
      { packages: [{ ...enhanced, second_mark_discount_pct: 400 }] },
      { packages: { 0: enhanced } },
      "string",
      42,
      [],
    ];
    for (const j of junk) {
      expect(() => normalisePackages(j)).not.toThrow();
      expect(normalisePackages(j)).toEqual([concierge]);
    }
  });

  it("drops a malformed element and a repeated name but keeps the good ones", () => {
    expect(normalisePackages({ packages: [enhanced, { nope: true }, { ...essential, package: "ENHANCED" }, essential] })).toEqual([enhanced, essential]);
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_PACKAGES + 5 }, (_, i) => ({ ...enhanced, package: `P${i}` }));
    expect(normalisePackages({ packages: many })).toHaveLength(MAX_PACKAGES);
  });
});

describe("standardProposalPricing reads the default (first) package", () => {
  it("is the first package of the list", () => {
    expect(standardProposalPricing({ packages: [enhanced, concierge] }).pricing).toEqual(enhanced);
  });
  it("still reads legacy flat fields", () => {
    expect(standardProposalPricing({ package: "Signature", base_cents: 300_000 }).pricing).toEqual({ ...concierge, package: "Signature", base_cents: 300_000 });
  });
});

describe("withPackages", () => {
  it("writes the list and the flat fields of the FIRST package", () => {
    const out = withPackages({ includes: [{ label: "a", included: "b" }], office_action_note: "n", unknown: 1, package: "Old", base_cents: 1 }, [enhanced, concierge]);
    expect(out.packages).toEqual([enhanced, concierge]);
    expect(out).toMatchObject({ package: "Enhanced", base_cents: 325_000, included_classes: 2, per_class_cents: 70_000, second_mark_discount_pct: 15, gov_per_class_cents: 35_000 });
    // everything else is kept
    expect(out.includes).toEqual([{ label: "a", included: "b" }]);
    expect(out.office_action_note).toBe("n");
    expect(out.unknown).toBe(1);
  });
  it("copies: changing the result never changes the input list", () => {
    const list = [enhanced];
    const out = withPackages({}, list);
    (out.packages as ProposalPricing[])[0].package = "Changed";
    expect(list[0].package).toBe("Enhanced");
  });
});

describe("validatePackages", () => {
  const messages = (list: unknown) => validatePackages(list).map((i) => i.message);

  it("accepts a good list", () => {
    expect(validatePackages([concierge, enhanced, essential])).toEqual([]);
  });
  it("refuses an empty or missing list", () => {
    expect(messages([])).toEqual(["Keep at least one package."]);
    expect(messages(undefined)).toEqual(["Keep at least one package."]);
    expect(messages("x")).toEqual(["Keep at least one package."]);
  });
  it("refuses a blank name", () => {
    expect(messages([{ ...concierge, package: "  " }])).toEqual(["Package 1: give the package a name."]);
  });
  it("refuses a duplicate name, ignoring case and outer spaces", () => {
    const out = validatePackages([concierge, { ...enhanced, package: " concierge " }]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ index: 1, field: "package" });
    expect(out[0].message).toMatch(/another package already uses that name/);
  });
  it("refuses negative or fractional money, naming the field and the package", () => {
    const out = validatePackages([{ ...concierge, base_cents: -1, per_class_cents: 1.5, gov_per_class_cents: -5 }]);
    expect(out.map((i) => i.field).sort()).toEqual(["base_cents", "gov_per_class_cents", "per_class_cents"]);
    expect(out[0].message).toContain("Package 1 (Concierge)");
    expect(out.every((i) => /dollar amount of zero or more/.test(i.message))).toBe(true);
  });
  it("refuses classes below 1", () => {
    expect(messages([{ ...concierge, included_classes: 0 }])[0]).toMatch(/Classes included must be 1 or more/);
    expect(messages([{ ...concierge, included_classes: 2.5 }])[0]).toMatch(/Classes included must be 1 or more/);
  });
  it("refuses a discount outside 0 to 100", () => {
    expect(messages([{ ...concierge, second_mark_discount_pct: 101 }])[0]).toMatch(/between 0 and 100 percent/);
    expect(messages([{ ...concierge, second_mark_discount_pct: -1 }])[0]).toMatch(/between 0 and 100 percent/);
    expect(validatePackages([{ ...concierge, second_mark_discount_pct: 0 }, { ...enhanced, second_mark_discount_pct: 100 }])).toEqual([]);
  });
  it("refuses an element that is not a package, and never throws on anything", () => {
    expect(messages([null])[0]).toMatch(/isn't a package/);
    for (const j of [null, 1, "x", {}, [[]], [undefined]]) expect(() => validatePackages(j)).not.toThrow();
  });
  it("refuses too many", () => {
    const many = Array.from({ length: MAX_PACKAGES + 1 }, (_, i) => ({ ...enhanced, package: `P${i}` }));
    expect(messages(many)[0]).toMatch(/at most/);
  });
});

describe("validateSettingInput checks pricing.packages", () => {
  const input = (pricing: Record<string, unknown>) => ({ approver_user_ids: [], default_pay_url: null, notify_email: null, pricing });
  it("passes a good list and a legacy object", () => {
    expect(validateSettingInput(input(withPackages({}, [concierge, enhanced])))).toEqual([]);
    expect(validateSettingInput(input({ base_cents: 100 }))).toEqual([]);
  });
  it("reports a duplicate, a bad number and a missing list as errors on pricing.packages", () => {
    const dup = validateSettingInput(input({ packages: [concierge, concierge] }));
    expect(dup.some((i) => i.level === "error" && i.path.startsWith("pricing.packages[1]"))).toBe(true);
    const bad = validateSettingInput(input({ packages: [{ ...concierge, included_classes: 0 }] }));
    expect(bad.map((i) => i.path)).toContain("pricing.packages[0].included_classes");
    const empty = validateSettingInput(input({ packages: [] }));
    expect(empty.map((i) => i.path)).toContain("pricing.packages");
    const notList = validateSettingInput(input({ packages: "x" }));
    expect(notList.map((i) => i.path)).toContain("pricing.packages");
  });
});

describe("packageOption and helpers", () => {
  it("words a package as name plus '$4,950 · 3 classes' and gives the input strings", () => {
    expect(packageOption(concierge)).toEqual({
      name: "Concierge",
      summary: "$4,950 · 3 classes",
      base: "4950.00",
      includedClasses: "3",
      perClass: "825.00",
      secondMarkPct: "20",
      govPerClass: "350.00",
    });
    expect(packageOption(essential).summary).toBe("$1,950 · 1 class");
    expect(classCountLabel(1)).toBe("1 class");
    expect(classCountLabel(0)).toBe("0 classes");
  });
  it("finds a package by name, ignoring case", () => {
    expect(findPackage([concierge, enhanced], " ENHANCED ")).toEqual(enhanced);
    expect(findPackage([concierge], "")).toBeUndefined();
    expect(findPackage([concierge], "Nope")).toBeUndefined();
  });
});

describe("parsePackageList", () => {
  it("reads dollars into whole cents, in the order posted, the first being the default", () => {
    const r = parsePackageList(fd({ ...row(0), ...row(1, { package: "Enhanced", base: "3,250", includedClasses: "2", perClass: "700", secondMarkPct: "15" }) }));
    expect(r).toEqual({ ok: true, value: [concierge, enhanced] });
  });
  it("refuses no rows", () => {
    expect(parsePackageList(fd({}))).toEqual({ ok: false, error: "Keep at least one package." });
  });
  it("names the package and field it refuses", () => {
    const r = parsePackageList(fd({ ...row(0), ...row(1, { package: "Enhanced", base: "lots" }) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Package 2 (Enhanced), price with the included classes");
  });
  it("does not decide the list's rules: a blank name or duplicate is validatePackages's job", () => {
    const r = parsePackageList(fd({ ...row(0), ...row(1, { package: "Concierge" }) }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(validatePackages(r.value)).not.toEqual([]);
  });
});

describe("parseSettingsPricing keeps the stored prices and packages", () => {
  it("replaces only the includes table and the office-action note", () => {
    const existing = withPackages({ legacy: "keep", office_action_note: "old" }, [enhanced, concierge]);
    const r = parseSettingsPricing(fd({ officeActionNote: "", "inc.0.label": "A", "inc.0.included": "✓", package: "Hacked", base: "1" }), existing);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.packages).toEqual([enhanced, concierge]);
      expect(r.value.package).toBe("Enhanced");
      expect(r.value.base_cents).toBe(325_000);
      expect(r.value.legacy).toBe("keep");
      expect(r.value.includes).toEqual([{ label: "A", included: "✓" }]);
      expect("office_action_note" in r.value).toBe(false);
    }
  });
});

describe("pricingFromPackage", () => {
  it("takes the package's values for a field that equals it or was not posted", () => {
    const r = pricingFromPackage(fd({ base: "3250.00", includedClasses: "2" }), enhanced);
    expect(r).toEqual({ ok: true, value: { pricing: enhanced, edited: [] } });
  });
  it("keeps each changed field and names it", () => {
    const r = pricingFromPackage(fd({ base: "3000", includedClasses: "2", perClass: "650", secondMarkPct: "10", govPerClass: "400" }), enhanced);
    expect(r).toEqual({
      ok: true,
      value: {
        pricing: { ...enhanced, base_cents: 300_000, per_class_cents: 65_000, second_mark_discount_pct: 10, gov_per_class_cents: 40_000 },
        edited: ["price", "price per class", "second mark discount", "USPTO fee per class"],
      },
    });
  });
  it("treats an equal number written differently as unchanged", () => {
    const r = pricingFromPackage(fd({ base: "$3,250", perClass: "700.0" }), enhanced);
    expect(r).toEqual({ ok: true, value: { pricing: enhanced, edited: [] } });
  });
  it("refuses a field that is not a number or is blank, naming it", () => {
    expect(pricingFromPackage(fd({ base: "x" }), enhanced)).toMatchObject({ ok: false });
    expect(pricingFromPackage(fd({ includedClasses: "" }), enhanced)).toMatchObject({ ok: false });
    expect(pricingFromPackage(fd({ secondMarkPct: "150" }), enhanced)).toMatchObject({ ok: false });
  });
  it("never changes the package name", () => {
    const r = pricingFromPackage(fd({ package: "Free", packageName: "Free" }), enhanced);
    expect(r).toEqual({ ok: true, value: { pricing: enhanced, edited: [] } });
  });
});
