import { describe, it, expect } from "vitest";

import {
  defaultSelection,
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
 * page: a Concierge package is $4,950 with 3 classes, $825 more or less per
 * class, 20% off the second mark of the SAME brand name, and the USPTO's $350
 * per class per mark is due at filing, not with the legal fee.
 */

/** Tick exactly these ids. */
const pick = (...ids: string[]): Selection => Object.fromEntries(ids.map((id) => [id, true]));

describe("quoteProposal: the firm's Concierge price by class count", () => {
  it("1 class is $3,300.00", () => {
    const q = quoteProposal(sevetri(), pick("p-word", "p-c1"));
    expect(q.names[0].base_cents).toBe(330_000);
    expect(q.names[0].legal_cents).toBe(330_000);
    expect(q.legal_total_cents).toBe(330_000);
  });

  it("2 classes is $4,125.00", () => {
    const q = quoteProposal(sevetri(), pick("p-word", "p-c1", "p-c2"));
    expect(q.legal_total_cents).toBe(412_500);
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
    expect(first.price_cents).toBe(412_500);
    expect(first.second).toBe(false);
    expect(second.price_cents).toBe(330_000); // 412500 x 0.8
    expect(second.second).toBe(true);
    expect(q.names[0].legal_cents).toBe(742_500);
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
    expect(q.names.map((n) => n.legal_cents)).toEqual([330_000, 330_000]);
    expect(q.legal_total_cents).toBe(660_000);
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

  it("each name is $7,425.00 and the legal fee is $14,850.00", () => {
    expect(q.names.map((n) => n.legal_cents)).toEqual([742_500, 742_500]);
    expect(q.legal_subtotal_cents).toBe(1_485_000);
    expect(q.legal_total_cents).toBe(1_485_000);
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
    expect(q.legal_total_cents).toBe(330_000);
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
    expect(q.names[0].legal_cents).toBe(450_000 + 82_500 * (2 - 3));
    expect(q.names[1].legal_cents).toBe(412_500);
  });

  it("a different per-class amount for one brand", () => {
    const content = sevetri();
    content.names[0].price_override = { per_class_cents: 50_000 };
    const q = quoteProposal(content, pick("p-word", "p-c1"));
    expect(q.names[0].legal_cents).toBe(495_000 - 2 * 50_000);
  });

  it("override fields are independent: setting one keeps the package's other", () => {
    const content = sevetri();
    content.names[0].price_override = { base_cents: 600_000 };
    const q = quoteProposal(content, pick("p-word", "p-c1"));
    expect(q.names[0].legal_cents).toBe(600_000 - 2 * 82_500);
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
    expect(q.legal_subtotal_cents).toBe(1_485_000);
    expect(q.discount_cents).toBe(45_000);
    expect(q.legal_total_cents).toBe(1_440_000);
    expect(q.adjustments[0]).toMatchObject({ id: "a1", discount_cents: 45_000 });
  });

  it("a percent is taken off the subtotal and rounded once", () => {
    const content = sevetri();
    content.adjustments = [{ id: "a1", label: "Referral", kind: "percent", value: 10 }];
    const q = all(content);
    expect(q.adjustments[0].discount_cents).toBe(148_500);
    expect(q.legal_total_cents).toBe(1_336_500);
  });

  it("percent adjustments are each taken from the SUBTOTAL, not compounded", () => {
    const content = sevetri();
    content.adjustments = [
      { id: "a1", label: "A", kind: "percent", value: 10 },
      { id: "a2", label: "B", kind: "percent", value: 10 },
    ];
    expect(all(content).legal_total_cents).toBe(1_485_000 - 148_500 * 2);
  });

  it("an amount and a percent together", () => {
    const content = sevetri();
    content.adjustments = [
      { id: "a1", label: "Credit", kind: "amount", value: 45_000 },
      { id: "a2", label: "Referral", kind: "percent", value: 5 },
    ];
    const q = all(content);
    expect(q.discount_cents).toBe(45_000 + 74_250);
    expect(q.legal_total_cents).toBe(1_485_000 - 45_000 - 74_250);
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
    expect(q.discount_cents).toBe(1_485_000);
    expect(q.adjustments.map((a) => a.discount_cents)).toEqual([1_485_000, 0]);
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
    expect(all(content).legal_total_cents).toBe(1_485_000);
  });

  it("a percent outside 0..100 is clamped", () => {
    const content = sevetri();
    content.adjustments = [{ id: "a1", label: "?", kind: "percent", value: 250 }];
    expect(all(content).legal_total_cents).toBe(0);
    content.adjustments = [{ id: "a1", label: "?", kind: "percent", value: -20 }];
    expect(all(content).legal_total_cents).toBe(1_485_000);
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
    content.names[0].price_override = { base_cents: 100_000 };
    const q = quoteProposal(content, pick("p-word", "p-c1")); // 100000 - 2 x 82500 < 0
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

  it("an unticked id is never locked, and garbage reads as not locked", () => {
    const c = single();
    expect(wouldEmptyQuote(c, pick("p-word", "p-c1"), "nope")).toBe(false);
    expect(wouldEmptyQuote(c, {}, "p-word")).toBe(false);
    expect(lockedSelectionIds({} as ProposalContent, {}).size).toBe(0);
  });
});
