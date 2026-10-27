import { describe, expect, it } from "vitest";
import { draftProposalFromConsult, type ConsultProposalExtract } from "@/lib/consult-proposal/draft";
import { choosePackage } from "@/lib/consult-proposal/package-choice";
import type { ConsultProposalDraft, ConsultTranscriptTurn } from "@/lib/consult-proposal/types";
import { findPackageSpoken, packageSpokenKey } from "@/lib/proposals/package-list";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import type { ProposalPricing } from "@/lib/proposals/types";
import { fakeLlm } from "../agents/helpers";
import { draftInput, meetingSource, sevetriOutput } from "./fixture";

const CONCIERGE: ProposalPricing = { package: "Concierge", base_cents: 495_000, included_classes: 3, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 };
const ESSENTIAL: ProposalPricing = { package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 };
const ENHANCED: ProposalPricing = { package: "Enhanced", base_cents: 295_000, included_classes: 2, per_class_cents: 82_500, second_mark_discount_pct: 20, gov_per_class_cents: 35_000 };
const LIST = [CONCIERGE, ESSENTIAL, ENHANCED];

type Ok = Extract<ConsultProposalDraft, { ok: true }>;
const ok = (d: ConsultProposalDraft): Ok => {
  if (!d.ok) throw new Error(`${d.reason}: ${d.message}`);
  return d;
};
const quoteOf = (d: Ok) => quoteProposal(d.content, defaultSelection(d.content));

/** Melvin's call: one brand, a word and a logo mark, one class; Essential, a $150 credit and 10% off the second. */
const MELVIN: ConsultTranscriptTurn[] = [
  { speaker: "Rebecca", text: "For Larrytech I recommend the word mark and the logo, covering your online coaching services." },
  { speaker: "Rebecca", text: "I think the Essential package is the right fit for you." },
  { speaker: "Rebecca", text: "Because you booked the consult I'll give you a $150 credit toward the legal fee." },
  { speaker: "Rebecca", text: "And I can do 10% off the second mark since you are filing both." },
  { speaker: "Melvin Larry", text: "That sounds great, thank you." },
];

function melvinOutput(over: Partial<ConsultProposalExtract> = {}): ConsultProposalExtract {
  const base = sevetriOutput();
  return {
    ...base,
    brands: [
      {
        name: "Larrytech",
        what: "Your company name",
        note_from_attorney: null,
        marks: [
          { kind: "word", preselected: true, why_quote: "For Larrytech I recommend the word mark and the logo" },
          { kind: "logo", preselected: true, why_quote: "For Larrytech I recommend the word mark and the logo" },
        ],
        classes: [{ label: "Online Coaching Services", preselected: true, why_quote: "covering your online coaching services" }],
      },
    ],
    recommended_package: "Essential",
    credits: [{ label: "Consult credit", amount_usd: 150, percent: null, quote: "I'll give you a $150 credit toward the legal fee" }],
    second_mark_discount: { percent: 10, quote: "I can do 10% off the second mark" },
    reasoning_parts: { principle: false, risk_brand: null, risk_quote: null, fallback_brand: null, fallback_quote: null },
    ...over,
  };
}

const lead = { id: "lead-melvin", firstName: "Melvin", lastName: "Larry", email: "melvin@example.com", businessName: "Larrytech" };
const run = (out: ConsultProposalExtract, over: Record<string, unknown> = {}, turns = MELVIN) =>
  draftProposalFromConsult(draftInput(fakeLlm(out).llm, { source: meetingSource(turns), lead, packages: LIST, pricing: { ...draftInput(fakeLlm(out).llm).pricing, pricing: CONCIERGE }, ...over }));

describe("matching what was said against the firm's package list", () => {
  it.each([
    ["Essential package", "Essential"],
    ["the essential", "Essential"],
    ["Essential", "Essential"],
    ["  ESSENTIAL  ", "Essential"],
    ["the Concierge package", "Concierge"],
    ["enhanced plan", "Enhanced"],
  ])("%j means %s", (said, expected) => {
    expect(findPackageSpoken(LIST, said)?.package).toBe(expected);
  });

  it("never matches an unrelated package from part of a name", () => {
    for (const said of ["Essentials Plus", "Ess", "Premium", "Concierge Gold", "", "the", "package"]) expect(findPackageSpoken(LIST, said)).toBeUndefined();
    expect(findPackageSpoken([{ ...ESSENTIAL, package: "Essential Plus" }, ENHANCED], "Essential")).toBeUndefined();
    expect(packageSpokenKey("The Essential Package")).toBe("essential");
  });
});

describe("the recommended package, credit and second-mark discount from the call (Melvin)", () => {
  it("prices with Essential, applies the $150 credit as 'Consult credit' and 10% off the second mark", async () => {
    const d = ok(await run(melvinOutput()));
    expect(d.content.pricing).toMatchObject({ package: "Essential", base_cents: 195_000, included_classes: 1, per_class_cents: 82_500, second_mark_discount_pct: 10 });
    expect(d.content.adjustments).toEqual([{ id: "adj-1", label: "Consult credit", kind: "amount", value: 15_000 }]);
    const q = quoteOf(d);
    expect(q.names[0].marks.map((m) => m.price_cents)).toEqual([195_000, 175_500]);
    expect(q.legal_total_cents).toBe(195_000 + 175_500 - 15_000);
    expect(q.gov_total_cents).toBe(2 * 35_000);
  });

  it("names every applied choice and its source in the reviewer flags", async () => {
    const d = ok(await run(melvinOutput()));
    expect(d.reviewerNotes).toContain("Package: Essential, from the call.");
    expect(d.reviewerNotes).toContain('CHECK: applied the credit "Consult credit" of $150');
    expect(d.reviewerNotes).toContain("CHECK: second-mark discount set to 10% (the firm's is 20%)");
    expect(d.reviewerNotes).toContain("Proposal (Essential, the package named on the call)");
  });

  it("Concierge named: priced with Concierge's own price, classes and extra-class price", async () => {
    const out = melvinOutput({ recommended_package: "the Concierge package", credits: [], second_mark_discount: null });
    const d = ok(await run(out, {}, [...MELVIN, { speaker: "Rebecca", text: "Actually the Concierge package covers you for the growth you described." }]));
    expect(d.content.pricing).toMatchObject({ package: "Concierge", base_cents: 495_000, included_classes: 3 });
    expect(d.content.pricing.second_mark_discount_pct).toBe(20);
    expect(d.reviewerNotes).toContain("Package: Concierge, from the call.");
    expect(d.reviewerNotes).toContain("No second-mark discount was stated on the call, so the firm's 20% stays.");
  });

  it("an unknown package name: the default package and a CHECK FIRST flag with the name", async () => {
    const d = ok(await run(melvinOutput({ recommended_package: "Gold" })));
    expect(d.content.pricing.package).toBe("Concierge");
    expect(d.reviewerNotes).toContain(`CHECK FIRST: "Gold" isn't on your list. The proposal uses your default package (Concierge). Choose the package before saving.`);
  });

  it("no package named: the default package and a CHECK FIRST flag", async () => {
    const d = ok(await run(melvinOutput({ recommended_package: null })));
    expect(d.content.pricing.package).toBe("Concierge");
    expect(d.reviewerNotes).toContain("CHECK FIRST: no package was recommended on the call. The proposal uses your default package (Concierge). Choose the package before saving.");
  });

  it("a package the AI reported that is not in the record is not used", async () => {
    const d = ok(await run(melvinOutput({ recommended_package: "Enhanced" })));
    expect(d.content.pricing.package).toBe("Concierge");
    expect(d.reviewerNotes).toContain('CHECK FIRST: the AI reported "Enhanced", but that name was not found in the record');
  });

  it("an unreadable or empty package list falls back to the flat pricing package and says so", async () => {
    for (const packages of [null, undefined, []]) {
      const d = ok(await run(melvinOutput({ recommended_package: "Essential" }), { packages }));
      expect(d.content.pricing.package).toBe("Concierge");
      expect(d.reviewerNotes).toContain("package list couldn't be read (or is empty)");
      expect(d.reviewerNotes).toContain("flat Concierge pricing");
    }
  });
});

describe("credit and second-mark percent need the attorney's own words", () => {
  it("a credit whose quote is not in the transcript is not applied, and the flag says so", async () => {
    const out = melvinOutput({ credits: [{ label: "Consult credit", amount_usd: 150, percent: null, quote: "I will take $150 off because of the consult fee" }] });
    const d = ok(await run(out));
    expect(d.content.adjustments).toEqual([]);
    expect(d.reviewerNotes).toContain('Not applied: the credit "Consult credit" of $150, because its quote was not found in the record');
  });

  it("a second-mark percent without evidence leaves the firm's percent and is flagged", async () => {
    const out = melvinOutput({ second_mark_discount: { percent: 10, quote: "I would give you ten percent off the second one" } });
    const d = ok(await run(out));
    expect(d.content.pricing.second_mark_discount_pct).toBe(20);
    expect(d.reviewerNotes).toContain("Second-mark discount of 10% was ignored, because its quote was not found in the record");
    expect(d.reviewerNotes).toContain("The firm's 20% stays.");
  });

  it("a percent over 50 is ignored and flagged, even with a real quote", async () => {
    const turns = [...MELVIN, { speaker: "Rebecca", text: "I could do 80% off the second mark for you." }];
    const out = melvinOutput({ second_mark_discount: { percent: 80, quote: "I could do 80% off the second mark for you" } });
    const d = ok(await run(out, {}, turns));
    expect(d.content.pricing.second_mark_discount_pct).toBe(20);
    expect(d.reviewerNotes).toContain("Second-mark discount of 80% was ignored, because it is more than 50%");
  });

  it("only the client saying it does not count", async () => {
    const turns: ConsultProposalExtractTurns = [...MELVIN, { speaker: "Melvin Larry", text: "Could you do 15% off the second mark for me?" }];
    const out = melvinOutput({ second_mark_discount: { percent: 15, quote: "Could you do 15% off the second mark for me" } });
    const d = ok(await run(out, {}, turns));
    expect(d.content.pricing.second_mark_discount_pct).toBe(20);
    expect(d.reviewerNotes).toContain("only the client said it");
  });

  it("a credit larger than the legal fee is capped at the fee and flagged", async () => {
    const turns = [...MELVIN, { speaker: "Rebecca", text: "I'll give you a $9,000 credit as well." }];
    const out = melvinOutput({
      credits: [{ label: "Consult credit", amount_usd: 9000, percent: null, quote: "I'll give you a $9,000 credit as well" }],
    });
    const d = ok(await run(out, {}, turns));
    const subtotal = quoteProposal({ ...d.content, adjustments: [] }, defaultSelection(d.content)).legal_subtotal_cents;
    expect(d.content.adjustments).toEqual([{ id: "adj-1", label: "Consult credit", kind: "amount", value: subtotal }]);
    expect(quoteOf(d).legal_total_cents).toBe(0);
    expect(d.reviewerNotes).toContain('The credit "Consult credit" of $9,000 is more than the legal fee it comes off');
  });
});
type ConsultProposalExtractTurns = ConsultTranscriptTurn[];

describe("reviewed consult details outrank the call for the package; unreviewed ones do not", () => {
  const details = (review: boolean) => ({
    marks: [],
    recommended_package: "Enhanced",
    discount_discussed: null,
    ...(review ? { review: { reviewed_by_name: "Rebecca", reviewed_at: "2026-10-20T12:00:00Z", reviewed_by: "u1" } } : {}),
  });

  it("a reviewed package on the list wins over the call's", async () => {
    const d = ok(await run(melvinOutput(), { reviewedConsult: { status: "ok", details: details(true), unreadable: false, unreviewed: false } }));
    expect(d.content.pricing).toMatchObject({ package: "Enhanced", included_classes: 2, base_cents: 295_000 });
    expect(d.reviewerNotes).toContain("Package: Enhanced, from the reviewed consult details (reviewed by Rebecca).");
    expect(d.reviewerNotes).toContain(`The AI's reading of the call named "Essential"; the reviewed details were used instead.`);
    expect(d.reviewerNotes).toContain("Proposal (Enhanced, the package named in the reviewed consult details)");
  });

  it("unreviewed, unreadable and unavailable details are not used (the last two are said)", async () => {
    for (const read of [
      { status: "ok", details: null, unreadable: false, unreviewed: true },
      { status: "ok", details: null, unreadable: true, unreviewed: false },
      { status: "unavailable" },
    ] as const) {
      const d = ok(await run(melvinOutput(), { reviewedConsult: read }));
      expect(d.content.pricing.package).toBe("Essential");
      expect(d.reviewerNotes).not.toContain("from the reviewed consult details");
    }
    const unreadable = ok(await run(melvinOutput(), { reviewedConsult: { status: "unavailable" } }));
    expect(unreadable.reviewerNotes).toContain("reviewed consult details couldn't be read");
  });

  it("reviewed details that name a package not on the list are said and not used", async () => {
    const d = ok(await run(melvinOutput(), { reviewedConsult: { status: "ok", details: { ...details(true), recommended_package: "Platinum" }, unreadable: false, unreviewed: false } }));
    expect(d.content.pricing.package).toBe("Essential");
    expect(d.reviewerNotes).toContain('name "Platinum", which isn\'t on your current list');
  });
});

describe("a reduced / custom package needs the attorney's words", () => {
  it("sets reduce_under_included only with a real quote, and raises a CHECK FIRST flag", async () => {
    const turns = [...MELVIN, { speaker: "Rebecca", text: "If you only want one class I can reduce the package price for you." }];
    const out = melvinOutput({ recommended_package: "Enhanced", reduced_package: { quote: "If you only want one class I can reduce the package price for you" } });
    const d = ok(await run(out, {}, [...turns, { speaker: "Rebecca", text: "Enhanced is the one for you." }]));
    expect(d.content.pricing.reduce_under_included).toBe(true);
    expect(d.reviewerNotes).toContain("CHECK FIRST: priced as a custom package: $825 less for each class under the 2 included");
  });

  it("without a real quote it stays flat and says it was not applied", async () => {
    const out = melvinOutput({ recommended_package: "Enhanced", reduced_package: { quote: "she said she would make it cheaper" } });
    const d = ok(await run(out, {}, [...MELVIN, { speaker: "Rebecca", text: "Enhanced is the one for you." }]));
    expect(d.content.pricing.reduce_under_included).toBeUndefined();
    expect(d.reviewerNotes).toContain("Not applied: a reduced or custom package, because its quote was not found in the record");
  });

  it("is absent by default", async () => {
    const d = ok(await run(melvinOutput()));
    expect("reduce_under_included" in d.content.pricing).toBe(false);
  });
});

describe("choosePackage, as a pure function", () => {
  const base = { packages: LIST, flat: CONCIERGE, reviewedName: null, reviewedBy: null, callName: null, callNameInRecord: false };
  it("flat pricing without a list", () => {
    expect(choosePackage({ ...base, packages: null }).source).toBe("flat");
  });
  it("the default is the first on the list", () => {
    expect(choosePackage(base)).toMatchObject({ source: "default", pricing: { package: "Concierge" } });
  });
  it("a copy: changing the result never changes the firm's list", () => {
    const r = choosePackage({ ...base, callName: "Essential", callNameInRecord: true });
    r.pricing.second_mark_discount_pct = 1;
    expect(ESSENTIAL.second_mark_discount_pct).toBe(20);
  });
});
