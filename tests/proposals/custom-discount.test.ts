import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { defaultSelection, isFixedOffer, lockedSelectionIds, normalizeSelection, quoteHasItems, quoteProposal } from "@/lib/proposals/pricing";
import { quoteWithClientClasses } from "@/lib/proposals/client-classes";
import { validateContent } from "@/lib/proposals/validate";
import { publicContent } from "@/lib/proposals/public";
import { withPackageSnapshot } from "@/lib/proposals/package-snapshot";
import type { PackageOffer, ProposalContent, Selection } from "@/lib/proposals/types";
import { sevetri } from "./fixture";
import { danielle } from "./danielle-fixture";
import { fold } from "./mark-fixture";
import { S_CONCIERGE, S_OPTIONS, sevetriCustom } from "./sevetri-custom-fixture";

/** Every mark of every brand name on `pkg` (all marks and classes ticked, as the default selection has them). */
function all(content: ProposalContent, pkg: string): Selection {
  const picks: Record<string, string> = {};
  for (const n of content.names) for (const m of n.marks) picks[m.id] = pkg;
  return { ...defaultSelection(content), packages: picks };
}

const errors = (c: unknown) => validateContent(c).filter((i) => i.level === "error");

describe("Sevetri: a custom discount on Concierge only", () => {
  it("all Concierge, every mark and class ticked: $4,125 + $3,300 per name, $14,850 legal, USPTO $2,800", () => {
    const c = sevetriCustom();
    const q = quoteProposal(c, defaultSelection(c));
    for (const n of q.names) {
      expect(n.marks.map((m) => m.price_cents)).toEqual([412_500, 330_000]);
      expect(n.legal_cents).toBe(742_500);
      // The cents that really came off each mark's price: $825 on the first, $660 (after 20%) on the second.
      expect(n.marks.map((m) => m.custom_discount_cents)).toEqual([82_500, 66_000]);
      expect(n.marks.map((m) => m.price_before_custom_discount_cents)).toEqual([495_000, 396_000]);
      expect(n.marks.map((m) => m.custom_discount_label)).toEqual(["Custom proposal discount", "Custom proposal discount"]);
      expect(n.marks.map((m) => m.base_cents)).toEqual([495_000, 495_000]);
      expect(n.custom_discount_cents).toBe(148_500);
      expect(n.custom_discount_label).toBe("Custom proposal discount");
    }
    expect(q.legal_subtotal_cents).toBe(1_485_000);
    expect(q.legal_total_cents).toBe(1_485_000);
    expect(q.gov_total_cents).toBe(280_000);
    expect(q.adjustments).toEqual([]);
  });

  it("all Enhanced: $11,700, and no custom-discount key anywhere", () => {
    const c = sevetriCustom();
    const q = quoteProposal(c, all(c, "Enhanced"));
    expect(q.legal_total_cents).toBe(1_170_000);
    expect(q.gov_total_cents).toBe(280_000);
    expect(JSON.stringify(q)).not.toContain("custom_discount");
  });

  it("all Essential: $9,990, and no custom-discount key anywhere", () => {
    const c = sevetriCustom();
    const q = quoteProposal(c, all(c, "Essential"));
    expect(q.legal_total_cents).toBe(999_000);
    expect(JSON.stringify(q)).not.toContain("custom_discount");
  });

  it("Concierge with 3 classes on a name (one client-added class): no discount on that name, $4,950 + $3,960", () => {
    const c = sevetriCustom();
    const r = quoteWithClientClasses(c, defaultSelection(c), { entries: {}, added: { p: [{ text: "Mobile apps", on: true }] } });
    if (!r.ok) throw new Error("refused");
    const [p, t] = r.quote.names;
    expect(p.marks.map((m) => m.price_cents)).toEqual([495_000, 396_000]);
    expect(p.legal_cents).toBe(891_000);
    expect(p.custom_discount_cents).toBeUndefined();
    expect(p.marks.some((m) => "custom_discount_cents" in m)).toBe(false);
    // The other name still has 2 classes and keeps its discount.
    expect(t.legal_cents).toBe(742_500);
    expect(r.quote.legal_total_cents).toBe(891_000 + 742_500);
    expect(r.quote.gov_total_cents).toBe(3 * 2 * 35_000 + 2 * 2 * 35_000);
  });

  it("mixed: word mark Concierge, design mark Enhanced. The second mark's Enhanced price is untouched", () => {
    const c = sevetriCustom();
    const q = quoteProposal(c, { ...defaultSelection(c), packages: { "p-word": "Concierge", "p-logo": "Enhanced", "t-logo": "Enhanced", "t-word": "Concierge" } });
    const [p, t] = q.names;
    expect(p.marks.map((m) => [m.price_cents, m.custom_discount_cents])).toEqual([[412_500, 82_500], [260_000, undefined]]);
    expect(p.custom_discount_cents).toBe(82_500);
    // Tech4PublicGood: logo first (Enhanced $3,250), word second on Concierge: (4,950 - 825) x 80% = $3,300, $660 off.
    expect(t.marks.map((m) => [m.price_cents, m.custom_discount_cents])).toEqual([[325_000, undefined], [330_000, 66_000]]);
    expect(t.custom_discount_cents).toBe(66_000);
  });

  it("one class ticked: $825 x 2 off (never below zero)", () => {
    const c = sevetriCustom();
    const s = { ...defaultSelection(c), "p-c2": false };
    const p = quoteProposal(c, s).names[0];
    expect(p.marks.map((m) => m.price_cents)).toEqual([495_000 - 165_000, Math.round((495_000 - 165_000) * 0.8)]);
    expect(p.custom_discount_cents).toBe(165_000 + (396_000 - 264_000));

    const huge: ProposalContent = { ...c, packages: [{ ...S_CONCIERGE, base_cents: 100_000, custom_discount: { label: "Custom proposal discount", per_class_under_cents: 82_500 } }] };
    for (const n of huge.names) for (const m of n.marks) m.package_choice = { options: ["Concierge"], default: "Concierge" };
    const z = quoteProposal(huge, s).names[0];
    expect(z.marks.map((m) => m.price_cents)).toEqual([0, 0]);
    expect(z.marks.map((m) => m.custom_discount_cents)).toEqual([100_000, 80_000]);
  });

  it("the global adjustments still come off the subtotal afterwards, unchanged", () => {
    const c = sevetriCustom();
    c.adjustments = [{ id: "a", label: "Consult credit", kind: "amount", value: 50_000 }];
    const q = quoteProposal(c, defaultSelection(c));
    expect(q.legal_subtotal_cents).toBe(1_485_000);
    expect(q.legal_total_cents).toBe(1_435_000);
  });

  it("a brand-name-level package (Spec 6) with a custom discount: off the name's price, then its own discount_pct", () => {
    const d = danielle();
    const packages = (d.packages ?? []).map((p) => (p.package === "Concierge" ? { ...p, custom_discount: { label: "Custom proposal discount", per_class_under_cents: 82_500 } } : p));
    const c: ProposalContent = { ...d, packages };
    // A second mark on The Confidence Interval, to check the order against the second-mark percent.
    c.names[1].marks.push({ id: "ci-logo", kind: "logo", desc: "Protects the design.", preselected: true });
    const q = quoteProposal(c, { ...defaultSelection(c), packages: { fold: "Concierge", ci: "Concierge" } });
    const [f, ci] = q.names;
    // The Confidence Interval: 2 classes, one under Concierge's 3. $4,950 - $825 = $4,125; second mark $3,300; then 10% off.
    expect(ci.package).toBe("Concierge");
    expect(ci.marks.map((m) => m.price_cents)).toEqual([412_500, 330_000]);
    expect(ci.marks.map((m) => m.custom_discount_cents)).toEqual([82_500, 66_000]);
    expect(ci.custom_discount_cents).toBe(148_500);
    expect(ci.custom_discount_label).toBe("Custom proposal discount");
    expect(ci.discount_cents).toBe(74_250);
    expect(ci.legal_cents).toBe(668_250);
    expect(ci.gov_cents).toBe(2 * 2 * 35_000);
    // The Fold has 3 classes: nothing under Concierge's 3, no discount.
    expect(f.legal_cents).toBe(495_000);
    expect(f.custom_discount_cents).toBeUndefined();
    // On Enhanced nothing applies.
    const e = quoteProposal(c, { ...defaultSelection(c), packages: { fold: "Concierge", ci: "Enhanced" } }).names[1];
    expect(e.custom_discount_cents).toBeUndefined();
    expect(e.legal_cents).toBe(Math.round(((325_000 + 260_000) * 90) / 100));
  });

  it("selection rules are unchanged by the feature", () => {
    const c = sevetriCustom();
    expect(isFixedOffer(c)).toBe(false);
    expect(normalizeSelection(c, { packages: { "p-word": "Nope" } }).packages?.["p-word"]).toBe("Concierge");
    expect(quoteHasItems(quoteProposal(c, defaultSelection(c)))).toBe(true);
    expect(lockedSelectionIds(c, defaultSelection(c)).size).toBe(0);
  });
});

describe("validateContent: custom_discount", () => {
  const withCd = (cd: unknown, at: Partial<PackageOffer> = {}) => {
    const c = sevetriCustom();
    c.packages = [c.packages![0], c.packages![1], { ...S_CONCIERGE, ...at, custom_discount: cd as PackageOffer["custom_discount"] }];
    return c;
  };

  it("Sevetri's content is valid", () => {
    expect(errors(sevetriCustom())).toEqual([]);
  });

  it("refuses a missing, long or non-plain label", () => {
    expect(errors(withCd({ label: "", per_class_under_cents: 82_500 })).map((i) => i.path)).toEqual(["packages[2].custom_discount.label"]);
    expect(errors(withCd({ label: "x".repeat(61), per_class_under_cents: 82_500 })).map((i) => i.path)).toEqual(["packages[2].custom_discount.label"]);
    expect(errors(withCd({ label: "x".repeat(60), per_class_under_cents: 82_500 }))).toEqual([]);
    expect(errors(withCd({ label: "<b>Deal</b>", per_class_under_cents: 82_500 })).map((i) => i.path)).toEqual(["packages[2].custom_discount.label"]);
    expect(errors(withCd({ label: "Deal\u0007", per_class_under_cents: 82_500 })).map((i) => i.path)).toEqual(["packages[2].custom_discount.label"]);
    expect(errors(withCd({ per_class_under_cents: 82_500 })).map((i) => i.path)).toEqual(["packages[2].custom_discount.label"]);
  });

  it("refuses an amount that is not a positive whole number of cents, or more than the per-class price", () => {
    for (const bad of [0, -1, 1.5, "82500", null]) {
      expect(errors(withCd({ label: "Custom proposal discount", per_class_under_cents: bad })).map((i) => i.path)).toEqual(["packages[2].custom_discount.per_class_under_cents"]);
    }
    expect(errors(withCd({ label: "Custom proposal discount", per_class_under_cents: 82_501 })).map((i) => i.path)).toEqual(["packages[2].custom_discount.per_class_under_cents"]);
    expect(errors(withCd({ label: "Custom proposal discount", per_class_under_cents: 50_000 }, { per_class_cents: 50_000 }))).toEqual([]);
  });

  it("refuses an unreadable discount", () => {
    expect(errors(withCd("825")).map((i) => i.path)).toEqual(["packages[2].custom_discount"]);
  });

  it("is allowed only on content.packages entries, never on the proposal's pricing", () => {
    const c = sevetriCustom();
    (c.pricing as unknown as Record<string, unknown>).custom_discount = { label: "Custom proposal discount", per_class_under_cents: 82_500 };
    expect(errors(c).map((i) => i.path)).toEqual(["pricing.custom_discount"]);
  });
});

describe("custom_discount survives the client view and the package snapshot", () => {
  it("publicContent keeps exactly its two keys", () => {
    const c = sevetriCustom();
    (c.packages![2].custom_discount as unknown as Record<string, unknown>).secret = "x";
    const pub = publicContent(c);
    expect(pub.packages?.[2].custom_discount).toEqual({ label: "Custom proposal discount", per_class_under_cents: 82_500 });
    expect(pub.packages?.[0].custom_discount).toBeUndefined();
    // The client page prices exactly what the server prices.
    expect(quoteProposal(pub, defaultSelection(pub)).legal_total_cents).toBe(1_485_000);
  });

  it("withPackageSnapshot keeps an existing entry's custom discount when it refreshes the firm's list", () => {
    const c = sevetriCustom();
    const setting = {
      packages: [
        { package: "Essential", base_cents: 195_000, per_class_cents: 82_500, included_classes: 1, gov_per_class_cents: 35_000, second_mark_discount_pct: 20 },
        { package: "Enhanced", base_cents: 325_000, per_class_cents: 82_500, included_classes: 2, gov_per_class_cents: 35_000, second_mark_discount_pct: 20 },
        { package: "Concierge", base_cents: 495_000, per_class_cents: 82_500, included_classes: 3, gov_per_class_cents: 35_000, second_mark_discount_pct: 20 },
      ],
    };
    const out = withPackageSnapshot(c, setting);
    const concierge = out.packages?.find((p) => p.package === "Concierge");
    expect(concierge?.custom_discount).toEqual({ label: "Custom proposal discount", per_class_under_cents: 82_500 });
    expect(out.packages?.find((p) => p.package === "Enhanced")?.custom_discount).toBeUndefined();
    expect(quoteProposal(out, defaultSelection(out)).legal_total_cents).toBe(1_485_000);
  });
});

/* ── A proposal without custom_discount prices byte for byte as before: the engine on origin/main before this change (cc959d9) ── */
const BEFORE = "cc959d9";
let oldPricing: string | null = null;
try {
  oldPricing = execSync(`git show ${BEFORE}:src/lib/proposals/pricing.ts`, { stdio: ["ignore", "pipe", "ignore"] }).toString();
} catch {
  oldPricing = null;
}

function withoutCustom(c: ProposalContent): ProposalContent {
  return {
    ...c,
    packages: c.packages?.map((p) => {
      const copy = { ...p };
      delete copy.custom_discount;
      return copy;
    }),
  };
}

describe("without a custom discount, the engine is unchanged", () => {
  it.skipIf(oldPricing === null)("sevetri, danielle, the fold and Sevetri's per-mark offer quote exactly as on main", async () => {
    const dir = mkdtempSync(join(tmpdir(), "custom-discount-pricing-"));
    const file = join(dir, "pricing-before.ts");
    // The old engine imports `isGeneralContent` from "./types" at runtime: point it at this checkout's types.ts.
    writeFileSync(file, oldPricing!.replaceAll('from "./types"', `from ${JSON.stringify(resolve("src/lib/proposals/types.ts"))}`));
    const before = (await import(/* @vite-ignore */ file)) as typeof import("@/lib/proposals/pricing");
    const cases: Array<[ProposalContent, Selection]> = [];
    const add = (c: ProposalContent) => {
      const d = before.defaultSelection(c);
      cases.push([c, d]);
      const keys = Object.keys(d).filter((k) => k !== "packages");
      for (let mask = 0; mask < 16; mask++) {
        cases.push([c, { ...d, ...Object.fromEntries(keys.map((k, i) => [k, ((mask >> i % 4) & 1) === 1])) }]);
      }
    };
    add(sevetri());
    const credit = sevetri();
    credit.adjustments = [{ id: "a", label: "Consult credit", kind: "amount", value: 50_000 }];
    add(credit);
    add(danielle());
    add(fold());
    const plain = withoutCustom(sevetriCustom());
    add(plain);
    for (const p of S_OPTIONS) cases.push([plain, all(plain, p)]);
    // A custom discount that never applies (Concierge never chosen) changes nothing either.
    const unused = sevetriCustom();
    for (const p of ["Essential", "Enhanced"]) cases.push([unused, all(unused, p)]);
    for (const [content, selection] of cases) {
      expect(JSON.stringify(quoteProposal(content, selection))).toBe(JSON.stringify(before.quoteProposal(content, selection)));
      expect(JSON.stringify(defaultSelection(content))).toBe(JSON.stringify(before.defaultSelection(content)));
      expect(JSON.stringify(normalizeSelection(content, selection))).toBe(JSON.stringify(before.normalizeSelection(content, selection)));
      expect(isFixedOffer(content)).toBe(before.isFixedOffer(content));
      expect([...lockedSelectionIds(content, selection)]).toEqual([...before.lockedSelectionIds(content, selection)]);
    }
  });
});
