import { describe, expect, it } from "vitest";
import {
  MAX_MARKS,
  applyReview,
  formatClassLines,
  matterFieldsFromDetails,
  normalizeExtraction,
  parseClassLines,
  parseReviewForm,
  readStoredDetails,
  withConsultDetails,
  type ConsultDetailsExtract,
  type StoredConsultDetails,
} from "@/lib/consult/details";

const NOW = new Date("2026-10-09T12:00:00.000Z");
/** What the model was given. Every answer below is checked against it. */
const SOURCE = [
  "Summary: Client said the line launches in spring and nothing has been sold yet.",
  "Goods/services: t-shirts (class 25); online retail (class 35).",
  "The design version was first shown on March 5, 2024; the hats first sold on November 1, 2023.",
].join("\n");
const meta = { now: NOW, source: "post-consult-agent" as const, sourceText: SOURCE };

const mark = (over: Partial<ConsultDetailsExtract["marks"][number]> = {}): ConsultDetailsExtract["marks"][number] => ({
  mark: "SANKOFA",
  mark_type: "word",
  classes: [{ class: 25, goods: "Clothing, namely t-shirts" }],
  filing_basis: "1b",
  basis_evidence: "Client said the line launches in spring and nothing has been sold yet.",
  first_use_date: null,
  ...over,
});
const extract = (marks = [mark()], over: Partial<ConsultDetailsExtract> = {}): ConsultDetailsExtract => ({
  marks,
  recommended_package: "Enhanced",
  discount_discussed: null,
  ...over,
});

function details(over: Partial<StoredConsultDetails> = {}): StoredConsultDetails {
  const base = normalizeExtraction(extract(), meta)!;
  return { ...base, ...over };
}
const reviewer = { userId: "user-1", name: "Dawn", role: "paralegal" };

describe("normalizeExtraction: what the model said, cleaned, never improved", () => {
  it("keeps a stated basis with its evidence, the classes with their goods, and the package", () => {
    const d = normalizeExtraction(extract([mark({ first_use_date: "2024-03-05" })]), { ...meta, source: "meeting-follow-up", meetingId: "mtg-1" })!;
    expect(d).toMatchObject({
      version: 1,
      rev: 0,
      review: null,
      recommended_package: "Enhanced",
      discount_discussed: null,
      extracted: { at: NOW.toISOString(), source: "meeting-follow-up", meeting_id: "mtg-1" },
    });
    expect(d.marks).toEqual([
      {
        id: "m1",
        mark: "SANKOFA",
        mark_type: "word",
        classes: [{ class: 25, goods: "Clothing, namely t-shirts" }],
        filing_basis: "1b",
        extracted_basis: "1b",
        basis_evidence: "Client said the line launches in spring and nothing has been sold yet.",
        first_use_date: "2024-03-05",
      },
    ]);
  });

  it("turns a basis with NO evidence into unknown, whatever the model answered", () => {
    for (const evidence of [null, "", "   "]) {
      const d = normalizeExtraction(extract([mark({ filing_basis: "1a", basis_evidence: evidence })]), meta)!;
      expect(d.marks[0]).toMatchObject({ filing_basis: "unknown", extracted_basis: "unknown", basis_evidence: null });
    }
  });

  it("keeps a basis only when its evidence is a verbatim quote from what the model was given", () => {
    const keep = (basis_evidence: string) => normalizeExtraction(extract([mark({ filing_basis: "1b", basis_evidence })]), meta)!.marks[0].filing_basis;
    // the same words, whatever the case, punctuation or line breaks
    expect(keep("nothing has been sold yet")).toBe("1b");
    expect(keep("“Nothing has been SOLD yet!”")).toBe("1b");
    // invented, paraphrased, or a fragment too short to mean anything on its own
    expect(keep("The client confirmed the mark has never been used in commerce.")).toBe("unknown");
    expect(keep("Client said nothing was sold yet.")).toBe("unknown");
    expect(keep("sold yet")).toBe("unknown");
    // the quote has to stand on whole words: "first shown on March" is not in "first shown on Marches"
    const d = normalizeExtraction(extract([mark({ filing_basis: "1a", basis_evidence: "first shown on March" })]), { ...meta, sourceText: "It was first shown on Marches" })!;
    expect(d.marks[0]).toMatchObject({ filing_basis: "unknown", extracted_basis: "unknown", basis_evidence: null });
  });

  it("with nothing to check against, keeps no basis, class number or date at all", () => {
    const d = normalizeExtraction(extract([mark({ first_use_date: "2024-03-05" })]), { ...meta, sourceText: "" })!;
    expect(d.marks[0]).toMatchObject({ filing_basis: "unknown", basis_evidence: null, first_use_date: null, classes: [{ class: null, goods: "Clothing, namely t-shirts" }] });
  });

  it("drops a class number the source never gave, keeping the goods unclassified", () => {
    const d = normalizeExtraction(extract([mark({ classes: [{ class: 25, goods: "T-shirts" }, { class: 18, goods: "Tote bags" }] })]), meta)!;
    expect(d.marks[0].classes).toEqual([
      { class: 25, goods: "T-shirts" },
      { class: null, goods: "Tote bags" },
    ]);
  });

  it("drops a first-use date whose year and day aren't in the source", () => {
    expect(normalizeExtraction(extract([mark({ first_use_date: "2022-06-14" })]), meta)!.marks[0].first_use_date).toBeNull();
    expect(normalizeExtraction(extract([mark({ first_use_date: "2024-03-05" })]), meta)!.marks[0].first_use_date).toBe("2024-03-05");
  });

  it("leaves an unknown basis unknown, and drops evidence it can't attach to anything", () => {
    const d = normalizeExtraction(extract([mark({ filing_basis: "unknown", basis_evidence: "irrelevant" })]), meta)!;
    expect(d.marks[0]).toMatchObject({ filing_basis: "unknown", basis_evidence: null });
  });

  it("drops a class number outside 1-45 but keeps the goods, unclassified", () => {
    const d = normalizeExtraction(
      extract([mark({ classes: [{ class: 46, goods: "Hats" }, { class: 0, goods: "Shoes" }, { class: 9.5, goods: "Apps" }, { class: null, goods: "Mugs" }, { class: 99, goods: "" }] })]),
      meta,
    )!;
    expect(d.marks[0].classes).toEqual([
      { class: null, goods: "Hats" },
      { class: null, goods: "Shoes" },
      { class: null, goods: "Apps" },
      { class: null, goods: "Mugs" },
    ]);
  });

  it("only keeps a first-use date that is a real, complete date", () => {
    const dates = ["2024-02-30", "March 2024", "2024", "05/03/2024", "2024-13-01", ""];
    for (const first_use_date of dates) {
      expect(normalizeExtraction(extract([mark({ first_use_date })]), meta)!.marks[0].first_use_date, first_use_date).toBeNull();
    }
    expect(normalizeExtraction(extract([mark({ first_use_date: "2023-11-01" })]), meta)!.marks[0].first_use_date).toBe("2023-11-01");
  });

  it("drops a mark with no text, merges the same mark said twice, and numbers what is left", () => {
    const d = normalizeExtraction(
      extract([
        mark({ mark: "  " }),
        mark({ mark: "Sankofa", classes: [{ class: 25, goods: "T-shirts" }] }),
        mark({ mark: "SANKOFA!", classes: [{ class: 35, goods: "Online retail" }, { class: 25, goods: "T-shirts" }] }),
        mark({ mark: "KENTE", classes: [] }),
      ]),
      meta,
    )!;
    expect(d.marks.map((m) => [m.id, m.mark])).toEqual([
      ["m1", "Sankofa"],
      ["m2", "KENTE"],
    ]);
    expect(d.marks[0].classes).toEqual([
      { class: 25, goods: "T-shirts" },
      { class: 35, goods: "Online retail" },
    ]);
  });

  it("calls the basis unknown when the same mark was read two different ways", () => {
    const d = normalizeExtraction(extract([mark({ filing_basis: "1a" }), mark({ filing_basis: "1b" })]), meta)!;
    expect(d.marks).toHaveLength(1);
    expect(d.marks[0]).toMatchObject({ filing_basis: "unknown", basis_evidence: null });
  });

  it("keeps a word mark and a design mark of the same name as two marks", () => {
    const d = normalizeExtraction(extract([mark({ mark_type: "word" }), mark({ mark_type: "design" })]), meta)!;
    expect(d.marks.map((m) => m.mark_type)).toEqual(["word", "design"]);
  });

  it("caps the marks, and treats a malformed answer as nothing rather than guessing", () => {
    const many = Array.from({ length: MAX_MARKS + 5 }, (_, i) => mark({ mark: `MARK${i}` }));
    expect(normalizeExtraction(extract(many), meta)!.marks).toHaveLength(MAX_MARKS);
    expect(normalizeExtraction(undefined, meta)).toBeNull();
    expect(normalizeExtraction({ marks: "SANKOFA" }, meta)).toBeNull();
    expect(normalizeExtraction(extract([mark({ filing_basis: "1c" as never })]), meta)).toBeNull();
  });

  it("an extraction that found no marks is still a record (the card says so)", () => {
    expect(normalizeExtraction(extract([], { recommended_package: "  ", discount_discussed: " 10% friends " }), meta)).toMatchObject({
      marks: [],
      recommended_package: null,
      discount_discussed: "10% friends",
    });
  });
});

describe("the stored record", () => {
  it("reads three ways: absent, readable, present-but-unreadable", () => {
    expect(readStoredDetails({ summary: "x" })).toEqual({ kind: "none" });
    expect(readStoredDetails(null)).toEqual({ kind: "none" });
    expect(readStoredDetails([])).toEqual({ kind: "none" });
    const d = details();
    expect(readStoredDetails({ consult_details: d })).toEqual({ kind: "ok", details: d });
    expect(readStoredDetails({ consult_details: { version: 1 } })).toEqual({ kind: "invalid" });
    expect(readStoredDetails({ consult_details: "SANKOFA 1b" })).toEqual({ kind: "invalid" });
    expect(readStoredDetails({ consult_details: { ...d, marks: [{ ...d.marks[0], filing_basis: "1c" }] } })).toEqual({ kind: "invalid" });
  });

  it("is added beside the notes lectual wrote, not over them", () => {
    const d = details();
    expect(withConsultDetails({ summary: "Wants SANKOFA", marks_discussed: ["SANKOFA"], classes: { class_count: 1 } }, d)).toEqual({
      summary: "Wants SANKOFA",
      marks_discussed: ["SANKOFA"],
      classes: { class_count: 1 },
      consult_details: d,
    });
    expect(withConsultDetails(null, d)).toEqual({ consult_details: d });
  });
});

describe("class lines", () => {
  it("round-trips class: goods lines, with a line that has no class number kept as goods", () => {
    const classes = [
      { class: 25, goods: "Clothing, namely t-shirts" },
      { class: 35, goods: "" },
      { class: null, goods: "Mugs" },
    ];
    expect(formatClassLines(classes)).toBe("25: Clothing, namely t-shirts\n35:\nMugs");
    expect(parseClassLines(formatClassLines(classes))).toEqual(classes);
  });

  it("accepts 'Class 25: x' and 'Class 25 - x', and a bare number as a class", () => {
    expect(parseClassLines("Class 25: Hats\nclass 35 - Retail\n9")).toEqual([
      { class: 25, goods: "Hats" },
      { class: 35, goods: "Retail" },
      { class: 9, goods: "" },
    ]);
  });

  it("does not mistake a number inside a description for a class", () => {
    expect(parseClassLines("24-hour fitness classes\n3D printed toys\n100 percent cotton shirts")).toEqual([
      { class: null, goods: "24-hour fitness classes" },
      { class: null, goods: "3D printed toys" },
      { class: null, goods: "100 percent cotton shirts" },
    ]);
  });

  it("refuses a class outside 1-45 rather than dropping it", () => {
    expect(() => parseClassLines("46: Hats")).toThrow(/out of range/);
    expect(() => parseClassLines("0: Hats")).toThrow(/out of range/);
  });

  it("ignores blank lines and repeats", () => {
    expect(parseClassLines("\n25: Hats\n\n25: Hats\n")).toEqual([{ class: 25, goods: "Hats" }]);
    expect(parseClassLines("")).toEqual([]);
    expect(parseClassLines(null)).toEqual([]);
  });
});

function formOf(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("parseReviewForm", () => {
  const base = { markCount: "2", m0_id: "m1", m0_text: "SANKOFA", m0_type: "word", m0_basis: "1b", m0_first_use: "", m0_classes: "25: Hats", package: " Enhanced ", discount: "" };

  it("reads each mark's fields, skipping the empty new-mark slot", () => {
    const r = parseReviewForm(formOf(base));
    expect(r).toEqual({
      ok: true,
      value: {
        marks: [{ id: "m1", mark: "SANKOFA", mark_type: "word", filing_basis: "1b", first_use_date: null, classes: [{ class: 25, goods: "Hats" }] }],
        recommended_package: "Enhanced",
        discount_discussed: null,
      },
    });
  });

  it("treats an unset basis or type as unknown, never as a default answer", () => {
    const r = parseReviewForm(formOf({ markCount: "1", m0_text: "SANKOFA" }));
    expect(r).toMatchObject({ ok: true, value: { marks: [{ mark_type: "unknown", filing_basis: "unknown", id: null }] } });
  });

  it("drops only a mark the reviewer ticked Remove on", () => {
    const r = parseReviewForm(formOf({ ...base, m0_remove: "on" }));
    expect(r).toMatchObject({ ok: true, value: { marks: [] } });
  });

  it("refuses a mark with no text instead of quietly dropping it", () => {
    const r = parseReviewForm(formOf({ ...base, m0_text: "" }));
    expect(r).toEqual({ ok: false, error: "Mark 1 needs its text — or tick “Remove this mark”." });
    // a new slot with only a class typed in is also not silently ignored
    expect(parseReviewForm(formOf({ markCount: "1", m0_classes: "25: Hats" })).ok).toBe(false);
  });

  it("refuses values a hand-built request could send", () => {
    expect(parseReviewForm(formOf({ ...base, m0_basis: "1c" })).ok).toBe(false);
    expect(parseReviewForm(formOf({ ...base, m0_type: "logo" })).ok).toBe(false);
    expect(parseReviewForm(formOf({ ...base, m0_first_use: "2024-02-30" }))).toMatchObject({ ok: false, error: expect.stringMatching(/Mark 1: .*real calendar date/) });
    expect(parseReviewForm(formOf({ ...base, m0_classes: "50: Hats" }))).toMatchObject({ ok: false, error: expect.stringMatching(/Mark 1: .*out of range/) });
    expect(parseReviewForm(formOf({ ...base, markCount: "-1" })).ok).toBe(false);
    expect(parseReviewForm(formOf({ ...base, markCount: "abc" })).ok).toBe(false);
    expect(parseReviewForm(formOf({ ...base, markCount: String(MAX_MARKS + 5) })).ok).toBe(false);
  });

  it("allows an empty list: confirming that the consult named no marks", () => {
    expect(parseReviewForm(formOf({ markCount: "1" }))).toMatchObject({ ok: true, value: { marks: [] } });
  });
});

describe("applyReview", () => {
  const input = (marks: Parameters<typeof applyReview>[1]["marks"], over = {}) => ({ marks, recommended_package: "Enhanced", discount_discussed: null, ...over });

  it("stamps who reviewed and when, and bumps the revision", () => {
    const r = applyReview(details(), input([{ id: "m1", mark: "SANKOFA", mark_type: "word", filing_basis: "1b", first_use_date: null, classes: [] }]), reviewer, NOW);
    expect(r.rev).toBe(1);
    expect(r.review).toEqual({ reviewed_at: NOW.toISOString(), reviewed_by: "user-1", reviewed_by_name: "Dawn", reviewed_by_role: "paralegal" });
    expect(r.extracted).toEqual(details().extracted);
  });

  it("keeps what the model read and its evidence when staff correct the basis", () => {
    const r = applyReview(details(), input([{ id: "m1", mark: "SANKOFA", mark_type: "word", filing_basis: "1a", first_use_date: "2024-01-02", classes: [{ class: 25, goods: "Hats" }] }]), reviewer, NOW);
    expect(r.marks[0]).toMatchObject({
      id: "m1",
      filing_basis: "1a",
      extracted_basis: "1b",
      basis_evidence: expect.stringContaining("launches in spring"),
      first_use_date: "2024-01-02",
      classes: [{ class: 25, goods: "Hats" }],
    });
  });

  it("adds a staff-entered mark with no model reading, and a fresh id", () => {
    const r = applyReview(
      details(),
      input([
        { id: "m1", mark: "SANKOFA", mark_type: "word", filing_basis: "1b", first_use_date: null, classes: [] },
        { id: null, mark: "KENTE", mark_type: "design", filing_basis: "unknown", first_use_date: null, classes: [] },
      ]),
      reviewer,
      NOW,
    );
    expect(r.marks[1]).toMatchObject({ id: "m2", mark: "KENTE", extracted_basis: null, basis_evidence: null, filing_basis: "unknown" });
  });

  it("treats a made-up or repeated id as a new mark instead of overwriting another", () => {
    const r = applyReview(
      details(),
      input([
        { id: "m1", mark: "A", mark_type: "word", filing_basis: "unknown", first_use_date: null, classes: [] },
        { id: "m1", mark: "B", mark_type: "word", filing_basis: "unknown", first_use_date: null, classes: [] },
        { id: "zzz", mark: "C", mark_type: "word", filing_basis: "unknown", first_use_date: null, classes: [] },
      ]),
      reviewer,
      NOW,
    );
    expect(r.marks.map((m) => [m.id, m.mark])).toEqual([
      ["m1", "A"],
      ["m2", "B"],
      ["m3", "C"],
    ]);
  });

  it("a mark left out of the submitted list is gone (removal is the form's explicit act)", () => {
    expect(applyReview(details(), input([]), reviewer, NOW).marks).toEqual([]);
  });

  it("reviewing a record entered by hand starts it at revision 1", () => {
    const r = applyReview(null, input([{ id: null, mark: "SANKOFA", mark_type: "word", filing_basis: "1a", first_use_date: null, classes: [] }]), reviewer, NOW);
    expect(r).toMatchObject({ rev: 1, extracted: null, marks: [{ id: "m1", extracted_basis: null }] });
  });
});

describe("matterFieldsFromDetails: what a reviewed consult may put on a matter", () => {
  const reviewed = (marks: Parameters<typeof applyReview>[1]["marks"]) => applyReview(null, { marks, recommended_package: null, discount_discussed: null }, reviewer, NOW);
  const m = (over: Partial<Parameters<typeof applyReview>[1]["marks"][number]> = {}) => ({
    id: null,
    mark: "SANKOFA",
    mark_type: "word" as const,
    filing_basis: "1b" as const,
    first_use_date: "2024-01-02" as string | null,
    classes: [
      { class: 35, goods: "Online retail store services" },
      { class: 25, goods: "Clothing, namely t-shirts" },
    ],
    ...over,
  });

  it("carries nothing at all from a record nobody reviewed", () => {
    const unreviewed = details();
    expect(matterFieldsFromDetails(unreviewed, null)).toEqual({ fields: {}, carried: [], skipped: "not_reviewed" });
    expect(matterFieldsFromDetails(null, "SANKOFA")).toEqual({ fields: {}, carried: [], skipped: "no_details" });
  });

  it("carries the mark, basis, sorted classes and goods when no mark was known", () => {
    expect(matterFieldsFromDetails(reviewed([m()]), null)).toEqual({
      fields: {
        markText: "SANKOFA",
        filingBasis: "1b",
        internationalClasses: [25, 35],
        goodsServices: "Class 35: Online retail store services\nClass 25: Clothing, namely t-shirts",
      },
      carried: ["mark_text", "filing_basis", "international_classes", "goods_services"],
      skipped: null,
    });
  });

  it("leaves the mark text to the matter when a mark was already known, matching loosely", () => {
    const r = matterFieldsFromDetails(reviewed([m({ mark: "Sankofa™" })]), "SANKOFA");
    expect(r.fields.markText).toBeUndefined();
    expect(r.fields.filingBasis).toBe("1b");
    expect(r.carried).not.toContain("mark_text");
  });

  it("never carries an unknown basis as if it were an answer", () => {
    const r = matterFieldsFromDetails(reviewed([m({ filing_basis: "unknown" })]), null);
    expect(r.fields.filingBasis).toBeUndefined();
    expect(r.carried).not.toContain("filing_basis");
    expect(r.carried).toContain("international_classes");
  });

  it("does not carry the first-use date: crm_matter has no column for it", () => {
    expect(JSON.stringify(matterFieldsFromDetails(reviewed([m()]), null))).not.toContain("2024-01-02");
  });

  it("doesn't attach a basis to a different mark than the one being filed", () => {
    expect(matterFieldsFromDetails(reviewed([m()]), "KENTE")).toEqual({ fields: {}, carried: [], skipped: "mark_mismatch" });
  });

  it("with several marks and none known, carries nothing: staff choose", () => {
    expect(matterFieldsFromDetails(reviewed([m(), m({ mark: "KENTE" })]), null)).toEqual({ fields: {}, carried: [], skipped: "ambiguous_marks" });
  });

  it("with several marks, takes the one the matter is for", () => {
    const r = matterFieldsFromDetails(reviewed([m(), m({ mark: "KENTE", filing_basis: "1a", classes: [{ class: 9, goods: "Apps" }] })]), "kente");
    expect(r.fields).toMatchObject({ filingBasis: "1a", internationalClasses: [9], goodsServices: "Class 9: Apps" });
  });

  it("prefers the word mark when a name has both a word and a design version, and refuses two of a kind", () => {
    const both = reviewed([m({ mark_type: "design", filing_basis: "1a" }), m({ mark_type: "word", filing_basis: "1b" })]);
    expect(matterFieldsFromDetails(both, "SANKOFA").fields.filingBasis).toBe("1b");
    const twoDesigns = reviewed([m({ mark_type: "design" }), m({ mark_type: "design", filing_basis: "1a" })]);
    expect(matterFieldsFromDetails(twoDesigns, "SANKOFA").skipped).toBe("ambiguous_marks");
  });

  it("reports a reviewed consult with no marks, and drops goods with no class number from the class list", () => {
    expect(matterFieldsFromDetails(reviewed([]), null).skipped).toBe("no_marks");
    const r = matterFieldsFromDetails(reviewed([m({ classes: [{ class: null, goods: "Mugs" }] })]), null);
    expect(r.fields.internationalClasses).toBeUndefined();
    expect(r.fields.goodsServices).toBe("Mugs");
  });
});
