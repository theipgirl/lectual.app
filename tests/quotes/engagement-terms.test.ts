import { describe, expect, it } from "vitest";

import {
  GOV_FILING_FEE_PER_CLASS_CENTS,
  buildEngagementTerms,
} from "@/lib/quotes/engagement-terms";
import type { QuoteLineInput } from "@/lib/quotes/pricing";

/**
 * The engagement letter is generated, so these tests are about the two
 * properties that make generating it safe at all:
 *
 *  1. Every dollar figure comes from a line a human typed. Nothing is invented,
 *     nothing is defaulted, and a gap shows as a `[bracketed]` instruction to
 *     staff rather than as a plausible number — `documents/loe.ts`'s hard rule,
 *     carried over.
 *  2. The two timed figures stay two. The USPTO fees are charged at filing, and
 *     no wording here may put them at signing or roll them into one "total".
 *
 * There is no AI in this path and there must never be. A model that writes a
 * fee term into a document a client then signs has drafted a contract clause,
 * and the signature makes it real.
 */

function line(overrides: Partial<QuoteLineInput> = {}): QuoteLineInput {
  return {
    id: "line-1",
    kind: "legal_fee",
    charge_at: "signing",
    selection: "included",
    selected: true,
    label: "Trademark application — Standard",
    quantity: 1,
    unit_amount_cents: 150_000,
    ...overrides,
  };
}

const BASE = {
  firmName: "Beliard IP",
  clientName: "Dana Reyes",
};

describe("the figures come from the lines, and only from the lines", () => {
  it("states the two timed amounts the totals panel states", () => {
    const terms = buildEngagementTerms({
      ...BASE,
      lines: [
        line(),
        line({ id: "gov", kind: "government_fee", charge_at: "filing", label: "USPTO filing fee", quantity: 2, unit_amount_cents: 35_000 }),
      ],
    });

    expect(terms).toContain("Due at signing: $1,500.00");
    expect(terms).toContain("Due later, at filing: $700.00");
    expect(terms).toContain("Full project cost: $2,200.00");
  });

  it("shows the government-fee arithmetic instead of asserting a total", () => {
    // "$350 × class count, with the math visible" is how the firm's own fee
    // chart states it (documents/loe.ts) — so a client can check the number
    // rather than take it on trust.
    const terms = buildEngagementTerms({
      ...BASE,
      lines: [
        line(),
        line({ id: "gov", kind: "government_fee", charge_at: "filing", label: "USPTO filing fee", quantity: 3, unit_amount_cents: GOV_FILING_FEE_PER_CLASS_CENTS }),
      ],
    });
    expect(terms).toContain("$350.00 × 3 classes = $1,050.00");
  });

  it("says 'class', singular, for a one-class filing", () => {
    const terms = buildEngagementTerms({
      ...BASE,
      lines: [line({ id: "gov", kind: "government_fee", charge_at: "filing", label: "USPTO filing fee", quantity: 1, unit_amount_cents: 35_000 })],
    });
    expect(terms).toContain("$350.00 × 1 class = $350.00");
  });

  it("prints a staff-entered per-class fee VERBATIM rather than correcting it to $350", () => {
    // The constant exists to explain arithmetic, never to override a number a
    // human typed. A generator that "corrected" a staff figure to its own
    // constant would be inventing the fee the client is quoted — the exact
    // failure the SOP's hard rule is written against.
    const terms = buildEngagementTerms({
      ...BASE,
      lines: [line({ id: "gov", kind: "government_fee", charge_at: "filing", label: "USPTO filing fee", quantity: 2, unit_amount_cents: 42_500 })],
    });
    expect(terms).toContain("$425.00 × 2 classes = $850.00");
    expect(terms).not.toContain("$350.00");
  });

  it("tolerates an int8 that arrived as a quoted numeral", () => {
    // PostgREST hands bigint back as a number or a string depending on
    // configuration. A terms document that read "$NaN" — or worse, a wrong
    // figure that looked fine — would be generated from the same rows the page
    // priced correctly.
    const terms = buildEngagementTerms({
      ...BASE,
      lines: [line({ quantity: "2", unit_amount_cents: "150000" })],
    });
    expect(terms).toContain("Due at signing: $3,000.00");
  });

  it("states an absorbed government fee as absorbed, never drops it", () => {
    // "We are not charging you $350" is a term of the agreement. A client who
    // never sees it cannot hold the firm to it.
    const terms = buildEngagementTerms({
      ...BASE,
      lines: [
        line(),
        line({ id: "gov", kind: "government_fee", charge_at: "not_charged", label: "USPTO filing fee", quantity: 1, unit_amount_cents: 35_000 }),
      ],
    });
    expect(terms).toContain("absorbed by the firm");
    expect(terms).toContain("Due later, at filing: $0.00");
  });

  it("leaves a visible instruction where a figure is missing, never a plausible number", () => {
    // An amount is due at filing but nothing explains it. The generator says so
    // in brackets so staff must close the gap; it does not invent a class count.
    const terms = buildEngagementTerms({
      ...BASE,
      lines: [line({ id: "x", kind: "expense", charge_at: "filing", label: "Search vendor", unit_amount_cents: 20_000 })],
    });
    expect(terms).toContain("[an amount is due at filing but no government-fee line explains it");
  });

  it("ignores lines the client did not choose", () => {
    const terms = buildEngagementTerms({
      ...BASE,
      lines: [
        line(),
        line({ id: "addon", selection: "optional", selected: false, label: "Monitoring", unit_amount_cents: 60_000 }),
      ],
    });
    expect(terms).toContain("Due at signing: $1,500.00");
    expect(terms).not.toContain("Monitoring");
  });
});

describe("the two-figure discipline survives being put into prose", () => {
  it("never calls the sum a total", () => {
    const terms = buildEngagementTerms({
      ...BASE,
      lines: [line(), line({ id: "gov", kind: "government_fee", charge_at: "filing", quantity: 1, unit_amount_cents: 35_000 })],
    });
    expect(terms.toLowerCase()).not.toContain("total");
    expect(terms).toContain("it is not an amount due at signing");
  });

  it("says in words that the USPTO fees are charged at filing, not at signing", () => {
    const terms = buildEngagementTerms({ ...BASE, lines: [line()] });
    expect(terms).toContain("charged when your application is filed — not at signing and not before");
  });

  it("says no card is charged on the page where the name is typed", () => {
    const terms = buildEngagementTerms({ ...BASE, lines: [line()] });
    expect(terms).toContain("Nothing on this page charges a card");
  });
});

describe("the parties clause", () => {
  it("names the signing entity when there is one, and the person when there is not", () => {
    const withEntity = buildEngagementTerms({ ...BASE, entityName: "Acme Holdings LLC", lines: [line()] });
    expect(withEntity).toContain("Acme Holdings LLC");

    const withoutEntity = buildEngagementTerms({ ...BASE, lines: [line()] });
    expect(withoutEntity).toContain("Dana Reyes");
  });

  it("omits the mark entirely rather than printing an empty scope line", () => {
    const noMark = buildEngagementTerms({ ...BASE, lines: [line()] });
    expect(noMark).toContain("The Firm will perform the services itemised above");
    expect(noMark).not.toContain("in connection with the mark");

    const withMark = buildEngagementTerms({ ...BASE, markText: "ACME", lines: [line()] });
    expect(withMark).toContain("in connection with the mark ACME");
  });
});

describe("the signature deadline is the quote's own expiry, not a recomputed one", () => {
  it("states the expiry the accept path actually enforces", () => {
    // `loe.ts` computes send date + 14 days for its paper template. Repeating
    // that here would put a date in the agreement that nothing enforces, next
    // to a link that dies on a different day.
    const terms = buildEngagementTerms({
      ...BASE,
      lines: [line()],
      expiresAt: "2026-09-30T23:59:00.000Z",
    });
    expect(terms).toContain("open for signature until");
    expect(terms).toContain("September 30, 2026");
  });

  it("says nothing about a deadline when the quote has no expiry", () => {
    const terms = buildEngagementTerms({ ...BASE, lines: [line()] });
    expect(terms).not.toContain("open for signature until");
  });
});

describe("flat fees only", () => {
  it("states the fees as flat, and never as a percentage of anything", () => {
    // The UPL/fee-sharing firewall, stated in the document the client signs:
    // flat fees only, government fees passed through at cost.
    const terms = buildEngagementTerms({ ...BASE, lines: [line()] });
    expect(terms).toContain("flat fees");
    expect(terms).toContain("not a percentage of anything");
  });
});

describe("a quote with packages and add-ons", () => {
  const pkg = (id: string, name: string, cents: number, over: Partial<QuoteLineInput> = {}) =>
    line({ id, selection: "tier_option", tier_group: name, label: id, unit_amount_cents: cents, ...over });

  const lines = [
    pkg("Clearance search", "Full prosecution", 145_000),
    pkg("Office action allowance", "Full prosecution", 95_000),
    pkg("USPTO fee, class 25", "Full prosecution", 35_000, { kind: "government_fee", charge_at: "filing" }),
    pkg("Knockout search", "Filing only", 95_000),
    pkg("Budget search", "Budget", 40_000, { selected: false }),
    line({ id: "watch", selection: "optional", selected: true, label: "Watch service, 12 months", unit_amount_cents: 60_000 }),
    line({ id: "drawing", selection: "optional", selected: false, label: "Design mark drawing", unit_amount_cents: 25_000 }),
  ];

  it("states each offered package with its own two figures, itemised", () => {
    const terms = buildEngagementTerms({ ...BASE, lines });
    expect(terms).toContain("You choose one package on this page.");
    expect(terms).toContain("FULL PROSECUTION\nDue at signing: $2,400.00");
    expect(terms).toContain("Due later, at filing: $350.00");
    expect(terms).toContain("- USPTO fee, class 25: $350.00 × 1 class = $350.00, charged when the application is filed.");
    expect(terms).toContain("FILING ONLY\nDue at signing: $950.00");
    expect(terms).toContain("Full project cost for this package: $2,750.00.");
  });

  it("lists the add-ons as charged only if chosen, and leaves out what the firm withheld", () => {
    const terms = buildEngagementTerms({ ...BASE, lines });
    expect(terms).toContain("- Watch service, 12 months: $600.00, at signing");
    expect(terms).not.toContain("Design mark drawing");
    expect(terms).not.toContain("BUDGET");
    expect(terms).not.toContain("Budget search");
  });

  it("still never calls a sum a total", () => {
    expect(buildEngagementTerms({ ...BASE, lines }).toLowerCase()).not.toContain("total");
  });
});

