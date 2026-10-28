import { describe, it, expect } from "vitest";
import { buildTrademarkLoeDraft } from "@/lib/documents/loe";
import {
  amountPaidMath,
  chartRowsFor,
  flattenFeeChart,
  govFeesText,
  isIncludedCell,
  loeFieldValues,
  loeInputFromAcceptedProposal,
  loeVariantFor,
  LOE_REFUSAL_TEXT,
} from "@/lib/proposals/loe-adapter";
import { quoteWithAddedClasses } from "@/lib/proposals/added-classes";
import { sevetri } from "./fixture";
import { acceptedSnapshot, CONCIERGE } from "./accepted-fixture";

const FACTS = { packages: [CONCIERGE], todayIso: "2026-10-22" };

function adapt(snapshot = acceptedSnapshot(), facts = FACTS) {
  const r = loeInputFromAcceptedProposal(snapshot, facts);
  if (!r.ok) throw new Error(`refused: ${r.reason}`);
  return r.input;
}

describe("loeInputFromAcceptedProposal: a real-shaped accepted snapshot", () => {
  it("maps the package, client, entity, mark, classes and chart rows", () => {
    const input = adapt(acceptedSnapshot({ classes: 2 }));
    expect(input).toMatchObject({
      variant: "current",
      packageName: "Concierge",
      clientName: "Sevetri Wilson",
      entityName: "Prosperall",
      markText: "Prosperall",
      classSelected: "Cloud-Based Software as a Service (SaaS), Consulting & Professional Services",
      classCount: 2,
      sendDateIso: "2026-10-22",
    });
    expect(input.benefitRowsText.split("\n")).toEqual([
      "Classes Included | 3 Classes",
      "Non-Substantive Office Action Response ($450 each) | Unlimited",
      "Substantive Office Action Legal Strategy Review ($675) | ✓",
    ]);
  });

  it("entityName is null without a company, and clientName is trimmed", () => {
    expect(adapt(acceptedSnapshot({ company: null })).entityName).toBeNull();
  });

  it("drops a row whose included cell is blank or a dash, and keeps a row with a note", () => {
    const includes = [
      ...sevetri().includes,
      { label: "Trademark Watch", included: "—" },
      { label: "Logo redesign", included: "-" },
      { label: "Expedited filing", included: "  " },
      { label: "Rush", included: "No" },
      { label: "N/A row", included: "n/a" },
      { label: "Ownership review", value: "$300", included: "✓", note: "Optional" },
    ];
    const rows = chartRowsFor({ ...sevetri(), includes });
    expect(rows.join("\n")).not.toMatch(/Watch|redesign|Expedited|Rush|N\/A row/);
    expect(rows).toContain("Ownership review ($300) | ✓");
    expect(rows).toContain("Substantive Office Action Legal Strategy Review ($675) | ✓");
  });

  it.each([
    ["", false],
    ["—", false],
    ["–", false],
    ["-", false],
    ["no", false],
    [" None ", false],
    ["N/A", false],
    ["✓", true],
    ["Unlimited", true],
    ["Your choice (up to 3)", true],
  ])("isIncludedCell(%j) is %s", (cell, expected) => {
    expect(isIncludedCell(cell)).toBe(expected);
  });

  it("amountPaid is the legal total; the gov fees are separate and never summed in", () => {
    const snap = acceptedSnapshot({ classes: 2, marks: ["word", "logo"] });
    const input = adapt(snap);
    expect(input.amountPaid).toBe(`$${(snap.quote.legal_total_cents / 100).toLocaleString("en-US")}`);
    const draft = buildTrademarkLoeDraft(input);
    const summed = snap.quote.legal_total_cents + snap.quote.gov_total_cents;
    const wire = `${draft.draftBody}\n${JSON.stringify(draft.payload)}`;
    for (const s of [String(summed), `$${(summed / 100).toLocaleString("en-US")}`, `$${(summed / 100).toFixed(2)}`]) expect(wire).not.toContain(s);
  });

  it.each([1, 2, 3])("gov fees for %i class(es) at the default $350 equal 350 x classes", (n) => {
    const snap = acceptedSnapshot({ classes: n });
    expect(snap.quote.gov_total_cents).toBe(35_000 * n);
    const input = adapt(snap);
    expect(input.govFeesText).toBe(`$${(350 * n).toLocaleString("en-US")} ($350 × ${n} ${n === 1 ? "class" : "classes"})`);
  });

  it("a firm that priced the USPTO fee differently gets the quoted figure, not a recomputed constant", () => {
    const snap = acceptedSnapshot({ classes: 2 });
    snap.quote.gov_total_cents = 61_000; // not 2 x the 350 per class on the content
    expect(adapt(snap).govFeesText).toBe("$610");
    expect(govFeesText(snap.quote, 0, 2)).toBe("$610");
  });

  it("shows the second-mark discount and an amount adjustment verbatim in the math line", () => {
    const snap = acceptedSnapshot({
      classes: 2,
      marks: ["word", "logo"],
      adjustments: [{ id: "a1", label: "Event discount", kind: "amount", value: 25_000 }],
    });
    const taken = snap.quote.adjustments.map((a) => a.discount_cents);
    expect(taken).toEqual([25_000]);
    const math = amountPaidMath(snap.quote)!;
    const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US")}`;
    expect(math).toBe(`${dollars(snap.quote.legal_subtotal_cents)} − $250 = ${dollars(snap.quote.legal_total_cents)}`);
    expect(adapt(snap).amountPaidMath).toBe(math);
    // The second-mark discount is already inside the subtotal, so the legal total is lower than two full marks.
    expect(snap.quote.legal_subtotal_cents).toBeLessThan(2 * snap.quote.names[0].base_cents);
  });

  it("a percent adjustment shows the dollars actually taken off", () => {
    const snap = acceptedSnapshot({ adjustments: [{ id: "a1", label: "10% off", kind: "percent", value: 10 }] });
    const off = snap.quote.adjustments[0].discount_cents;
    expect(off).toBeGreaterThan(0);
    expect(amountPaidMath(snap.quote)).toContain(`− $${(off / 100).toLocaleString("en-US")}`);
    expect(amountPaidMath(snap.quote)).not.toContain("%");
  });

  it("two adjustments give one subtraction each", () => {
    const snap = acceptedSnapshot({
      adjustments: [
        { id: "a1", label: "A", kind: "amount", value: 10_000 },
        { id: "a2", label: "B", kind: "amount", value: 5_000 },
      ],
    });
    expect(amountPaidMath(snap.quote)).toMatch(/− \$100 − \$50 = /);
  });

  it("no adjustments gives no math", () => {
    expect(adapt(acceptedSnapshot()).amountPaidMath).toBeNull();
  });
});

describe("the LOE draft built from the adapter's output", () => {
  const input = adapt(acceptedSnapshot({ classes: 2, marks: ["word", "logo"] }));
  const draft = buildTrademarkLoeDraft(input);

  it("is the current template, in the chart format, for the chosen package only", () => {
    expect(draft.docType).toBe("loe_trademark_current");
    expect(draft.draftBody).toContain("**Trademark Package — Word Mark – Prosperall**");
    expect(draft.draftBody).toContain("Classes Included");
    expect(draft.draftBody).toContain("Class Selected:");
    expect(draft.draftBody).toContain("Amount Paid");
    expect(draft.draftBody).toContain("Government Filing Fees (Unpaid)");
    expect(draft.draftBody).toContain("Concierge");
    expect(draft.draftBody).not.toMatch(/Basic|Standard|Premium|Essentials/);
  });

  it("the signature deadline is the send date plus 14 days", () => {
    const deadline = (iso: string) => buildTrademarkLoeDraft({ ...input, sendDateIso: iso }).payload.signatureDeadline;
    expect(deadline("2026-10-22")).toBe("2026-11-05");
    expect(buildTrademarkLoeDraft(input).draftBody).toContain("signature deadline field to **2026-11-05** (send date + 14 days)");
    // Month boundary and a leap day.
    expect(deadline("2026-10-25")).toBe("2026-11-08");
    expect(deadline("2028-02-20")).toBe("2028-03-05"); // 2028 is a leap year: Feb has 29 days
    expect(deadline("2027-02-20")).toBe("2027-03-06");
    expect(deadline("2026-12-25")).toBe("2027-01-08");
  });
});

describe("loeVariantFor", () => {
  it("is current for a package named in the firm's list, in any letter case and with extra spaces", () => {
    for (const name of ["Concierge", "concierge", "  CONCIERGE ", "Concierge "]) {
      expect(loeVariantFor(name, [CONCIERGE])).toEqual({ ok: true, variant: "current" });
    }
  });

  it("an unknown package, a blank one and a non-string are unknown_package", () => {
    for (const name of ["Platinum", "", "   ", null, undefined, 5]) {
      expect(loeVariantFor(name, [CONCIERGE])).toEqual({ ok: false, reason: "unknown_package" });
    }
  });

  it("an unreadable list is its own answer, never unknown and never current", () => {
    expect(loeVariantFor("Concierge", null)).toEqual({ ok: false, reason: "package_list_unreadable" });
  });

  it("never yields legacy", () => {
    expect(JSON.stringify(loeVariantFor("Concierge", [CONCIERGE]))).not.toContain("legacy");
  });
});

describe("refusals", () => {
  it("an unknown package gives no draft", () => {
    const r = loeInputFromAcceptedProposal(acceptedSnapshot({ packageName: "Platinum" }), FACTS);
    expect(r).toEqual({ ok: false, reason: "unknown_package" });
  });

  it("an unreadable package list gives no draft", () => {
    expect(loeInputFromAcceptedProposal(acceptedSnapshot(), { ...FACTS, packages: null })).toEqual({ ok: false, reason: "package_list_unreadable" });
  });

  it("two included brands give multiple_brands", () => {
    expect(loeInputFromAcceptedProposal(acceptedSnapshot({ brands: ["p", "t"] }), FACTS)).toEqual({ ok: false, reason: "multiple_brands" });
    expect(LOE_REFUSAL_TEXT.multiple_brands).toBe("More than one brand was accepted. Draft each engagement letter from the LOE form.");
  });

  it("no included brand gives no_brand", () => {
    const snap = acceptedSnapshot();
    snap.quote.names.forEach((n) => (n.included = false));
    expect(loeInputFromAcceptedProposal(snap, FACTS)).toEqual({ ok: false, reason: "no_brand" });
  });
});

describe("the fee chart flattened for the Lawmatics fields", () => {
  const input = adapt(acceptedSnapshot({ classes: 2, marks: ["word", "logo"], adjustments: [{ id: "a", label: "x", kind: "amount", value: 10_000 }] }));

  it("is one text with the chart, classes, amount math and gov fees on their own lines", () => {
    const text = flattenFeeChart(input);
    expect(text.split("\n")[0]).toBe("Trademark Package — Word Mark – Prosperall");
    expect(text).toContain("Classes Included | 3 Classes");
    expect(text).toContain("Class Selected: Cloud-Based Software as a Service (SaaS), Consulting & Professional Services");
    expect(text).toContain(`Amount Paid: ${input.amountPaid} (${input.amountPaidMath})`);
    expect(text).toContain("Government Filing Fees (Unpaid): ");
  });

  it("gives legal and USPTO as separate values and never sums them", () => {
    const values = loeFieldValues(input);
    expect(Object.keys(values)).toEqual(["LOE Package", "LOE Fee Chart", "LOE Classes", "LOE Legal Fee", "LOE USPTO Fees", "LOE Signature Deadline"]);
    expect(values["LOE Package"]).toBe("Concierge");
    expect(values["LOE Legal Fee"]).toBe(input.amountPaid);
    expect(values["LOE USPTO Fees"]).toBe(input.govFeesText);
    expect(values["LOE Signature Deadline"]).toBe("2026-11-05");
  });
});

describe("Sprint 28: a snapshot with a client-added class", () => {
  it("gives the LOE the larger class count, the added class in the class list and the higher amount paid", () => {
    const base = acceptedSnapshot({ classes: 3, packageName: "Concierge" });
    const plain = adapt(base);
    const priced = quoteWithAddedClasses(base.content, base.selection, { p: ["Online store services"] });
    if (!priced.ok) throw new Error("priced");
    const added = { ...base, content: priced.content, selection: priced.selection, quote: priced.quote };
    const input = adapt(added);
    expect(input.classCount).toBe(plain.classCount + 1);
    expect(input.classSelected).toContain("Online store services");
    expect(Number(String(input.amountPaid).replace(/[^0-9.]/g, ""))).toBeGreaterThan(Number(String(plain.amountPaid).replace(/[^0-9.]/g, "")));
    expect(priced.quote.legal_total_cents - base.quote.legal_total_cents).toBe(82_500);
  });
});
