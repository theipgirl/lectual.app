import { describe, it, expect } from "vitest";
import type { ConsultMark, StoredConsultDetails } from "@/lib/consult/vocab";
import type { ReviewedConsultRead } from "@/lib/consult/store";
import { buildNewContent, newBrandName } from "@/lib/proposal-editor/form";
import {
  buildBrandNames,
  clientFromLead,
  consultBrands,
  consultPrefill,
  filledFromLine,
  leadBrand,
  matterBrand,
  matterTitle,
  packageFromConsult,
  packageNote,
  reviewDate,
} from "@/lib/proposals/prefill";
import { DEFAULT_PROPOSAL_PRICING, MARK_KIND_DEFAULT_DESC } from "@/lib/proposals/types";
import { normalisePackages } from "@/lib/proposals/package-list";

/**
 * The New proposal pre-fill rules, pure: the client and first brand from a lead or matter, and the
 * marks / classes / package a REVIEWED consult adds. Nothing here reads a record's price.
 */

const mark = (id: string, text: string, type: ConsultMark["mark_type"], classes: Array<[number | null, string]> = []): ConsultMark => ({
  id,
  mark: text,
  mark_type: type,
  classes: classes.map(([cls, goods]) => ({ class: cls, goods })),
  filing_basis: "unknown",
  extracted_basis: null,
  basis_evidence: null,
  first_use_date: null,
});

const REVIEW = { reviewed_at: "2026-10-21T02:30:00Z", reviewed_by: "u1", reviewed_by_name: "Rebecca Beliard", reviewed_by_role: "senior_admin" };
const details = (marks: ConsultMark[], over: Partial<StoredConsultDetails> = {}): StoredConsultDetails => ({
  version: 1,
  rev: 1,
  marks,
  recommended_package: null,
  discount_discussed: null,
  extracted: null,
  review: REVIEW,
  ...over,
});
const reviewed = (d: StoredConsultDetails): ReviewedConsultRead => ({ status: "ok", details: d, unreadable: false, unreviewed: false });

let n = 0;
const rand = () => String(++n).padStart(4, "0");
/** A fresh counter, so two calls can be compared. */
const seq = () => {
  let i = 0;
  return () => String(++i).padStart(4, "0");
};

describe("the client and the first brand name", () => {
  const lead = { id: "l1", first_name: "Ana", last_name: "Ruiz", business_name: "Zephyr Co", email: " ana@example.com ", mark_text: "Zephyr" };

  it("a lead fills full name, first name, company (person AND business) and email", () => {
    expect(clientFromLead(lead)).toEqual({ fullName: "Ana Ruiz", firstName: "Ana", company: "Zephyr Co", clientEmail: "ana@example.com" });
  });

  it("a business-only lead is named by its business and has no company", () => {
    expect(clientFromLead({ ...lead, first_name: null, last_name: null })).toEqual({ fullName: "Zephyr Co", firstName: "", company: "", clientEmail: "ana@example.com" });
  });

  it("a lead's brand is its mark, else its business name, else blank", () => {
    expect(leadBrand(lead)).toBe("Zephyr");
    expect(leadBrand({ mark_text: " ", business_name: "Zephyr Co" })).toBe("Zephyr Co");
    expect(leadBrand({ mark_text: null, business_name: null })).toBe("");
    expect(leadBrand(null)).toBe("");
  });

  it("a matter's brand is its mark, else its title, else what its lead gives", () => {
    expect(matterBrand({ mark_text: "Birch", title: "Birch filing" }, lead)).toBe("Birch");
    expect(matterBrand({ mark_text: null, title: "Birch filing" }, lead)).toBe("Birch filing");
    expect(matterBrand({ mark_text: null, title: null }, lead)).toBe("Zephyr");
    expect(matterBrand({ mark_text: null, title: null }, { mark_text: null, business_name: "Zephyr Co" })).toBe("Zephyr Co");
    expect(matterBrand({ mark_text: null, title: null }, null)).toBe("");
  });

  it("a matter is titled by mark, else title, else number", () => {
    expect(matterTitle({ mark_text: "Birch", title: "T", matter_number: "TM-1" })).toBe("Birch");
    expect(matterTitle({ mark_text: null, title: "T", matter_number: "TM-1" })).toBe("T");
    expect(matterTitle({ mark_text: null, title: null, matter_number: "TM-1" })).toBe("TM-1");
  });
});

describe("consultBrands: a consult's marks as brand names", () => {
  it("a word mark gets a word mark, a design mark a logo mark", () => {
    const brands = consultBrands([mark("m1", "Zephyr", "word"), mark("m2", "Swirl", "design")]);
    expect(brands.map((b) => [b.name, b.kinds])).toEqual([
      ["Zephyr", ["word"]],
      ["Swirl", ["logo"]],
    ]);
  });

  it("the same mark as word and as design (case and punctuation aside) is ONE brand name with both", () => {
    const brands = consultBrands([mark("m1", "Zephyr", "word"), mark("m2", "ZEPHYR!", "design")]);
    expect(brands).toHaveLength(1);
    expect(brands[0]).toMatchObject({ name: "Zephyr", kinds: ["word", "logo"] });
  });

  it("a mark whose type was not stated gets today's default pair, never a guess either way", () => {
    expect(consultBrands([mark("m1", "Zephyr", "unknown")])[0].kinds).toEqual(["word", "logo"]);
  });

  it("classes become the goods text as the label; a class with blank goods is skipped; repeats collapse", () => {
    const [b] = consultBrands([
      mark("m1", "Zephyr", "word", [
        [25, "Clothing, namely t-shirts"],
        [35, "   "],
        [25, "clothing, namely t-shirts"],
        [null, "Online retail store services"],
      ]),
    ]);
    expect(b.classes).toEqual(["Clothing, namely t-shirts", "Online retail store services"]);
    expect(b.dropped).toBe(0);
  });

  it("no class number is carried anywhere in the result", () => {
    const brands = consultBrands([mark("m1", "Zephyr", "word", [[25, "Clothing"], [35, "Retail"]])]);
    const json = JSON.stringify(brands);
    expect(json).not.toMatch(/25|35/);
  });

  it("at most 3 classes per brand name; the rest are counted", () => {
    const [b] = consultBrands([mark("m1", "Zephyr", "word", [[1, "A goods"], [2, "B goods"], [3, "C goods"], [4, "D goods"], [5, "E goods"]])]);
    expect(b.classes).toEqual(["A goods", "B goods", "C goods"]);
    expect(b.dropped).toBe(2);
  });

  it("marks with no text are skipped, and at most 10 brand names are made", () => {
    expect(consultBrands([mark("m1", "  ", "word")])).toEqual([]);
    const many = Array.from({ length: 14 }, (_, i) => mark(`m${i}`, `Brand${String.fromCharCode(97 + i)}`, "word"));
    expect(consultBrands(many)).toHaveLength(10);
  });
});

describe("consultPrefill: when the consult fills anything", () => {
  it("reviewed details with a usable mark are filled, with who and when", () => {
    const fill = consultPrefill(reviewed(details([mark("m1", "Zephyr", "word")], { recommended_package: " Enhanced " })));
    expect(fill).toMatchObject({ state: "filled", reviewedBy: "Rebecca Beliard", reviewedAt: REVIEW.reviewed_at, recommendedPackage: "Enhanced", dropped: 0 });
  });

  it("a review with no stored name has no name", () => {
    const fill = consultPrefill(reviewed(details([mark("m1", "Zephyr", "word")], { review: { ...REVIEW, reviewed_by_name: null } })));
    expect(fill).toMatchObject({ state: "filled", reviewedBy: null });
  });

  it("the newest record not reviewed fills nothing", () => {
    expect(consultPrefill({ status: "ok", details: null, unreadable: false, unreviewed: true })).toEqual({ state: "not_reviewed" });
  });

  it("an unreadable record, or a failed read, fills nothing", () => {
    expect(consultPrefill({ status: "ok", details: null, unreadable: true, unreviewed: false })).toEqual({ state: "unreadable" });
    expect(consultPrefill({ status: "unavailable" })).toEqual({ state: "unreadable" });
  });

  it("reviewed with no usable mark fills nothing", () => {
    expect(consultPrefill(reviewed(details([])))).toEqual({ state: "no_marks" });
    expect(consultPrefill(reviewed(details([mark("m1", "   ", "word")])))).toEqual({ state: "no_marks" });
  });

  it("no consult details at all is its own state, and no lead is another", () => {
    expect(consultPrefill({ status: "ok", details: null, unreadable: false, unreviewed: false })).toEqual({ state: "none" });
    expect(consultPrefill(null)).toEqual({ state: "no_lead" });
  });

  it("details without a review stamp are never used, whatever the reader said", () => {
    expect(consultPrefill(reviewed(details([mark("m1", "Zephyr", "word")], { review: null })))).toEqual({ state: "not_reviewed" });
  });
});

describe("buildBrandNames: the typed name and the consult marks", () => {
  const brands = consultBrands([
    mark("m1", "Zephyr", "word", [[25, "Clothing, namely t-shirts"], [35, "Retail store services"]]),
    mark("m2", "Birch", "design", [[9, "Downloadable software"]]),
  ]);

  it("a typed name that matches a consult mark (case, punctuation) is that mark's brand name; the others follow", () => {
    n = 0;
    const names = buildBrandNames({ typed: "zephyr!", brands, rand });
    expect(names.map((x) => x.name)).toEqual(["zephyr!", "Birch"]);
    expect(names[0].marks.map((m) => m.kind)).toEqual(["word"]);
    expect(names[0].classes.map((c) => c.label)).toEqual(["Clothing, namely t-shirts", "Retail store services"]);
    expect(names[1].marks.map((m) => m.kind)).toEqual(["logo"]);
  });

  it("a typed name that matches none stays first with the default pair and no classes; the consult marks follow", () => {
    n = 0;
    const names = buildBrandNames({ typed: "Other", brands, rand });
    expect(names.map((x) => x.name)).toEqual(["Other", "Zephyr", "Birch"]);
    expect(names[0].marks.map((m) => m.kind)).toEqual(["word", "logo"]);
    expect(names[0].classes).toEqual([]);
  });

  it("a blank typed name creates only the consult marks", () => {
    n = 0;
    expect(buildBrandNames({ typed: "  ", brands, rand }).map((x) => x.name)).toEqual(["Zephyr", "Birch"]);
  });

  it("with no consult marks it is exactly today's single typed name (default pair, no classes)", () => {
    const names = buildBrandNames({ typed: "Prosperall", brands: [], rand: seq() });
    expect(names).toEqual([newBrandName("Prosperall", new Set<string>(), seq())]);
    expect(buildBrandNames({ typed: "", brands: [], rand })).toEqual([]);
  });

  it("marks and classes start ticked, with the firm's default word and logo descriptions", () => {
    n = 0;
    const names = buildBrandNames({ typed: "", brands, rand });
    for (const nm of names) {
      for (const m of nm.marks) {
        expect(m.preselected).toBe(true);
        expect(m.desc).toBe(MARK_KIND_DEFAULT_DESC[m.kind]);
      }
      for (const c of nm.classes) expect(c.preselected).toBe(true);
    }
    // The mark text is the name; it is never written into a description.
    expect(JSON.stringify(names.flatMap((x) => x.marks.map((m) => m.desc)))).not.toContain("Zephyr");
  });

  it("ids are unique and non-empty, even when the random source repeats", () => {
    // The first draws collide; cleanId keeps drawing until each id is free.
    const draws = ["same", "same", "same", "same", "same"];
    let i = 0;
    const names = buildBrandNames({ typed: "Other", brands, rand: () => draws[i++] ?? `x${i}` });
    const ids = names.flatMap((x) => [x.id, ...x.marks.map((m) => m.id), ...x.classes.map((c) => c.id)]);
    expect(ids.every((id) => id.length > 0)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no class number is anywhere in the built names", () => {
    n = 0;
    const json = JSON.stringify(buildBrandNames({ typed: "Zephyr", brands, rand }));
    expect(json).not.toMatch(/"label":"[^"]*\b(25|35|9)\b/);
    expect(json).not.toMatch(/class":\s*\d/);
  });

  it("at most 10 names, a typed one included", () => {
    const many = consultBrands(Array.from({ length: 10 }, (_, i) => mark(`m${i}`, `Brand${String.fromCharCode(97 + i)}`, "word")));
    expect(buildBrandNames({ typed: "Typed", brands: many, rand })).toHaveLength(10);
  });

  it("builds a proposal document with the names as given, and today's output without them", () => {
    const standard = { pricing: { ...DEFAULT_PROPOSAL_PRICING }, includes: [], office_action_note: "note" };
    const today = buildNewContent({ firstName: "Ana", fullName: "Ana Ruiz", brandName: "Prosperall", standard, rand: seq() });
    expect(today.names).toEqual([newBrandName("Prosperall", new Set<string>(), seq())]);
    n = 0;
    const names = buildBrandNames({ typed: "", brands, rand });
    const withNames = buildNewContent({ firstName: "Ana", fullName: "Ana Ruiz", brandName: "ignored", names, standard, rand });
    expect(withNames.names).toBe(names);
  });
});

describe("packageFromConsult: by name against the firm's CURRENT list", () => {
  const list = normalisePackages({
    packages: [
      { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 },
      { package: "Enhanced", base_cents: 325_000, included_classes: 2, per_class_cents: 70_000, second_mark_discount_pct: 15, gov_per_class_cents: 35_000 },
    ],
  });

  it("equal, different case, or padded is a match, spelled as the firm saved it", () => {
    expect(packageFromConsult("Enhanced", list)).toEqual({ kind: "match", name: "Enhanced" });
    expect(packageFromConsult("ENHANCED", list)).toEqual({ kind: "match", name: "Enhanced" });
    expect(packageFromConsult("  enhanced  ", list)).toEqual({ kind: "match", name: "Enhanced" });
  });

  it("a name that is not on the list is 'unlisted' and carries what the consult asked for", () => {
    expect(packageFromConsult("Platinum", list)).toEqual({ kind: "unlisted", asked: "Platinum" });
  });

  it("no package, or a blank one, is none", () => {
    expect(packageFromConsult(null, list)).toEqual({ kind: "none" });
    expect(packageFromConsult("   ", list)).toEqual({ kind: "none" });
    expect(packageFromConsult(undefined, list)).toEqual({ kind: "none" });
  });

  it("when the firm's settings couldn't be read there is nothing to check against, so nothing is said", () => {
    expect(packageFromConsult("Enhanced", null)).toEqual({ kind: "none" });
  });

  it("the note names the package the consult asked for", () => {
    expect(packageNote("Platinum")).toBe("Package from the consult (Platinum) isn't on your list. Choose one.");
  });
});

describe("the 'Filled from' line", () => {
  const tz = "America/New_York";

  it("a lead alone", () => {
    expect(filledFromLine({ lead: "Ana Ruiz · Zephyr Co", tz })).toBe("Filled from: lead Ana Ruiz · Zephyr Co.");
  });

  it("a matter names its lead when one was read", () => {
    expect(filledFromLine({ matter: "Zephyr", lead: "Ana Ruiz", tz })).toBe("Filled from: matter Zephyr; lead Ana Ruiz.");
    expect(filledFromLine({ matter: "Zephyr", tz })).toBe("Filled from: matter Zephyr.");
  });

  it("names the consult review (who and when, in the firm's zone) and the package, when used", () => {
    // 02:30 UTC on Oct 21 is still Oct 20 in New York.
    expect(
      filledFromLine({ lead: "Ana Ruiz", consult: { reviewedBy: "Rebecca Beliard", reviewedAt: "2026-10-21T02:30:00Z" }, packageName: "Enhanced", tz }),
    ).toBe("Filled from: lead Ana Ruiz; consult details reviewed by Rebecca Beliard on Oct 20, 2026; package Enhanced.");
  });

  it("a review with no stored name reads 'reviewed on <date>'", () => {
    expect(filledFromLine({ lead: "Ana", consult: { reviewedBy: null, reviewedAt: "2026-10-21T16:00:00Z" }, tz })).toBe(
      "Filled from: lead Ana; consult details reviewed on Oct 21, 2026.",
    );
  });

  it("a source that was not used is not named", () => {
    const line = filledFromLine({ lead: "Ana", consult: null, packageName: null, tz }) ?? "";
    expect(line).not.toContain("consult");
    expect(line).not.toContain("package");
  });

  it("says how many classes the per-brand limit left off", () => {
    expect(filledFromLine({ lead: "Ana", droppedClasses: 2, tz })).toContain("2 more classes weren't added (3 per brand name).");
    expect(filledFromLine({ lead: "Ana", droppedClasses: 1, tz })).toContain("1 more class wasn't added (3 per brand name).");
    expect(filledFromLine({ lead: "Ana", droppedClasses: 0, tz })).not.toContain("weren't");
  });

  it("nothing chosen is no line", () => {
    expect(filledFromLine({ tz })).toBeNull();
  });

  it("reviewDate is empty for a stamp that isn't a date", () => {
    expect(reviewDate("not a date", tz)).toBe("");
    expect(reviewDate(null, tz)).toBe("");
  });
});
