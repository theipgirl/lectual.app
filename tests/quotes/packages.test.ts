import { describe, expect, it } from "vitest";

import {
  applyClientChoice,
  describeSignedChoice,
  isOfferIntact,
  normalizePackageName,
  offerHeadline,
  offerProblems,
  offeredLines,
  packageBlurb,
  readClientChoice,
  readOffer,
} from "@/lib/quotes/packages";
import { fullProjectCost, quoteReadiness, quoteTotals, type QuoteLineInput } from "@/lib/quotes/pricing";

/**
 * The design's quote builder on 0068's table, with no schema change
 * (packages.ts):
 *
 *   included    → in every package
 *   tier_option → a package's line; tier_group is the package's name
 *   optional    → an add-on
 *
 * and `selected` on a package/add-on line is the FIRM's offer switch until the
 * client signs. These pin that mapping: which lines a client is shown, what a
 * package costs, how a pick is validated and projected, and what the builder
 * and Send refuse.
 *
 * The fixture is the design's own prototype data, in cents.
 */

function line(over: Partial<QuoteLineInput> & { id: string }): QuoteLineInput & { id: string } {
  return {
    kind: "legal_fee",
    charge_at: "signing",
    selection: "included",
    tier_group: null,
    selected: true,
    quantity: 1,
    unit_amount_cents: 0,
    label: over.id,
    ...over,
  };
}
const pkg = (id: string, name: string, cents: number, over: Partial<QuoteLineInput> = {}) =>
  line({ selection: "tier_option", tier_group: name, unit_amount_cents: cents, ...over, id });
const gov = { kind: "government_fee", charge_at: "filing" } as const;

/** design/Quote_Builder_Prototype.dc.html's two packages and two add-ons. */
function prototype(): (QuoteLineInput & { id: string })[] {
  return [
    pkg("f1", "Full prosecution", 145_000, { label: "Clearance search, two classes" }),
    pkg("f2", "Full prosecution", 90_000, { label: "Filing, class 25" }),
    pkg("f3", "Full prosecution", 90_000, { label: "Filing, class 35" }),
    pkg("f4", "Full prosecution", 95_000, { label: "Office action response allowance" }),
    pkg("f5", "Full prosecution", 35_000, { label: "USPTO fee, class 25", ...gov }),
    pkg("f6", "Full prosecution", 35_000, { label: "USPTO fee, class 35", ...gov }),
    pkg("o1", "Filing only", 95_000, { label: "Clearance search, two classes" }),
    pkg("o2", "Filing only", 90_000, { label: "Filing, class 25" }),
    pkg("o3", "Filing only", 90_000, { label: "Filing, class 35" }),
    pkg("o4", "Filing only", 35_000, { label: "USPTO fee, class 25", ...gov }),
    pkg("o5", "Filing only", 35_000, { label: "USPTO fee, class 35", ...gov }),
    line({ id: "a1", selection: "optional", selected: true, unit_amount_cents: 60_000, label: "Watch service, 12 months" }),
    line({ id: "a2", selection: "optional", selected: false, unit_amount_cents: 25_000, label: "Design mark drawing" }),
  ];
}

describe("readOffer — packages, add-ons and the every-package lines", () => {
  it("reads the prototype's two packages with the design's tab figures", () => {
    const offer = readOffer(prototype());
    expect(offer.packages.map((p) => p.name)).toEqual(["Full prosecution", "Filing only"]);
    // The tabs read "$4,200 + $700 at filing" and "$2,750 + $700 at filing".
    expect(offer.packages[0].totals).toMatchObject({ dueAtSigning: 420_000, dueAtFiling: 70_000 });
    expect(offer.packages[1].totals).toMatchObject({ dueAtSigning: 275_000, dueAtFiling: 70_000 });
    expect(fullProjectCost(offer.packages[0].totals)).toBe(490_000);
    expect(offer.addOns.map((a) => [a.line.id, a.offered])).toEqual([
      ["a1", true],
      ["a2", false],
    ]);
  });

  it("adds the every-package lines to each package's price", () => {
    const offer = readOffer([...prototype(), line({ id: "c1", unit_amount_cents: 10_000 })]);
    expect(offer.packages[1].totals.dueAtSigning).toBe(285_000);
    expect(offer.commonTotals.dueAtSigning).toBe(10_000);
  });

  it("prices a package as chosen even while the rows say it is withheld", () => {
    const lines = prototype().map((l) => (l.tier_group === "Filing only" ? { ...l, selected: false } : l));
    const filing = readOffer(lines).packages[1];
    expect(filing.offered).toBe(false);
    expect(filing.totals.dueAtSigning).toBe(275_000);
  });

  it("calls a package with some lines on and some off MIXED, and not offered", () => {
    const lines = prototype().map((l) => (l.id === "o3" ? { ...l, selected: false } : l));
    const filing = readOffer(lines).packages[1];
    expect(filing).toMatchObject({ offered: false, mixed: true });
  });

  it("puts a line it cannot place aside instead of guessing", () => {
    const offer = readOffer([line({ id: "x", selection: "bundle_option" }), line({ id: "y", selection: "tier_option", tier_group: "  " })]);
    expect(offer.unplaced.map((l) => l.id)).toEqual(["x", "y"]);
    expect(offer.packages).toEqual([]);
  });
});

describe("offeredLines — what a client is shown", () => {
  it("keeps every-package lines, offered packages and offered add-ons, in order", () => {
    const lines = [line({ id: "c1" }), ...prototype().map((l) => (l.tier_group === "Filing only" ? { ...l, selected: false } : l))];
    expect(offeredLines(lines).map((l) => l.id)).toEqual(["c1", "f1", "f2", "f3", "f4", "f5", "f6", "a1"]);
  });

  it("never shows half a package", () => {
    const lines = prototype().map((l) => (l.id === "o3" ? { ...l, selected: false } : l));
    expect(offeredLines(lines).some((l) => l.tier_group === "Filing only")).toBe(false);
  });

  it("drops lines it cannot place", () => {
    expect(offeredLines([line({ id: "x", selection: "bundle_option" })])).toEqual([]);
  });
});

describe("applyClientChoice — the pick, validated against the offer", () => {
  const shown = () => offeredLines(prototype());

  it("takes the chosen package whole, and the ticked add-ons", () => {
    const result = applyClientChoice(shown(), { package: "Filing only", addOns: ["a1"] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines.filter((l) => l.selected).map((l) => l.id)).toEqual(["o1", "o2", "o3", "o4", "o5", "a1"]);
    expect(quoteReadiness(result.lines)).toEqual({ ready: true });
    // The design's client page: Due today $2,750 + $600; later, at filing, $700.
    expect(quoteTotals(result.lines)).toMatchObject({ dueAtSigning: 335_000, dueAtFiling: 70_000 });
  });

  it("leaves readiness to say 'Choose a package.' when none is picked", () => {
    const result = applyClientChoice(shown(), { package: null, addOns: [] });
    expect(result.ok && quoteReadiness(result.lines)).toMatchObject({ ready: false, message: "Choose a package." });
  });

  it("refuses a package that is not in what the client was shown", () => {
    expect(applyClientChoice(shown(), { package: "Budget", addOns: [] })).toEqual({ ok: false, reason: "unknown_package" });
    // A withheld one included: it is not in `shown`.
    const withheld = offeredLines(prototype().map((l) => (l.tier_group === "Filing only" ? { ...l, selected: false } : l)));
    expect(applyClientChoice(withheld, { package: "Filing only", addOns: [] })).toEqual({ ok: false, reason: "unknown_package" });
  });

  it("refuses an add-on that is withheld, an every-package line, or a package line", () => {
    for (const id of ["a2", "f1", "nope"]) {
      expect(applyClientChoice(shown(), { package: "Full prosecution", addOns: [id] }), id).toEqual({ ok: false, reason: "unknown_add_on" });
    }
  });

  it("reads a posted choice defensively", () => {
    expect(readClientChoice(undefined)).toEqual({ package: null, addOns: [] });
    expect(readClientChoice({ package: "  Full  ", addOns: ["a1", 7, null] })).toEqual({ package: "Full", addOns: ["a1"] });
    expect(readClientChoice({ package: 12, addOns: "a1" })).toEqual({ package: null, addOns: [] });
  });
});

describe("offerProblems and isOfferIntact — what the builder and Send refuse", () => {
  it("is quiet about a sound offer", () => {
    expect(offerProblems(prototype())).toEqual([]);
    expect(isOfferIntact(prototype())).toBe(true);
  });

  it("refuses to send an empty quote", () => {
    expect(offerProblems([])).toEqual([expect.objectContaining({ reason: "no_lines", blocksSending: true })]);
  });

  it("refuses packages with none offered — and the public side refuses to sign it", () => {
    const lines = prototype().map((l) => (l.selection === "tier_option" ? { ...l, selected: false } : l));
    expect(offerProblems(lines)).toContainEqual(expect.objectContaining({ reason: "no_package_offered", blocksSending: true }));
    expect(isOfferIntact(lines)).toBe(false);
  });

  it("names a mixed package", () => {
    const lines = prototype().map((l) => (l.id === "o3" ? { ...l, selected: false } : l));
    expect(offerProblems(lines)).toContainEqual(expect.objectContaining({ reason: "package_mixed", packageName: "Filing only", blocksSending: true }));
  });

  it("checks integrity on every choice the client can make, as a warning", () => {
    // A discount bigger than the fees exists only on "Filing only". It is still
    // this quote's problem, and the accept path refuses it on its own.
    const lines = [...prototype(), pkg("o6", "Filing only", -400_000, { kind: "discount" })];
    const problems = offerProblems(lines);
    expect(problems).toContainEqual(expect.objectContaining({ reason: "negative_amount_due", blocksSending: false }));
    expect(problems.some((p) => p.reason === "tier_group_unselected")).toBe(false);
  });

  it("refuses a line it cannot place", () => {
    const lines = [...prototype(), line({ id: "x", selection: "bundle_option" })];
    expect(offerProblems(lines)).toContainEqual(expect.objectContaining({ reason: "unplaced_line", blocksSending: true }));
    expect(isOfferIntact(lines)).toBe(false);
  });
});

describe("display", () => {
  it("derives the package blurb from its own lines, leaving the USPTO fees to the price", () => {
    const filing = readOffer(prototype()).packages[1];
    expect(packageBlurb(filing.lines)).toBe("Clearance search, two classes · Filing, class 25 · Filing, class 35");
  });

  it("normalises a package name, and refuses an empty or oversized one", () => {
    expect(normalizePackageName("  Filing   only ")).toBe("Filing only");
    expect(normalizePackageName("   ")).toBeNull();
    expect(normalizePackageName("x".repeat(121))).toBeNull();
    expect(normalizePackageName(7)).toBeNull();
  });

  it("gives the list a range across the offered packages, add-ons excluded", () => {
    expect(offerHeadline(prototype())).toMatchObject({
      dueAtSigning: { low: 275_000, high: 420_000 },
      fullProjectCost: { low: 345_000, high: 490_000 },
    });
    // A quote without packages is one price: its every-package lines.
    expect(offerHeadline([line({ id: "c", unit_amount_cents: 150_000 })]).dueAtSigning).toEqual({ low: 150_000, high: 150_000 });
  });

  it("reads a signed record in the design's order: fees, add-ons, then filing", () => {
    const signed = applyClientChoice(offeredLines(prototype()), { package: "Filing only", addOns: ["a1"] });
    if (!signed.ok) throw new Error("expected ok");
    const snapshotLines = signed.lines.map((l) => ({
      id: l.id,
      label: String(l.label),
      kind: String(l.kind),
      charge_at: String(l.charge_at),
      selection: String(l.selection),
      tier_group: l.tier_group ?? null,
      selected: Boolean(l.selected),
      quantity: 1,
      unit_amount_cents: Number(l.unit_amount_cents),
      amount_cents: Number(l.unit_amount_cents),
    }));
    const choice = describeSignedChoice(snapshotLines);
    expect(choice.packageName).toBe("Filing only");
    expect(choice.agreed.map((l) => l.id)).toEqual(["o1", "o2", "o3", "a1", "o4", "o5"]);
    expect(choice.agreed.filter((l) => l.bucket === "filing").map((l) => l.label)).toEqual(["USPTO fee, class 25", "USPTO fee, class 35"]);
    expect(choice.otherPackages).toEqual(["Full prosecution"]);
    expect(choice.declinedAddOns).toEqual([]);
  });
});
