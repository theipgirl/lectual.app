import { describe, it, expect } from "vitest";

import {
  defaultSelection,
  isFixedOffer,
  lockedSelectionIds,
  normalizeSelection,
  quoteHasItems,
  quoteProposal,
  wouldEmptyQuote,
} from "@/lib/proposals/pricing";
import type { ProposalContent, Selection } from "@/lib/proposals/types";
import { sevetri } from "./fixture";

/**
 * The Sevetri example, in cents. The numbers come from the firm's own proposal
 * page: a Concierge package is a FLAT $4,950 up to 3 classes (Sprint 28: fewer
 * classes never lower it), $825 more for each class past the third, 20% off the
 * second mark of the SAME brand name, and the USPTO's $350 per class per mark is
 * due at filing, not with the legal fee.
 */

/** Tick exactly these ids. */
const pick = (...ids: string[]): Selection => Object.fromEntries(ids.map((id) => [id, true]));

describe("quoteProposal: the firm's Concierge price by class count", () => {
  it("1 class is the flat $4,950.00 (fewer classes than included never lower it)", () => {
    const q = quoteProposal(sevetri(), pick("p-word", "p-c1"));
    expect(q.names[0].base_cents).toBe(495_000);
    expect(q.names[0].legal_cents).toBe(495_000);
    expect(q.legal_total_cents).toBe(495_000);
  });

  it("2 classes is the same flat $4,950.00", () => {
    const q = quoteProposal(sevetri(), pick("p-word", "p-c1", "p-c2"));
    expect(q.legal_total_cents).toBe(495_000);
  });

  it("the 4th class adds $825.00 legal and $350.00 USPTO", () => {
    const content = sevetri();
    content.names[0].classes.push({ id: "p-c3", label: "Marketing", preselected: false }, { id: "p-c4", label: "Training", preselected: false });
    const three = quoteProposal(content, pick("p-word", "p-c1", "p-c2", "p-c3"));
    const four = quoteProposal(content, pick("p-word", "p-c1", "p-c2", "p-c3", "p-c4"));
    expect(four.legal_total_cents - three.legal_total_cents).toBe(82_500);
    expect(four.gov_total_cents - three.gov_total_cents).toBe(35_000);
  });

  it("3 classes is the $4,950.00 base", () => {
    const content = sevetri();
    content.names[0].classes.push({ id: "p-c3", label: "Marketing", preselected: false });
    const q = quoteProposal(content, pick("p-word", "p-c1", "p-c2", "p-c3"));
    expect(q.legal_total_cents).toBe(495_000);
  });

  it("the second mark of the same brand name is 20% off", () => {
    const q = quoteProposal(sevetri(), pick("p-word", "p-logo", "p-c1", "p-c2"));
    const [first, second] = q.names[0].marks;
    expect(first.price_cents).toBe(495_000);
    expect(first.second).toBe(false);
    expect(second.price_cents).toBe(396_000); // 495000 x 0.8
    expect(second.second).toBe(true);
    expect(q.names[0].legal_cents).toBe(891_000);
  });

  it("'second' follows content order, not mark kind", () => {
    const q = quoteProposal(sevetri(), pick("t-logo", "t-word", "t-c1", "t-c2"));
    expect(q.names[1].marks.map((m) => [m.id, m.second])).toEqual([
      ["t-logo", false],
      ["t-word", true],
    ]);
  });

  it("the discount applies per brand name, not across them", () => {
    const q = quoteProposal(sevetri(), pick("p-word", "t-word", "p-c1", "t-c1"));
    expect(q.names.map((n) => n.legal_cents)).toEqual([495_000, 495_000]);
    expect(q.legal_total_cents).toBe(990_000);
  });

  it("rounds the discounted price once, to the cent", () => {
    const content = sevetri();
    content.pricing.base_cents = 100_001; // 1 class: 100001 - 165000 would go negative, so use 3 classes
    content.pricing.per_class_cents = 0;
    const q = quoteProposal(content, pick("p-word", "p-logo", "p-c1"));
    expect(q.names[0].marks[1].price_cents).toBe(80_001); // 80000.8 -> 80001
    expect(Number.isInteger(q.legal_total_cents)).toBe(true);
  });
});

describe("quoteProposal: the Sevetri proposal as the firm preselects it", () => {
  const content = sevetri();
  const q = quoteProposal(content, defaultSelection(content));

  it("both names, 2 classes each, 4 marks", () => {
    expect(q.names.map((n) => [n.name, n.included, n.classes.length, n.marks.length])).toEqual([
      ["Prosperall", true, 2, 2],
      ["Tech4PublicGood", true, 2, 2],
    ]);
  });

  it("each name is $8,910.00 and the legal fee is $17,820.00", () => {
    expect(q.names.map((n) => n.legal_cents)).toEqual([891_000, 891_000]);
    expect(q.legal_subtotal_cents).toBe(1_782_000);
    expect(q.legal_total_cents).toBe(1_782_000);
  });

  it("USPTO fees are separate: 8 filing classes at $350.00, never in the legal fee", () => {
    expect(q.gov_class_count).toBe(8);
    expect(q.names.map((n) => n.gov_cents)).toEqual([140_000, 140_000]);
    expect(q.gov_total_cents).toBe(280_000);
    expect(q.legal_total_cents + q.gov_total_cents).not.toBe(q.legal_total_cents);
  });

  it("has no bare `total` to misread as what is due today", () => {
    expect(q).not.toHaveProperty("total");
  });
});

describe("quoteProposal: nothing is bought unless a mark AND a class are ticked", () => {
  it("nothing selected is 0 and 0", () => {
    const q = quoteProposal(sevetri(), {});
    expect(q.legal_total_cents).toBe(0);
    expect(q.gov_total_cents).toBe(0);
    expect(q.gov_class_count).toBe(0);
    expect(q.names.every((n) => !n.included)).toBe(true);
    expect(quoteHasItems(q)).toBe(false);
  });

  it("classes without a mark is 0", () => {
    const q = quoteProposal(sevetri(), pick("p-c1", "p-c2"));
    expect(q.legal_total_cents).toBe(0);
    expect(q.gov_total_cents).toBe(0);
    expect(q.names[0].classes).toEqual([]);
  });

  it("a mark without a class is 0", () => {
    const q = quoteProposal(sevetri(), pick("p-word", "p-logo"));
    expect(q.legal_total_cents).toBe(0);
    expect(q.names[0].marks).toEqual([]);
  });

  it("only the ticked name is included", () => {
    const q = quoteProposal(sevetri(), pick("t-logo", "t-c1"));
    expect(q.names.map((n) => n.included)).toEqual([false, true]);
    expect(q.names[0].legal_cents).toBe(0);
    expect(q.legal_total_cents).toBe(495_000);
    expect(q.gov_total_cents).toBe(35_000);
  });

  it("only a literal true ticks a box", () => {
    const sneaky = { "p-word": 1, "p-c1": "true", "p-c2": {} } as unknown as Selection;
    expect(quoteProposal(sevetri(), sneaky).legal_total_cents).toBe(0);
  });
});

describe("quoteProposal: price_override", () => {
  it("a different base for one brand, other brands untouched", () => {
    const content = sevetri();
    content.names[0].price_override = { base_cents: 450_000 };
    const q = quoteProposal(content, pick("p-word", "p-c1", "p-c2", "t-word", "t-c1", "t-c2"));
    expect(q.names[0].legal_cents).toBe(450_000); // flat: 2 classes is under the 3 included
    expect(q.names[1].legal_cents).toBe(495_000);
  });

  it("a different per-class amount for one brand", () => {
    const content = sevetri();
    content.names[0].price_override = { per_class_cents: 50_000 };
    const q = quoteProposal(content, pick("p-word", "p-c1"));
    expect(q.names[0].legal_cents).toBe(495_000); // under the included count the per-class amount does not apply
  });

  it("override fields are independent: setting one keeps the package's other", () => {
    const content = sevetri();
    content.names[0].price_override = { base_cents: 600_000 };
    const q = quoteProposal(content, pick("p-word", "p-c1"));
    expect(q.names[0].legal_cents).toBe(600_000);
  });

  it("an override of 0 is a real override, not 'unset'", () => {
    const content = sevetri();
    content.names[0].price_override = { base_cents: 0, per_class_cents: 0 };
    const q = quoteProposal(content, pick("p-word", "p-logo", "p-c1"));
    expect(q.names[0].legal_cents).toBe(0);
  });

  it("the second-mark discount applies to the overridden price", () => {
    const content = sevetri();
    content.names[0].price_override = { base_cents: 500_000, per_class_cents: 0 };
    const q = quoteProposal(content, pick("p-word", "p-logo", "p-c1"));
    expect(q.names[0].marks.map((m) => m.price_cents)).toEqual([500_000, 400_000]);
  });
});

describe("quoteProposal: adjustments on the legal fee", () => {
  const all = (c: ProposalContent) => quoteProposal(c, defaultSelection(c));

  it("an amount comes straight off, in cents", () => {
    const content = sevetri();
    content.adjustments = [{ id: "a1", label: "Consultation credit", kind: "amount", value: 45_000 }];
    const q = all(content);
    expect(q.legal_subtotal_cents).toBe(1_782_000);
    expect(q.discount_cents).toBe(45_000);
    expect(q.legal_total_cents).toBe(1_737_000);
    expect(q.adjustments[0]).toMatchObject({ id: "a1", discount_cents: 45_000 });
  });

  it("a percent is taken off the subtotal and rounded once", () => {
    const content = sevetri();
    content.adjustments = [{ id: "a1", label: "Referral", kind: "percent", value: 10 }];
    const q = all(content);
    expect(q.adjustments[0].discount_cents).toBe(178_200);
    expect(q.legal_total_cents).toBe(1_603_800);
  });

  it("percent adjustments are each taken from the SUBTOTAL, not compounded", () => {
    const content = sevetri();
    content.adjustments = [
      { id: "a1", label: "A", kind: "percent", value: 10 },
      { id: "a2", label: "B", kind: "percent", value: 10 },
    ];
    expect(all(content).legal_total_cents).toBe(1_782_000 - 178_200 * 2);
  });

  it("an amount and a percent together", () => {
    const content = sevetri();
    content.adjustments = [
      { id: "a1", label: "Credit", kind: "amount", value: 45_000 },
      { id: "a2", label: "Referral", kind: "percent", value: 5 },
    ];
    const q = all(content);
    expect(q.discount_cents).toBe(45_000 + 89_100);
    expect(q.legal_total_cents).toBe(1_782_000 - 45_000 - 89_100);
  });

  it("rounds a percent to the nearest cent", () => {
    const content = sevetri();
    content.pricing.base_cents = 333_333;
    content.pricing.per_class_cents = 0;
    content.adjustments = [{ id: "a1", label: "x", kind: "percent", value: 10 }];
    const q = quoteProposal(content, pick("p-word", "p-c1"));
    expect(q.adjustments[0].discount_cents).toBe(33_333); // 33333.3
    expect(q.legal_total_cents).toBe(300_000);
  });

  it("the total never goes below zero and the discounts add up to what was taken", () => {
    const content = sevetri();
    content.adjustments = [
      { id: "a1", label: "Big credit", kind: "amount", value: 9_999_999 },
      { id: "a2", label: "Another", kind: "amount", value: 5_000 },
    ];
    const q = all(content);
    expect(q.legal_total_cents).toBe(0);
    expect(q.discount_cents).toBe(1_782_000);
    expect(q.adjustments.map((a) => a.discount_cents)).toEqual([1_782_000, 0]);
    expect(q.adjustments.reduce((s, a) => s + a.discount_cents, 0)).toBe(q.discount_cents);
  });

  it("100% off is exactly zero; the USPTO fee is untouched by adjustments", () => {
    const content = sevetri();
    content.adjustments = [{ id: "a1", label: "Pro bono", kind: "percent", value: 100 }];
    const q = all(content);
    expect(q.legal_total_cents).toBe(0);
    expect(q.gov_total_cents).toBe(280_000);
  });

  it("adjustments apply only when there is a legal fee", () => {
    const content = sevetri();
    content.adjustments = [{ id: "a1", label: "Credit", kind: "amount", value: 45_000 }];
    const q = quoteProposal(content, {});
    expect(q.discount_cents).toBe(0);
    expect(q.legal_total_cents).toBe(0);
    expect(q.adjustments[0].discount_cents).toBe(0);
  });

  it("a negative amount cannot raise the price", () => {
    const content = sevetri();
    content.adjustments = [{ id: "a1", label: "?", kind: "amount", value: -50_000 }];
    expect(all(content).legal_total_cents).toBe(1_782_000);
  });

  it("a percent outside 0..100 is clamped", () => {
    const content = sevetri();
    content.adjustments = [{ id: "a1", label: "?", kind: "percent", value: 250 }];
    expect(all(content).legal_total_cents).toBe(0);
    content.adjustments = [{ id: "a1", label: "?", kind: "percent", value: -20 }];
    expect(all(content).legal_total_cents).toBe(1_782_000);
  });
});

describe("quoteProposal: total, never throwing", () => {
  it("survives missing arrays, junk numbers and a null selection", () => {
    const junk = {
      pricing: { base_cents: "495000", per_class_cents: NaN, included_classes: null },
      names: [{ id: "n", name: "N", marks: [{ id: "m", kind: "word", desc: "", preselected: true }], classes: null }],
    } as unknown as ProposalContent;
    expect(() => quoteProposal(junk, null as unknown as Selection)).not.toThrow();
    expect(quoteProposal(junk, { m: true }).legal_total_cents).toBe(0);
    expect(() => quoteProposal({} as ProposalContent, {})).not.toThrow();
  });

  it("a name priced below zero is priced at zero, not negative", () => {
    const content = sevetri();
    content.names[0].price_override = { base_cents: -100_000 };
    const q = quoteProposal(content, pick("p-word", "p-c1"));
    expect(q.names[0].legal_cents).toBe(0);
    expect(q.legal_total_cents).toBe(0);
  });
});

describe("defaultSelection and normalizeSelection", () => {
  it("defaultSelection ticks the preselected ids and lists the rest as false", () => {
    const content = sevetri();
    content.names[0].marks[1].preselected = false;
    content.names[1].classes[1].preselected = false;
    const sel = defaultSelection(content);
    expect(sel["p-word"]).toBe(true);
    expect(sel["p-logo"]).toBe(false);
    expect(sel["t-c2"]).toBe(false);
    expect(Object.keys(sel).sort()).toEqual(
      ["p-c1", "p-c2", "p-logo", "p-word", "t-c1", "t-c2", "t-logo", "t-word"],
    );
  });

  it("nothing preselected prices at zero", () => {
    const content = sevetri();
    for (const n of content.names) {
      for (const m of n.marks) m.preselected = false;
      for (const c of n.classes) c.preselected = false;
    }
    expect(quoteProposal(content, defaultSelection(content)).legal_total_cents).toBe(0);
  });

  it("normalizeSelection keeps only offered ids, as real booleans", () => {
    const sel = normalizeSelection(sevetri(), {
      "p-word": true,
      "p-logo": "yes",
      "t-c1": 1,
      "not-an-id": true,
      __proto__: true,
    });
    expect(sel["p-word"]).toBe(true);
    expect(sel["p-logo"]).toBe(false);
    expect(sel["t-c1"]).toBe(false);
    expect("not-an-id" in sel).toBe(false);
    expect(Object.values(sel).every((v) => typeof v === "boolean")).toBe(true);
    expect(normalizeSelection(sevetri(), "garbage")["p-word"]).toBe(false);
  });
});


/* ───────────── Sprint 28 B2: a package is flat up to its included classes ───────────── */

describe("quoteProposal: the package decides what an added class costs", () => {
  const PACKAGES = {
    Essential: { base_cents: 195_000, included_classes: 1, per_class_cents: 82_500 },
    Enhanced: { base_cents: 295_000, included_classes: 2, per_class_cents: 82_500 },
    Concierge: { base_cents: 495_000, included_classes: 3, per_class_cents: 82_500 },
  } as const;

  /** One brand name, one mark, n classes ticked. */
  function priced(pkg: keyof typeof PACKAGES, classes: number, extra: Record<string, unknown> = {}) {
    const c = sevetri();
    c.pricing = { ...c.pricing, package: pkg, ...PACKAGES[pkg], ...extra };
    c.names = [{ ...c.names[0], marks: [c.names[0].marks[0]], classes: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, label: `C${i}`, preselected: false })) }];
    return quoteProposal(c, pick("p-word", ...Array.from({ length: classes }, (_, i) => `c${i}`)));
  }
  const step = (pkg: keyof typeof PACKAGES, from: number, to: number) => {
    const a = priced(pkg, from);
    const b = priced(pkg, to);
    return { legal: b.legal_total_cents - a.legal_total_cents, gov: b.gov_total_cents - a.gov_total_cents };
  };

  it("Essential 1 -> 2 classes = +$825 legal +$350 USPTO", () => {
    expect(step("Essential", 1, 2)).toEqual({ legal: 82_500, gov: 35_000 });
    expect(priced("Essential", 1).legal_total_cents).toBe(195_000);
  });
  it("Enhanced 1 -> 2 classes = +$0 legal +$350 USPTO, and 1 class is still the flat $2,950", () => {
    expect(step("Enhanced", 1, 2)).toEqual({ legal: 0, gov: 35_000 });
    expect(priced("Enhanced", 1).legal_total_cents).toBe(295_000);
    expect(step("Enhanced", 2, 3)).toEqual({ legal: 82_500, gov: 35_000 });
  });
  it("Concierge 1 -> 3 = +$0 legal +$700 USPTO; 3 -> 4 = +$825 +$350; 1 class is the flat $4,950", () => {
    expect(priced("Concierge", 1).legal_total_cents).toBe(495_000);
    expect(step("Concierge", 1, 3)).toEqual({ legal: 0, gov: 70_000 });
    expect(step("Concierge", 3, 4)).toEqual({ legal: 82_500, gov: 35_000 });
  });
  it("USPTO is $350 per class even inside the included count, and is not touched by credits, the second-mark percent or the custom switch", () => {
    const c = sevetri();
    c.adjustments = [{ id: "a", label: "Credit", kind: "percent", value: 50 }];
    const base = quoteProposal(c, pick("p-word", "p-logo", "p-c1", "p-c2"));
    expect(base.gov_total_cents).toBe(4 * 35_000);
    c.pricing = { ...c.pricing, second_mark_discount_pct: 50, reduce_under_included: true };
    expect(quoteProposal(c, pick("p-word", "p-logo", "p-c1", "p-c2")).gov_total_cents).toBe(4 * 35_000);
  });
  it("reduce_under_included: absent or false is flat; true restores $825 less per class under the included count", () => {
    expect(priced("Concierge", 1, { reduce_under_included: false }).legal_total_cents).toBe(495_000);
    expect(priced("Concierge", 1, { reduce_under_included: "yes" }).legal_total_cents).toBe(495_000);
    expect(priced("Concierge", 1, { reduce_under_included: true }).legal_total_cents).toBe(495_000 - 2 * 82_500);
    expect(priced("Concierge", 2, { reduce_under_included: true }).legal_total_cents).toBe(495_000 - 82_500);
    expect(priced("Concierge", 3, { reduce_under_included: true }).legal_total_cents).toBe(495_000);
  });
  it("reduce_under_included never takes a name below zero", () => {
    expect(priced("Essential", 1, { base_cents: 10_000, included_classes: 5, reduce_under_included: true }).legal_total_cents).toBe(0);
  });
});

describe("isFixedOffer: no checkboxes when there is nothing to choose", () => {
  const one = (): ProposalContent => {
    const c = sevetri();
    c.names = [c.names[0]];
    c.names[0].marks = [c.names[0].marks[0]];
    c.names[0].classes = [c.names[0].classes[0]];
    return c;
  };

  it("one name, one mark, one class is fixed", () => {
    expect(isFixedOffer(one())).toBe(true);
  });

  it("two classes is a choice", () => {
    const c = one();
    c.names[0].classes.push({ id: "p-c2", label: "Consulting", preselected: false });
    expect(isFixedOffer(c)).toBe(false);
  });

  it("word + logo is a choice", () => {
    const c = sevetri();
    c.names = [c.names[0]];
    c.names[0].classes = [c.names[0].classes[0]];
    expect(isFixedOffer(c)).toBe(false);
  });

  it("two brand names is a choice", () => {
    const c = sevetri();
    for (const nm of c.names) {
      nm.marks = [nm.marks[0]];
      nm.classes = [nm.classes[0]];
    }
    expect(isFixedOffer(c)).toBe(false);
  });

  it("malformed content is not fixed", () => {
    expect(isFixedOffer({} as ProposalContent)).toBe(false);
    expect(isFixedOffer(null as unknown as ProposalContent)).toBe(false);
    expect(isFixedOffer({ names: "x" } as unknown as ProposalContent)).toBe(false);
    const noId = one() as unknown as { names: { marks: unknown[] }[] };
    noId.names[0].marks = [{ kind: "word" }];
    expect(isFixedOffer(noId as unknown as ProposalContent)).toBe(false);
    const noClasses = one();
    noClasses.names[0].classes = [];
    expect(isFixedOffer(noClasses)).toBe(false);
  });
});

describe("wouldEmptyQuote / lockedSelectionIds: a client can never untick to $0", () => {
  /** One brand name, one mark, one class. */
  function single(): ProposalContent {
    const c = sevetri();
    c.names = [c.names[0]];
    c.names[0].marks = [c.names[0].marks[0]];
    c.names[0].classes = [c.names[0].classes[0]];
    return c;
  }
  const locked = (c: ProposalContent, s: Selection) => [...lockedSelectionIds(c, s)].sort();

  it("one brand, one mark, one class: both are locked", () => {
    const c = single();
    const s = pick("p-word", "p-c1");
    expect(locked(c, s)).toEqual(["p-c1", "p-word"]);
    expect(wouldEmptyQuote(c, s, "p-word")).toBe(true);
    expect(wouldEmptyQuote(c, s, "p-c1")).toBe(true);
  });

  it("one brand, two classes: neither class is locked until one is left; the only mark is", () => {
    const c = sevetri();
    c.names = [c.names[0]];
    expect(locked(c, pick("p-word", "p-c1", "p-c2"))).toEqual(["p-word"]);
    expect(locked(c, pick("p-word", "p-c2"))).toEqual(["p-c2", "p-word"]);
  });

  it("one brand, two marks: neither mark is locked until one is left", () => {
    const c = sevetri();
    c.names = [c.names[0]];
    expect(locked(c, pick("p-word", "p-logo", "p-c1"))).toEqual(["p-c1"]);
    expect(locked(c, pick("p-logo", "p-c1"))).toEqual(["p-c1", "p-logo"]);
  });

  it("two brands: nothing is locked while both are buyable", () => {
    const c = sevetri();
    expect(locked(c, defaultSelection(c))).toEqual([]);
    expect(locked(c, pick("p-word", "p-c1", "t-logo", "t-c1"))).toEqual([]);
  });

  it("two brands, one not buyable: the other's last mark and class lock, the first stays free", () => {
    const c = sevetri();
    // Prosperall has a mark but no class, so it isn't buyable; Tech4PublicGood is the only one left.
    const s = pick("p-word", "t-logo", "t-c1");
    expect(locked(c, s)).toEqual(["t-c1", "t-logo"]);
    expect(wouldEmptyQuote(c, s, "p-word")).toBe(false);
  });

  it("nothing selected (no preselected items): nothing is locked, so the client can tick their way in", () => {
    const c = sevetri();
    for (const nm of c.names) {
      for (const m of nm.marks) m.preselected = false;
      for (const k of nm.classes) k.preselected = false;
    }
    const s = defaultSelection(c);
    expect(quoteHasItems(quoteProposal(c, s))).toBe(false);
    expect(locked(c, s)).toEqual([]);
    // A mark ticked but no class yet: still empty, still nothing locked.
    expect(locked(c, { ...s, "p-word": true })).toEqual([]);
  });

  it("a fixed offer: defaultSelection and normalizeSelection tick its mark and class regardless of input", () => {
    const c = single();
    c.names[0].marks[0].preselected = false;
    c.names[0].classes[0].preselected = false;
    const full = { "p-word": true, "p-c1": true };
    expect(defaultSelection(c)).toEqual(full);
    expect(normalizeSelection(c, {})).toEqual(full);
    expect(normalizeSelection(c, "garbage")).toEqual(full);
    expect(normalizeSelection(c, { "p-word": false, "evil-id": true })).toEqual(full);
    // Flat package (Sprint 28): one class of a 3-class Concierge is the full $4,950 (PR #4 pinned the old $3,300 reduction).
    expect(quoteProposal(c, normalizeSelection(c, {})).legal_total_cents).toBe(495_000);
  });

  it("an unticked id is never locked, and garbage reads as not locked", () => {
    const c = single();
    expect(wouldEmptyQuote(c, pick("p-word", "p-c1"), "nope")).toBe(false);
    expect(wouldEmptyQuote(c, {}, "p-word")).toBe(false);
    expect(lockedSelectionIds({} as ProposalContent, {}).size).toBe(0);
  });
});
