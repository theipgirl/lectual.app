import { describe, it, expect } from "vitest";

import * as pricing from "@/lib/quotes/pricing";
import {
  discountBaseCents,
  fullProjectCost,
  isLineSelected,
  lineAmountCents,
  percentDiscountCents,
  quoteBlockers,
  quoteReadiness,
  quoteTotals,
  tierGroups,
  type QuoteLineInput,
} from "@/lib/quotes/pricing";

/**
 * The whole risk in quote pricing is a number that is TRUE but presented as
 * an answer to a question nobody asked.
 *
 * Spec §0: the USPTO's government fees are charged at filing, never at
 * signing. So "$3,125" is a correct sum and a false statement about what the
 * client is paying today — and it is a false statement on the page where they
 * type their name. These tests pin the split, and pin the one-way guarantee
 * that no arrangement of line data can move a government fee into the amount
 * due at signing.
 *
 * The rest pin tolerance: these rows come from a schema that will keep moving,
 * and a totals panel that throws takes the client's quote page down, whereas
 * one that reports a blocker takes the accept button down and says why.
 */

/** A line with the column defaults 0068 declares, overridable per test. */
function line(over: Partial<QuoteLineInput> = {}): QuoteLineInput {
  return {
    id: "l1",
    kind: "legal_fee",
    charge_at: "signing",
    selection: "included",
    selected: true,
    quantity: 1,
    unit_amount_cents: 0,
    ...over,
  };
}

describe("quoteTotals — the signing/filing split", () => {
  it("returns zeros and a currency for a quote with no lines", () => {
    expect(quoteTotals([])).toEqual({
      dueAtSigning: 0,
      dueAtFiling: 0,
      notCharged: 0,
      currency: "USD",
    });
  });

  it("splits a real trademark quote into what is due when", () => {
    // The example from spec §0: a $2,775 flat fee at signing, plus $350/class
    // USPTO fees the client will owe at filing. 2775_00 + 350_00 = 3125_00 —
    // the very figure the spec calls a false statement when shown alone.
    const lines = [
      line({ id: "fee", kind: "legal_fee", charge_at: "signing", unit_amount_cents: 277_500 }),
      line({
        id: "uspto",
        kind: "government_fee",
        charge_at: "filing",
        quantity: 1,
        unit_amount_cents: 35_000,
      }),
    ];

    const totals = quoteTotals(lines);
    expect(totals.dueAtSigning).toBe(277_500);
    expect(totals.dueAtFiling).toBe(35_000);
    expect(totals.notCharged).toBe(0);
    expect(fullProjectCost(totals)).toBe(312_500);
  });

  it("multiplies quantity — two classes is two government fees", () => {
    const totals = quoteTotals([
      line({ kind: "government_fee", charge_at: "filing", quantity: 3, unit_amount_cents: 35_000 }),
    ]);
    expect(totals.dueAtFiling).toBe(105_000);
    expect(totals.dueAtSigning).toBe(0);
  });

  it("keeps not_charged money out of both amounts due AND out of the project cost", () => {
    const totals = quoteTotals([
      line({ id: "fee", unit_amount_cents: 100_000 }),
      line({ id: "gift", charge_at: "not_charged", unit_amount_cents: 25_000 }),
    ]);
    expect(totals.dueAtSigning).toBe(100_000);
    expect(totals.notCharged).toBe(25_000);
    // The client never pays the waived line, so it is not part of the cost.
    expect(fullProjectCost(totals)).toBe(100_000);
  });

  it("carries the quote's currency through, defaulting to USD", () => {
    expect(quoteTotals([], "CAD").currency).toBe("CAD");
    expect(quoteTotals([], "").currency).toBe("USD");
  });
});

describe("§0 — a government fee can never reach dueAtSigning", () => {
  it("buckets a government fee to filing even when charge_at says signing", () => {
    // 0068's check constraint makes this row impossible in the database. This
    // module is the second line of defence, for the row that got in anyway —
    // a service-role insert, a bad backfill, a future migration that drops the
    // constraint. There must be no input that produces a signing charge here.
    const totals = quoteTotals([
      line({ kind: "government_fee", charge_at: "signing", unit_amount_cents: 35_000 }),
    ]);
    expect(totals.dueAtSigning).toBe(0);
    expect(totals.dueAtFiling).toBe(35_000);
  });

  it("holds for every charge_at value, including ones this build doesn't know", () => {
    for (const chargeAt of ["signing", "filing", "not_charged", "monthly", "", null]) {
      const totals = quoteTotals([
        line({ kind: "government_fee", charge_at: chargeAt as string, unit_amount_cents: 35_000 }),
      ]);
      expect(totals.dueAtSigning).toBe(0);
    }
  });

  it("reports the violation rather than quietly repairing it", () => {
    const blockers = quoteBlockers([
      line({ kind: "government_fee", charge_at: "signing", unit_amount_cents: 35_000 }),
    ]);
    expect(blockers.map((b) => b.reason)).toContain("government_fee_at_signing");
  });

  it("does not extend the §0 override past `signing` — a waived USPTO fee stays waived", () => {
    // The mirror image of the bug above, and the one that actually shipped:
    // `bucketOf` forced EVERY government_fee to `filing`, so a firm writing
    // "USPTO filing fee (1 class) — included in your flat fee" as
    // government_fee / not_charged / $350 quoted the client "$350.00, charged
    // when your application is filed" — money the firm had just said it would
    // not charge — and froze it into accepted_snapshot.totals.due_at_filing.
    //
    // The combination is offered on purpose: 0068's check is
    // `kind <> 'government_fee' or charge_at <> 'signing'`, so not_charged
    // passes it, and the Add Line dropdown filters only `signing` out of the
    // government-fee schedules. §0 is about dueAtSigning and says nothing
    // about not_charged.
    const lines = [
      line({ id: "fee", kind: "legal_fee", charge_at: "signing", unit_amount_cents: 250_000 }),
      line({ id: "uspto", kind: "government_fee", charge_at: "not_charged", unit_amount_cents: 35_000 }),
    ];

    const totals = quoteTotals(lines);
    expect(totals.dueAtSigning).toBe(250_000);
    expect(totals.dueAtFiling).toBe(0);
    expect(totals.notCharged).toBe(35_000);
    // The client never pays it, so it is not part of the project cost either.
    expect(fullProjectCost(totals)).toBe(250_000);
    // And it is a legal quote, not a data-integrity problem: nothing to fix.
    expect(quoteBlockers(lines)).toEqual([]);
  });

  it("still bills a government fee scheduled at filing, at filing", () => {
    const totals = quoteTotals([
      line({ kind: "government_fee", charge_at: "filing", unit_amount_cents: 35_000 }),
    ]);
    expect(totals.dueAtFiling).toBe(35_000);
    expect(totals.notCharged).toBe(0);
  });

  it("does not park a government fee in dueAtFiling on a schedule it cannot read", () => {
    // Money this build cannot place in time is not money it may present as
    // due — `kind` does not license a guess at WHEN. Reported, not repaired.
    const lines = [
      line({ kind: "government_fee", charge_at: "monthly", unit_amount_cents: 35_000 }),
    ];
    const totals = quoteTotals(lines);
    expect(totals.dueAtSigning).toBe(0);
    expect(totals.dueAtFiling).toBe(0);
    expect(totals.notCharged).toBe(35_000);
    expect(quoteBlockers(lines).map((b) => b.reason)).toContain("unknown_charge_schedule");
  });

  it("keeps a waived government fee out of the filing discount base", () => {
    // discountBaseCents shares bucketOf, so "10% off the filing fees" must not
    // be computed against a fee nobody is being charged.
    expect(
      discountBaseCents(
        [line({ kind: "government_fee", charge_at: "not_charged", unit_amount_cents: 35_000 })],
        "filing",
      ),
    ).toBe(0);
  });

  it("exports no bare `total` — the honest name is fullProjectCost", () => {
    // A `total` on a client-facing page reads as "what I am paying today".
    // Making the caller type `fullProjectCost` is the guard; this asserts the
    // guard has not been undone by a convenience export.
    expect(Object.keys(pricing)).not.toContain("total");
    expect(Object.keys(pricing)).not.toContain("quoteTotal");
    expect(Object.keys(pricing)).toContain("fullProjectCost");
  });
});

describe("selections", () => {
  it("always counts an included line, even if the row says selected: false", () => {
    // §4.2: included lines cannot be deselected, so the client was never
    // offered the choice and a stray false is not their answer.
    expect(isLineSelected(line({ selection: "included", selected: false }))).toBe(true);
    expect(quoteTotals([line({ selection: "included", selected: false, unit_amount_cents: 50_000 })])
      .dueAtSigning).toBe(50_000);
  });

  it("excludes an unticked optional add-on, and does not call it a blocker", () => {
    const lines = [
      line({ id: "base", unit_amount_cents: 100_000 }),
      line({ id: "addon", selection: "optional", selected: false, unit_amount_cents: 40_000 }),
    ];
    expect(quoteTotals(lines).dueAtSigning).toBe(100_000);
    // An add-on the client declined is an answer, not a missing one.
    expect(quoteReadiness(lines)).toEqual({ ready: true });
  });

  it("includes a ticked optional add-on", () => {
    expect(
      quoteTotals([
        line({ id: "base", unit_amount_cents: 100_000 }),
        line({ id: "addon", selection: "optional", selected: true, unit_amount_cents: 40_000 }),
      ]).dueAtSigning,
    ).toBe(140_000);
  });

  it("treats a missing selection as the column default, `included`", () => {
    expect(isLineSelected({ unit_amount_cents: 1 })).toBe(true);
  });

  it("requires an explicit tick for a selection value this build doesn't know", () => {
    // A future `selection = 'bundle_option'` must follow the stored boolean —
    // the database's record of what the client actually chose — rather than be
    // swept into the total as though it were included.
    expect(isLineSelected(line({ selection: "bundle_option", selected: false }))).toBe(false);
    expect(isLineSelected(line({ selection: "bundle_option", selected: true }))).toBe(true);
  });
});

describe("discounts", () => {
  it("subtracts a negative discount line by arithmetic", () => {
    const totals = quoteTotals([
      line({ id: "fee", unit_amount_cents: 277_500 }),
      line({ id: "disc", kind: "discount", charge_at: "signing", unit_amount_cents: -27_750 }),
    ]);
    expect(totals.dueAtSigning).toBe(249_750);
  });

  it("flags a discount stored positive instead of silently adding it", () => {
    const blockers = quoteBlockers([
      line({ kind: "discount", unit_amount_cents: 27_750 }),
    ]);
    expect(blockers.map((b) => b.reason)).toContain("amount_sign_mismatch");
  });

  it("flags a charge stored negative", () => {
    expect(
      quoteBlockers([line({ kind: "legal_fee", unit_amount_cents: -100 })]).map((b) => b.reason),
    ).toContain("amount_sign_mismatch");
  });

  it("reports a below-zero amount due honestly rather than flooring it", () => {
    // Flooring would make dueAtSigning stop equalling the lines, so the totals
    // panel and the line list would disagree with no indication why.
    const lines = [
      line({ id: "fee", unit_amount_cents: 100_00 }),
      line({ id: "disc", kind: "discount", unit_amount_cents: -150_00 }),
    ];
    expect(quoteTotals(lines).dueAtSigning).toBe(-50_00);
    expect(quoteReadiness(lines)).toMatchObject({
      ready: false,
      reason: "negative_amount_due",
    });
  });
});

describe("percentDiscountCents — the one rounding in the module", () => {
  it("rounds exactly once, with Math.round, at the point of application", () => {
    // 10% of $712.49 is 7124.9 cents. Math.round → 7125, stored negative.
    expect(percentDiscountCents(71_249, 10)).toBe(-7_125);
    // 33% of $123.45 is 4073.85 cents → 4074.
    expect(percentDiscountCents(12_345, 33)).toBe(-4_074);
    // Half-cent rounds up, the documented Math.round behaviour.
    expect(percentDiscountCents(1, 50)).toBe(-1);
    expect(percentDiscountCents(3, 50)).toBe(-2);
  });

  it("always yields an integer, so every downstream sum is exact", () => {
    for (const base of [1, 7, 999, 277_500, 1_234_567]) {
      for (const pct of [1, 7.5, 12.5, 33.33, 99]) {
        expect(Number.isInteger(percentDiscountCents(base, pct))).toBe(true);
      }
    }
  });

  it("refuses a percentage that is not a discount", () => {
    expect(percentDiscountCents(100_000, 0)).toBe(0);
    expect(percentDiscountCents(100_000, -10)).toBe(0);
    expect(percentDiscountCents(100_000, 101)).toBe(0);
    expect(percentDiscountCents(Number.NaN, 10)).toBe(0);
    expect(percentDiscountCents(100_000, Number.NaN)).toBe(0);
  });

  it("100% is a full waiver, not a rejection", () => {
    expect(percentDiscountCents(277_500, 100)).toBe(-277_500);
  });

  it("takes its base from selected non-discount lines in one bucket", () => {
    const lines = [
      line({ id: "fee", unit_amount_cents: 200_000 }),
      line({ id: "addon", selection: "optional", selected: false, unit_amount_cents: 50_000 }),
      line({ id: "uspto", kind: "government_fee", charge_at: "filing", unit_amount_cents: 35_000 }),
      line({ id: "disc", kind: "discount", unit_amount_cents: -10_000 }),
    ];
    // Signing base excludes the unticked add-on, the filing-side USPTO fee and
    // the discount itself — discounting a discount compounds silently.
    expect(discountBaseCents(lines, "signing")).toBe(200_000);
    expect(discountBaseCents(lines, "filing")).toBe(35_000);
  });
});

describe("tier groups and readiness", () => {
  const tier = (id: string, group: string, selected: boolean, cents: number): QuoteLineInput =>
    line({ id, selection: "tier_option", tier_group: group, selected, unit_amount_cents: cents });

  it("blocks with a reason a button can say, not a bare boolean", () => {
    const lines = [
      tier("std", "package", false, 200_000),
      tier("prem", "package", false, 350_000),
    ];
    expect(quoteReadiness(lines)).toMatchObject({
      ready: false,
      reason: "tier_group_unselected",
      message: "Choose a package.",
      tierGroup: "package",
    });
  });

  it("is ready when exactly one option is chosen in every group", () => {
    const lines = [
      tier("std", "package", true, 200_000),
      tier("prem", "package", false, 350_000),
      tier("search-basic", "search", true, 50_000),
      tier("search-full", "search", false, 90_000),
    ];
    expect(quoteReadiness(lines)).toEqual({ ready: true });
    expect(quoteTotals(lines).dueAtSigning).toBe(250_000);
  });

  it("blocks when two options in one group are ticked", () => {
    const lines = [tier("std", "package", true, 200_000), tier("prem", "package", true, 350_000)];
    expect(quoteReadiness(lines)).toMatchObject({
      ready: false,
      reason: "tier_group_multiple",
      tierGroup: "package",
    });
  });

  it("blocks on the group that is unanswered when another group is answered", () => {
    const lines = [
      tier("std", "package", true, 200_000),
      tier("search-basic", "search", false, 50_000),
      tier("search-full", "search", false, 90_000),
    ];
    expect(quoteReadiness(lines)).toMatchObject({
      ready: false,
      reason: "tier_group_unselected",
      tierGroup: "search",
    });
  });

  it("groups options by tier_group in first-appearance order", () => {
    const groups = tierGroups([
      tier("a", "search", false, 1),
      tier("b", "package", true, 2),
      tier("c", "search", true, 3),
    ]);
    expect(groups.map((g) => g.group)).toEqual(["search", "package"]);
    expect(groups[0].options.map((o) => o.id)).toEqual(["a", "c"]);
    expect(groups[0].selectedCount).toBe(1);
  });

  it("refuses to invent a group for a tier option that has none", () => {
    const lines = [line({ selection: "tier_option", tier_group: null, unit_amount_cents: 100 })];
    expect(tierGroups(lines)).toEqual([]);
    expect(quoteBlockers(lines).map((b) => b.reason)).toContain("tier_option_without_group");
  });

  it("blocks an empty quote", () => {
    expect(quoteReadiness([])).toMatchObject({ ready: false, reason: "no_lines" });
  });

  it("reports every blocker for the builder, integrity problems first", () => {
    const lines = [
      line({ id: "bad", kind: "government_fee", charge_at: "signing", unit_amount_cents: 35_000 }),
      tier("std", "package", false, 200_000),
    ];
    const reasons = quoteBlockers(lines).map((b) => b.reason);
    expect(reasons).toEqual(["government_fee_at_signing", "tier_group_unselected"]);
    // The client-facing surface shows only the first — telling a client to
    // choose a package on a quote whose totals are wrong gets a signature on a
    // number the firm does not stand behind.
    expect(quoteReadiness(lines)).toMatchObject({ reason: "government_fee_at_signing" });
  });
});

describe("tolerance — nothing here throws on a row from a future schema", () => {
  it("survives an empty object and unknown extra columns", () => {
    const rows = [{}, { some_column_added_in_0061: true }] as QuoteLineInput[];
    expect(() => quoteTotals(rows)).not.toThrow();
    expect(() => quoteBlockers(rows)).not.toThrow();
    expect(() => quoteReadiness(rows)).not.toThrow();
  });

  it("reads a bigint that arrived over the wire as a string", () => {
    // int8 is not JSON-safe; depending on driver config it can arrive quoted.
    // Number(undefined) is NaN, and NaN propagates silently through every sum.
    expect(lineAmountCents(line({ unit_amount_cents: "277500" }))).toBe(277_500);
    expect(lineAmountCents(line({ unit_amount_cents: "-27750", kind: "discount" }))).toBe(-27_750);
    expect(quoteTotals([line({ unit_amount_cents: "35000", quantity: "2" })]).dueAtSigning).toBe(
      70_000,
    );
  });

  it("never parses currency — a formatted string is unreadable, not $4,750", () => {
    for (const raw of ["$4,750.00", "4750.00", "4 750", "", "abc", null, undefined]) {
      expect(lineAmountCents(line({ unit_amount_cents: raw as string }))).toBe(0);
    }
    expect(
      quoteBlockers([line({ unit_amount_cents: "$4,750.00" })]).map((b) => b.reason),
    ).toContain("unreadable_amount");
  });

  it("contributes zero — never NaN, never a guess — for an unreadable amount", () => {
    const totals = quoteTotals([
      line({ id: "ok", unit_amount_cents: 100_000 }),
      line({ id: "bad", unit_amount_cents: Number.NaN }),
    ]);
    expect(totals.dueAtSigning).toBe(100_000);
    expect(Number.isNaN(totals.dueAtSigning)).toBe(false);
  });

  it("falls back to the column default for an impossible quantity", () => {
    // `integer not null default 1 check (> 0)` — anything else is data that
    // should not exist, and 0 would silently delete the line from the total.
    for (const q of [0, -3, 1.5, Number.NaN, null, undefined, "x"]) {
      expect(lineAmountCents(line({ quantity: q as number, unit_amount_cents: 500 }))).toBe(500);
    }
  });

  it("parks money on an unrecognised schedule out of both amounts due, and blocks", () => {
    // If 0065 adds charge_at = 'monthly', this build cannot know when that
    // money is owed. Presenting it as due today is exactly the §0 failure.
    const lines = [
      line({ id: "fee", unit_amount_cents: 100_000 }),
      line({ id: "sub", charge_at: "monthly", unit_amount_cents: 9_900 }),
    ];
    const totals = quoteTotals(lines);
    expect(totals.dueAtSigning).toBe(100_000);
    expect(totals.dueAtFiling).toBe(0);
    expect(totals.notCharged).toBe(9_900);
    expect(quoteBlockers(lines).map((b) => b.reason)).toContain("unknown_charge_schedule");
  });

  it("does not treat an unknown kind as special", () => {
    const totals = quoteTotals([
      line({ kind: "court_fee_added_later", charge_at: "filing", unit_amount_cents: 12_300 }),
    ]);
    expect(totals.dueAtFiling).toBe(12_300);
  });
});
