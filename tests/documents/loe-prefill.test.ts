import { describe, expect, it } from "vitest";

import {
  LOE_QUOTE_NONE,
  LOE_QUOTE_PICK,
  buildLoePrefill,
  chooseLoeQuote,
  formatSignedOn,
  loeDifferences,
  type LoeMatterFacts,
} from "@/lib/documents/loe-prefill";
import { buildAcceptedSnapshot, type PublicQuoteLine, type QuoteAcceptedSnapshot } from "@/lib/quotes/public";
import { buildEngagementTerms } from "@/lib/quotes/engagement-terms";
import { quoteReference } from "@/lib/quotes/labels";

/**
 * Pre-filling the engagement letter from a SIGNED quote (loe-prefill.ts).
 *
 * The properties pinned here are the ones that keep a pre-filled letter honest:
 *  - every figure is the snapshot's own frozen one (never re-priced);
 *  - what the quote cannot answer (class numbers, goods) comes from the matter
 *    and is flagged when absent, never invented;
 *  - the template variant is not in the result at all;
 *  - a submitted figure that departs from the signed one is reported.
 *
 * Snapshots are built with the accept path's own writer (`buildAcceptedSnapshot`)
 * so the fixtures cannot drift from the record they stand in for.
 */

const QUOTE_ID = "3f9a1c00-0000-4000-8000-000000000001";
const ACCEPTED_AT = "2026-09-28T02:30:00.000Z"; // 10:30 PM on Sep 27 in New York
const SIGNER_EMAIL = "nadia.petra@example.com";

function pl(o: Partial<PublicQuoteLine> & { id: string; label: string }): PublicQuoteLine {
  return {
    kind: "legal_fee",
    charge_at: "signing",
    selection: "included",
    tier_group: null,
    selected: true,
    description: null,
    quantity: 1,
    unit_amount_cents: 0,
    sort_index: 0,
    ...o,
  };
}

/** Three packages (the client took Enhanced), a watch add-on taken, a drawing add-on declined,
 * and a friends-and-family discount. Two classes. */
function enhancedLines(): PublicQuoteLine[] {
  return [
    pl({ id: "ess", label: "Essential package (1 class)", selection: "tier_option", tier_group: "Essential", selected: false, unit_amount_cents: 195_000 }),
    pl({ id: "ess-gov", kind: "government_fee", charge_at: "filing", label: "USPTO filing fee", selection: "tier_option", tier_group: "Essential", selected: false, unit_amount_cents: 35_000 }),
    pl({ id: "enh", label: "Enhanced package (2 classes)", selection: "tier_option", tier_group: "Enhanced", selected: true, unit_amount_cents: 325_000 }),
    pl({ id: "enh-gov", kind: "government_fee", charge_at: "filing", label: "USPTO filing fees", selection: "tier_option", tier_group: "Enhanced", selected: true, quantity: 2, unit_amount_cents: 35_000 }),
    pl({ id: "con", label: "Concierge package (3 classes)", selection: "tier_option", tier_group: "Concierge", selected: false, unit_amount_cents: 495_000 }),
    pl({ id: "watch", label: "Watch service, year one", selection: "optional", selected: true, unit_amount_cents: 50_000 }),
    pl({ id: "draw", label: "Design mark drawing", selection: "optional", selected: false, unit_amount_cents: 25_000 }),
    pl({ id: "ff", kind: "discount", label: "Friends & family", unit_amount_cents: -25_000 }),
  ];
}

const VIEW = { title: "Trademark filing for HALCYON ROWE", introBody: null, expiresAt: null, currency: "USD" };

function termsFor(lines: PublicQuoteLine[], markText: string | null = "HALCYON ROWE"): string {
  return buildEngagementTerms({ firmName: "Beliard IP", clientName: "Nadia Petra", markText, lines });
}

function snapshotOf(lines: PublicQuoteLine[], termsBody: string | null = termsFor(lines)): QuoteAcceptedSnapshot {
  return buildAcceptedSnapshot({
    view: { ...VIEW, termsBody },
    lines,
    acceptedAt: ACCEPTED_AT,
    name: "Nadia Petra",
    email: SIGNER_EMAIL,
  });
}

const MATTER: LoeMatterFacts = {
  mark_text: "HALCYON ROWE",
  international_classes: [25, 35],
  goods_services: "Clothing, namely t-shirts and hats; retail store services",
  package_name: "Enhanced",
};

function build(snapshot: QuoteAcceptedSnapshot, matter: LoeMatterFacts = MATTER, timeZone = "America/New_York") {
  return buildLoePrefill({ quoteId: QUOTE_ID, snapshot, matter, acceptedAt: ACCEPTED_AT, timeZone });
}

describe("buildLoePrefill — from the frozen snapshot", () => {
  it("carries the package, class count, amount, math, rows and government fees across", () => {
    const p = build(snapshotOf(enhancedLines()));

    expect(p.packageName).toBe("Enhanced");
    expect(p.classCount).toBe("2");
    // 3,250 + 500 (watch) − 250 (friends & family) = 3,500; the discount is explained, not hidden.
    expect(p.amountPaid).toBe("$3,500");
    expect(p.amountPaidMath).toBe("$3,750 − $250 = $3,500");
    expect(p.govFeesText).toBe("$700 (350 × 2 classes)");
    expect(p.benefitRowsText.split("\n")).toEqual([
      "Enhanced package (2 classes) — $3,250",
      "Watch service, year one (add-on) — $500",
    ]);
    expect(p.totals).toEqual({ dueAtSigning: "$3,500", dueAtFiling: "$700", fullProjectCost: "$4,200" });
    expect(p.checks).toEqual([]);
  });

  it("leaves out the packages and add-ons the client did not take", () => {
    const p = build(snapshotOf(enhancedLines()));
    const everything = JSON.stringify(p);
    expect(everything).not.toContain("Essential package");
    expect(everything).not.toContain("Concierge package");
    expect(everything).not.toContain("Design mark drawing");
  });

  it("names the quote as the quote page does, in capitals, with the signing date in the firm's zone", () => {
    const p = build(snapshotOf(enhancedLines()));
    expect(p.reference).toBe(quoteReference(QUOTE_ID).toUpperCase());
    expect(p.reference).toMatch(/^QT-[0-9A-F]{6}$/);
    // 02:30 UTC on the 28th is still the evening of the 27th in New York.
    expect(p.acceptedOn).toBe("Sep 27, 2026");
    expect(build(snapshotOf(enhancedLines()), MATTER, "UTC").acceptedOn).toBe("Sep 28, 2026");
    expect(p.signerName).toBe("Nadia Petra");
  });

  it("does not carry the signer's email address anywhere", () => {
    expect(JSON.stringify(build(snapshotOf(enhancedLines())))).not.toContain(SIGNER_EMAIL);
  });

  it("has no template field: current vs legacy is never decided here", () => {
    const p = build(snapshotOf(enhancedLines())) as Record<string, unknown>;
    expect("variant" in p).toBe(false);
    expect(Object.keys(p).some((k) => /variant|template/i.test(k))).toBe(false);
  });

  it("uses the frozen line amount and the frozen total, never quantity × unit over the lines", () => {
    // The record says this line came to $1,500 although 1 × $1,950 would be $1,950 — a later
    // pricing change, or a repriced live line, must not reach the letter.
    const snapshot = snapshotOf([pl({ id: "ess", label: "Essential package", unit_amount_cents: 195_000 })]);
    snapshot.lines[0].amount_cents = 150_000;
    snapshot.totals.due_at_signing = 150_000;
    snapshot.totals.full_project_cost = 150_000;
    const p = build(snapshot);
    expect(p.amountPaid).toBe("$1,500");
    expect(p.benefitRowsText).toBe("Essential package — $1,500");
    // The frozen line and the frozen total agree with each other, so there is nothing to flag about the money.
    expect(p.checks.some((c) => c.includes("does not equal"))).toBe(false);
  });

  it("still uses the signed total when it disagrees with its own lines, and says so", () => {
    const snapshot = snapshotOf([pl({ id: "ess", label: "Essential package", unit_amount_cents: 195_000 })]);
    snapshot.totals.due_at_signing = 190_000;
    const p = build(snapshot);
    expect(p.amountPaid).toBe("$1,900");
    expect(p.checks.some((c) => c.includes("does not equal its signing lines"))).toBe(true);
  });
});

describe("buildLoePrefill — the mark", () => {
  it("reads the mark from the signed terms and says that is where it came from", () => {
    const p = build(snapshotOf(enhancedLines()), { ...MATTER, mark_text: null });
    expect(p.markText).toBe("HALCYON ROWE");
    expect(p.markFrom).toBe("signed terms");
  });

  it("falls back to the matter's mark when the terms name none", () => {
    const lines = enhancedLines();
    const p = build(snapshotOf(lines, termsFor(lines, null)), { ...MATTER, mark_text: "HALCYON" });
    expect(p.markText).toBe("HALCYON");
    expect(p.markFrom).toBe("matter");
    expect(p.checks).toEqual([]);
  });

  it("flags a mark that differs between the signed terms and the matter, and prefers the signed one", () => {
    const p = build(snapshotOf(enhancedLines()), { ...MATTER, mark_text: "HALCYON ROW" });
    expect(p.markText).toBe("HALCYON ROWE");
    expect(p.checks.some((c) => c.includes("HALCYON ROWE") && c.includes("HALCYON ROW"))).toBe(true);
  });

  it("does not flag a case-only difference", () => {
    const p = build(snapshotOf(enhancedLines()), { ...MATTER, mark_text: "Halcyon Rowe" });
    expect(p.checks).toEqual([]);
  });

  it("leaves the mark empty and flagged when nothing names one", () => {
    const lines = enhancedLines();
    const p = build(snapshotOf(lines, termsFor(lines, null)), { ...MATTER, mark_text: null });
    expect(p.markText).toBe("");
    expect(p.markFrom).toBeNull();
    expect(p.checks.some((c) => c.includes("name a mark"))).toBe(true);
  });
});

describe("buildLoePrefill — classes and goods come from the matter's file", () => {
  it("joins the class numbers and goods the way staff read them on the matter", () => {
    const p = build(snapshotOf(enhancedLines()));
    expect(p.classSelected).toBe("Classes 25, 35 — Clothing, namely t-shirts and hats; retail store services");
    expect(build(snapshotOf(enhancedLines()), { ...MATTER, international_classes: [25] }).classSelected).toMatch(/^Class 25 — /);
  });

  it("leaves them empty and flagged when the matter has neither, rather than inventing any", () => {
    const p = build(snapshotOf(enhancedLines()), { ...MATTER, international_classes: null, goods_services: null });
    expect(p.classSelected).toBe("");
    expect(p.checks.some((c) => c.includes("no class numbers or goods/services"))).toBe(true);
  });

  it("flags goods without class numbers, and class numbers without goods", () => {
    expect(build(snapshotOf(enhancedLines()), { ...MATTER, international_classes: null }).checks.join(" ")).toMatch(/no class numbers on file/);
    expect(build(snapshotOf(enhancedLines()), { ...MATTER, goods_services: null }).checks.join(" ")).toMatch(/no goods\/services on file/);
  });

  it("takes the class COUNT from the signed USPTO lines and flags a matter that lists a different number", () => {
    const p = build(snapshotOf(enhancedLines()), { ...MATTER, international_classes: [25, 35, 41] });
    expect(p.classCount).toBe("2");
    expect(p.checks.some((c) => c.includes("2 classes") && c.includes("lists 3") && c.includes("25, 35, 41"))).toBe(true);
  });
});

describe("buildLoePrefill — government fees", () => {
  it("states the signed per-class math, whatever the unit", () => {
    const lines = [pl({ id: "p", label: "Package", unit_amount_cents: 100_000 }), pl({ id: "g", kind: "government_fee", charge_at: "filing", label: "USPTO", quantity: 3, unit_amount_cents: 40_000 })];
    const p = build(snapshotOf(lines));
    expect(p.govFeesText).toBe("$1,200 (400 × 3 classes)");
    expect(p.classCount).toBe("3");
  });

  it("adds up one government-fee line per class", () => {
    const lines = [
      pl({ id: "p", label: "Package", unit_amount_cents: 100_000 }),
      pl({ id: "g1", kind: "government_fee", charge_at: "filing", label: "USPTO fee, class 25", unit_amount_cents: 35_000 }),
      pl({ id: "g2", kind: "government_fee", charge_at: "filing", label: "USPTO fee, class 35", unit_amount_cents: 35_000 }),
    ];
    const p = build(snapshotOf(lines));
    expect(p.govFeesText).toBe("$700 (350 × 2 classes)");
    expect(p.classCount).toBe("2");
  });

  it("shows two different unit amounts separately", () => {
    const lines = [
      pl({ id: "g1", kind: "government_fee", charge_at: "filing", label: "USPTO fee", unit_amount_cents: 35_000 }),
      pl({ id: "g2", kind: "government_fee", charge_at: "filing", label: "USPTO fee, rush", unit_amount_cents: 45_000 }),
    ];
    expect(build(snapshotOf(lines)).govFeesText).toBe("$800 (350 × 1 class + 450 × 1 class)");
  });

  it("states a fee the firm absorbed as absorbed, not as an amount due", () => {
    const lines = [pl({ id: "p", label: "Package", unit_amount_cents: 100_000 }), pl({ id: "g", kind: "government_fee", charge_at: "not_charged", label: "USPTO", quantity: 2, unit_amount_cents: 35_000 })];
    const p = build(snapshotOf(lines));
    expect(p.govFeesText).toBe("$0 — $700 (350 × 2 classes) absorbed by the firm, not charged");
    expect(p.classCount).toBe("2");
    expect(p.totals.dueAtFiling).toBe("$0");
  });

  it("with no government-fee line, takes the count from the matter and leaves a visible gap for the fee", () => {
    const p = build(snapshotOf([pl({ id: "p", label: "Package", unit_amount_cents: 100_000 })]));
    expect(p.classCount).toBe("2");
    expect(p.govFeesText).toMatch(/^\[none on the signed quote/);
    expect(p.checks.some((c) => c.includes("no USPTO fee line") && c.includes("(2)"))).toBe(true);

    const bare = build(snapshotOf([pl({ id: "p", label: "Package", unit_amount_cents: 100_000 })]), { ...MATTER, international_classes: null });
    expect(bare.classCount).toBe("");
  });
});

describe("buildLoePrefill — package, rows and discounts", () => {
  it("falls back to the matter's package for a quote with none, and flags it", () => {
    const p = build(snapshotOf([pl({ id: "p", label: "Flat fee filing", unit_amount_cents: 100_000 })]));
    expect(p.packageName).toBe("Enhanced");
    expect(p.checks.some((c) => c.includes("no package"))).toBe(true);
    const none = build(snapshotOf([pl({ id: "p", label: "Flat fee filing", unit_amount_cents: 100_000 })]), { ...MATTER, package_name: null });
    expect(none.packageName).toBe("");
  });

  it("times each row, and does not drop a line it does not recognise", () => {
    const lines = [
      pl({ id: "a", label: "Search", unit_amount_cents: 67_500 }),
      pl({ id: "b", label: "Office action response", charge_at: "filing", unit_amount_cents: 80_000 }),
      pl({ id: "c", label: "Comprehensive IP audit", charge_at: "not_charged", unit_amount_cents: 0 }),
      pl({ id: "d", label: "Hours", quantity: 3, unit_amount_cents: 10_000 }),
      pl({ id: "e", kind: "expense", label: "Courier", unit_amount_cents: 2_500 }),
    ];
    const rows = build(snapshotOf(lines)).benefitRowsText.split("\n");
    expect(rows).toEqual([
      "Search — $675",
      "Hours — $100 × 3 = $300",
      "Courier — $25",
      "Office action response — $800 (due at filing)",
      "Comprehensive IP audit — included",
    ]);
  });

  it("explains several discounts in the math", () => {
    const lines = [
      pl({ id: "p", label: "Package", unit_amount_cents: 277_500 }),
      pl({ id: "d1", kind: "discount", label: "Friends & family", unit_amount_cents: -25_000 }),
      pl({ id: "d2", kind: "discount", label: "Referral", unit_amount_cents: -10_000 }),
    ];
    const p = build(snapshotOf(lines));
    expect(p.amountPaid).toBe("$2,425");
    expect(p.amountPaidMath).toBe("$2,775 − $250 − $100 = $2,425");
    expect(p.benefitRowsText).toBe("Package — $2,775");
  });

  it("lists discounts as rows, and flags it, when their math does not reconcile with the signed total", () => {
    const snapshot = snapshotOf([
      pl({ id: "p", label: "Package", unit_amount_cents: 277_500 }),
      pl({ id: "d1", kind: "discount", label: "Friends & family", unit_amount_cents: -25_000 }),
    ]);
    snapshot.totals.due_at_signing = 260_000;
    const p = build(snapshot);
    expect(p.amountPaid).toBe("$2,600");
    expect(p.amountPaidMath).toBe("");
    expect(p.benefitRowsText).toContain("Friends & family — -$250");
    expect(p.checks.some((c) => c.includes("math does not add up"))).toBe(true);
  });

  it("shows whole dollars without cents and keeps real cents", () => {
    const p = build(snapshotOf([pl({ id: "p", label: "Package", unit_amount_cents: 195_050 })]));
    expect(p.amountPaid).toBe("$1,950.50");
  });
});

describe("buildLoePrefill — the general letter's fields", () => {
  it("carries the quoted amount, a flat-fee statement and the service labels", () => {
    const p = build(snapshotOf(enhancedLines()));
    expect(p.quotedAmount).toBe("3500.00");
    expect(p.feeStructure).toBe(
      "Flat fee: $3,500 due at signing; USPTO government filing fees of $700, due at filing (not part of the firm's fee)",
    );
    expect(p.scopeDescription).toBe("Enhanced package (2 classes)\nWatch service, year one");
  });

  it("never calls the USPTO fee part of the firm's flat fee, and keeps the firm's own filing fee apart from it", () => {
    const p = build(
      snapshotOf([
        pl({ id: "p", label: "Package", unit_amount_cents: 200_000 }),
        pl({ id: "f", label: "Filing preparation", charge_at: "filing", unit_amount_cents: 50_000 }),
        pl({ id: "g", kind: "government_fee", charge_at: "filing", label: "USPTO fee", quantity: 2, unit_amount_cents: 35_000 }),
      ]),
    );
    expect(p.feeStructure).toBe(
      "Flat fee: $2,000 due at signing; $500 more of the firm's fee due at filing; USPTO government filing fees of $700, due at filing (not part of the firm's fee)",
    );
    // The deposit base is the firm's quoted fee, never the government fee.
    expect(p.quotedAmount).toBe("2500.00");
    expect(p.checks.some((c) => c.includes("due at filing"))).toBe(false);
  });

  it("flags a frozen filing total that does not match its own lines", () => {
    const snapshot = snapshotOf(enhancedLines());
    snapshot.totals.due_at_filing = 99_900;
    const p = build(snapshot);
    expect(p.checks.some((c) => c.includes("amount due at filing ($999)"))).toBe(true);
  });

  it("flags totals that are not whole cents instead of silently printing $0", () => {
    const snapshot = snapshotOf(enhancedLines());
    snapshot.totals.due_at_signing = 350_000.5;
    const p = build(snapshot);
    expect(p.checks.some((c) => c.includes("not whole amounts in cents"))).toBe(true);
  });

  it("leaves the quoted amount empty when nothing was due at signing", () => {
    const p = build(snapshotOf([pl({ id: "p", label: "Included", charge_at: "not_charged", unit_amount_cents: 0 })]));
    expect(p.quotedAmount).toBe("");
    expect(p.feeStructure).toBe("Flat fee: $0 due at signing");
  });
});

describe("formatSignedOn", () => {
  it("is empty for anything that is not an instant", () => {
    expect(formatSignedOn(null)).toBe("");
    expect(formatSignedOn("not a date")).toBe("");
    expect(formatSignedOn("2026-09-28T02:30:00.000Z", "Not/AZone")).toBe("");
  });
});

describe("chooseLoeQuote — which signed quote the page uses", () => {
  const ok = (quoteId: string) => ({ quoteId, readable: true });

  it("is the blank form when the matter has no signed quote", () => {
    expect(chooseLoeQuote([], undefined)).toEqual({ mode: "none", quoteId: null, invalidParam: false });
    expect(chooseLoeQuote([], "q1")).toEqual({ mode: "none", quoteId: null, invalidParam: false });
  });

  it("uses the only signed quote without being asked", () => {
    expect(chooseLoeQuote([ok("q1")], undefined)).toEqual({ mode: "prefill", quoteId: "q1", invalidParam: false });
  });

  it("makes staff choose when there are several, and never guesses", () => {
    expect(chooseLoeQuote([ok("q1"), ok("q2")], undefined)).toEqual({ mode: "pick", quoteId: null, invalidParam: false });
    expect(chooseLoeQuote([ok("q1"), ok("q2")], LOE_QUOTE_PICK)).toEqual({ mode: "pick", quoteId: null, invalidParam: false });
  });

  it("uses the quote staff chose", () => {
    expect(chooseLoeQuote([ok("q1"), ok("q2")], "q2")).toEqual({ mode: "prefill", quoteId: "q2", invalidParam: false });
  });

  it("lets staff fill it in by hand even when a signed quote exists", () => {
    expect(chooseLoeQuote([ok("q1")], LOE_QUOTE_NONE).mode).toBe("manual");
    expect(chooseLoeQuote([ok("q1"), ok("q2")], LOE_QUOTE_NONE).mode).toBe("manual");
  });

  it("ignores a quote id that is not a signed quote on this matter, and says so", () => {
    expect(chooseLoeQuote([ok("q1")], "someone-elses")).toEqual({ mode: "prefill", quoteId: "q1", invalidParam: true });
    expect(chooseLoeQuote([ok("q1"), ok("q2")], "someone-elses")).toEqual({ mode: "pick", quoteId: null, invalidParam: true });
  });

  it("never pre-fills from a signed quote with no readable signed copy", () => {
    expect(chooseLoeQuote([{ quoteId: "q1", readable: false }], undefined)).toEqual({ mode: "unreadable", quoteId: "q1", invalidParam: false });
    expect(chooseLoeQuote([{ quoteId: "q1", readable: false }, ok("q2")], "q1").mode).toBe("unreadable");
  });
});

describe("loeDifferences — a figure that departs from what the client signed is never silent", () => {
  const prefill = build(snapshotOf(enhancedLines()));
  const same = {
    packageName: "Enhanced",
    markText: "HALCYON ROWE",
    classCount: 2,
    amountPaid: "$3,500",
    govFeesText: "$700 (350 × 2 classes)",
  };

  it("reports nothing when the letter matches the signed quote", () => {
    expect(loeDifferences(prefill, same)).toEqual([]);
  });

  it("does not mind formatting: $3,500.00, case and spacing", () => {
    expect(loeDifferences(prefill, { ...same, amountPaid: "$3,500.00", packageName: "  ENHANCED ", markText: "halcyon  rowe" })).toEqual([]);
  });

  it("reports an edited amount, naming both figures and the quote", () => {
    const out = loeDifferences(prefill, { ...same, amountPaid: "$3,000" });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("$3,000");
    expect(out[0]).toContain("$3,500");
    expect(out[0]).toContain(prefill.reference);
  });

  it("reports an edited package, mark, class count and government fees", () => {
    const out = loeDifferences(prefill, { packageName: "Concierge", markText: "HALCYON", classCount: 3, amountPaid: "$3,500", govFeesText: "$1,050 (350 × 3 classes)" });
    expect(out).toHaveLength(4);
    expect(out.join("\n")).toMatch(/Package.*Concierge/);
    expect(out.join("\n")).toMatch(/Mark.*"HALCYON"/);
    expect(out.join("\n")).toMatch(/Class count.*3/);
    expect(out.join("\n")).toMatch(/Government fees.*1,050/);
  });

  it("reports government fees that were cleared, because the letter then computes its own", () => {
    const out = loeDifferences(prefill, { ...same, govFeesText: "" });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatch(/left blank/);
  });

  it("compares only what was submitted", () => {
    expect(loeDifferences(prefill, {})).toEqual([]);
    expect(loeDifferences(prefill, { quotedAmount: 3500 })).toEqual([]);
    expect(loeDifferences(prefill, { quotedAmount: 3000 })[0]).toMatch(/Quoted amount.*\$3000\.00.*\$3500\.00/);
    expect(loeDifferences(prefill, { quotedAmount: null })[0]).toMatch(/nothing/);
  });

  it("reports an edited, added or removed chart row, so a changed price in a row is never silent", () => {
    const rows = prefill.benefitRowsText;
    expect(loeDifferences(prefill, { benefitRowsText: rows })).toEqual([]);
    // Bullets, spacing and case do not count as edits.
    expect(loeDifferences(prefill, { benefitRowsText: rows.split("\n").map((r) => `- ${r.toUpperCase()}  `).join("\n") })).toEqual([]);

    const first = rows.split("\n")[0];
    const edited = rows.replace(first, first.replace("$3,250", "$2,250"));
    const out = loeDifferences(prefill, { benefitRowsText: edited });
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("Chart rows differ from");
    expect(out[0]).toContain(`not in the letter: "${first}"`);
    expect(out[0]).toContain("$2,250");

    const added = loeDifferences(prefill, { benefitRowsText: `${rows}\nRush fee — $500` });
    expect(added[0]).toContain(`not on ${prefill.reference}: "Rush fee — $500"`);
    expect(loeDifferences(prefill, { benefitRowsText: "" })[0]).toContain("not in the letter");
  });

  it("reports edited or removed discount math, and math added where the quote had none", () => {
    expect(loeDifferences(prefill, { amountPaidMath: prefill.amountPaidMath })).toEqual([]);
    expect(loeDifferences(prefill, { amountPaidMath: "$3,750 − $500 = $3,250" })[0]).toMatch(/Discount math is entered as/);
    expect(loeDifferences(prefill, { amountPaidMath: "" })[0]).toMatch(/Discount math was removed/);
    const bare = build(snapshotOf([pl({ id: "p", label: "Package", unit_amount_cents: 100_000 })]));
    expect(bare.amountPaidMath).toBe("");
    expect(loeDifferences(bare, { amountPaidMath: "" })).toEqual([]);
    expect(loeDifferences(bare, { amountPaidMath: "$1,200 − $200 = $1,000" })[0]).toMatch(/was added/);
  });

  it("reports an edited fee structure and scope on the general letter", () => {
    expect(loeDifferences(prefill, { feeStructure: prefill.feeStructure, scopeDescription: prefill.scopeDescription })).toEqual([]);
    const out = loeDifferences(prefill, { feeStructure: "Flat fee: $2,000", scopeDescription: "Enhanced package (2 classes)" });
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/Fee structure is entered as "Flat fee: \$2,000"/);
    expect(out[1]).toMatch(/Scope lines differ.*not in the letter: "Watch service, year one"/);
  });

  it("has nothing to compare against where the quote has no value", () => {
    const bare = build(snapshotOf([pl({ id: "p", label: "Package", unit_amount_cents: 100_000 })]), { ...MATTER, package_name: null, international_classes: null });
    expect(loeDifferences(bare, { packageName: "Whatever", classCount: 4 })).toEqual([]);
  });
});
