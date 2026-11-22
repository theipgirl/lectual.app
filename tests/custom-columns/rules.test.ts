import { describe, expect, it } from "vitest";
import { cellFor, customCells, fieldsForSection, firmColumnsFor, formatValue, optionsValid, parseField, parseValue, valueFor } from "@/lib/custom-columns/rules";
import { BLANK, COL_COULDNT_LOAD, CUSTOM_FROM_LEAD, CUSTOM_FROM_MERGED, CUSTOM_NO_LONGER_ON_TEAM } from "@/lib/ui/words";
import { formatCents } from "@/lib/quotes/money";
import { shortDate } from "@/lib/review/format";
import { BOTH, F_PRIORITY, FEE, NOTE, PERSON, PRIORITY, SIGNED, data, field, value } from "./fixtures";

const TODAY = "2026-11-02";
const TM = { kind: "matter" as const, id: "m-tm", matterType: "TM" };
const BL = { kind: "matter" as const, id: "m-bl", matterType: "BL" };
const LEAD = { kind: "lead" as const, id: "l-1", matterType: null };
const members = [{ userId: "u-1", name: "Rebecca Ames" }];

describe("parseField", () => {
  const ok = { id: F_PRIORITY, section: "trademarks", label: "Priority", kind: "choice", options: ["High", "Low"], position: 0 };
  it("accepts the five kinds", () => {
    expect(parseField(ok)).toEqual({ ...ok });
    for (const kind of ["text", "date", "money", "person"]) expect(parseField({ ...ok, kind, options: [] })?.kind).toBe(kind);
  });
  it("rejects a bad kind, section, label or position", () => {
    for (const bad of [
      { kind: "number" },
      { section: "everything" },
      { label: "" },
      { label: " Priority" },
      { label: "x".repeat(61) },
      { position: 1001 },
      { position: -1 },
      { position: 1.5 },
      { id: "not-a-uuid" },
    ])
      expect(parseField({ ...ok, ...bad }), JSON.stringify(bad)).toBeNull();
    expect(parseField(null)).toBeNull();
    expect(parseField("x")).toBeNull();
  });
  it("a choice needs 1 to 30 distinct (ignoring case) trimmed options of at most 40; another kind none", () => {
    expect(parseField({ ...ok, options: [] })).toBeNull();
    expect(parseField({ ...ok, options: Array.from({ length: 31 }, (_, i) => `o${i}`) })).toBeNull();
    expect(parseField({ ...ok, options: Array.from({ length: 30 }, (_, i) => `o${i}`) })).not.toBeNull();
    expect(parseField({ ...ok, options: ["High", "high"] })).toBeNull();
    expect(parseField({ ...ok, options: ["x".repeat(41)] })).toBeNull();
    expect(parseField({ ...ok, options: [" High"] })).toBeNull();
    expect(parseField({ ...ok, options: [3] })).toBeNull();
    expect(parseField({ ...ok, kind: "text", options: ["High"] })).toBeNull();
    expect(parseField({ ...ok, kind: "text", options: {} })).toBeNull();
    expect(optionsValid("choice", "High")).toBe(false);
  });
});

describe("parseValue", () => {
  const ids = new Set([F_PRIORITY]);
  const ok = { id: "v1", field_id: F_PRIORITY, lead_id: "l-1", matter_id: null, value_text: null, value_date: null, value_cents: null, value_choice: "High", value_user_id: null, updated_at: "2026-11-01T00:00:00Z" };
  it("keeps a well-formed row", () => {
    expect(parseValue(ok, ids)).toMatchObject({ id: "v1", fieldId: F_PRIORITY, leadId: "l-1", matterId: null, choice: "High" });
  });
  it("drops both records, no record, two typed values, none, an unknown field and a bad date", () => {
    expect(parseValue({ ...ok, matter_id: "m-1" }, ids)).toBeNull();
    expect(parseValue({ ...ok, lead_id: null }, ids)).toBeNull();
    expect(parseValue({ ...ok, value_text: "x" }, ids)).toBeNull();
    expect(parseValue({ ...ok, value_choice: null }, ids)).toBeNull();
    expect(parseValue({ ...ok, field_id: "00000000-0000-4000-8000-000000000999" }, ids)).toBeNull();
    expect(parseValue({ ...ok, value_choice: null, value_date: "Nov 1" }, ids)).toBeNull();
    expect(parseValue({ ...ok, value_choice: null, value_cents: -5 }, ids)).toBeNull();
    expect(parseValue(null, ids)).toBeNull();
  });
});

describe("fieldsForSection", () => {
  it("puts a both field in each section, ordered position, label, id", () => {
    const a = field({ id: "00000000-0000-4000-8000-0000000000a2", label: "B", position: 1 });
    const b = field({ id: "00000000-0000-4000-8000-0000000000a1", label: "B", position: 1 });
    const c = field({ id: "00000000-0000-4000-8000-0000000000a3", label: "A", position: 1 });
    const d = field({ id: "00000000-0000-4000-8000-0000000000a4", label: "Z", position: 0, section: "both" });
    expect(fieldsForSection([a, b, c, d, SIGNED], "trademarks").map((f) => f.id)).toEqual([d.id, c.id, b.id, a.id]);
    expect(fieldsForSection([a, b, c, d, SIGNED], "contracts").map((f) => f.id)).toEqual([d.id, SIGNED.id]);
  });
});

describe("valueFor", () => {
  it("a record's own value wins", () => {
    const own = value({ fieldId: PRIORITY.id, matterId: "m-tm", choice: "High" });
    const lead = value({ fieldId: PRIORITY.id, leadId: "l-9", choice: "Low" });
    const d = data({ values: [own, lead], leadOfMatter: { "m-tm": "l-9" } });
    expect(valueFor(TM, PRIORITY, d)).toEqual({ state: "value", value: own });
  });
  it("a Trademarks matter with nothing of its own shows its lead's value, marked from the lead", () => {
    const lead = value({ fieldId: PRIORITY.id, leadId: "l-9", choice: "Low" });
    expect(valueFor(TM, PRIORITY, data({ values: [lead], leadOfMatter: { "m-tm": "l-9" } }))).toEqual({ state: "value", value: lead, fromLead: true });
  });
  it("matter -> its lead's merged child only when the lead has none", () => {
    const child = value({ fieldId: PRIORITY.id, leadId: "l-dup", choice: "High" });
    const lead = value({ fieldId: PRIORITY.id, leadId: "l-9", choice: "Low" });
    const base = { leadOfMatter: { "m-tm": "l-9" }, mergedInto: { "l-dup": "l-9" } };
    expect(valueFor(TM, PRIORITY, data({ ...base, values: [child] }))).toEqual({ state: "value", value: child, fromMerged: true });
    expect(valueFor(TM, PRIORITY, data({ ...base, values: [child, lead] }))).toEqual({ state: "value", value: lead, fromLead: true });
  });
  it("a lead shows a merged duplicate's value when it has none: the newest updated_at wins, then the larger id", () => {
    const older = value({ fieldId: NOTE.id, leadId: "l-a", text: "older", updatedAt: "2026-10-01T00:00:00Z" });
    const newer = value({ fieldId: NOTE.id, leadId: "l-b", text: "newer", updatedAt: "2026-10-05T00:00:00Z" });
    const merged = { "l-a": "l-1", "l-b": "l-1" };
    expect(valueFor(LEAD, NOTE, data({ values: [older, newer], mergedInto: merged }))).toEqual({ state: "value", value: newer, fromMerged: true });
    const tieA = { ...older, id: "va", updatedAt: "2026-10-05T00:00:00Z" };
    const tieB = { ...newer, id: "vb" };
    const tie = valueFor(LEAD, NOTE, data({ values: [tieA, tieB], mergedInto: merged }));
    expect(tie.state === "value" ? tie.value.id : null).toBe("vb");
    const own = value({ fieldId: NOTE.id, leadId: "l-1", text: "own" });
    expect(valueFor(LEAD, NOTE, data({ values: [older, own], mergedInto: merged }))).toEqual({ state: "value", value: own });
  });
  it("a Contracts matter never borrows, a both field included", () => {
    const lead = value({ fieldId: BOTH.id, leadId: "l-9", text: "from lead" });
    const d = data({ values: [lead], leadOfMatter: { "m-bl": "l-9" } });
    expect(valueFor(BL, BOTH, d)).toEqual({ state: "none" });
    const own = value({ fieldId: BOTH.id, matterId: "m-bl", text: "mine" });
    expect(valueFor(BL, BOTH, data({ values: [lead, own], leadOfMatter: { "m-bl": "l-9" } }))).toEqual({ state: "value", value: own });
  });
  it("a field of the other section shows nothing even when a value is stored (A11)", () => {
    const tmOnBl = value({ fieldId: PRIORITY.id, matterId: "m-bl", choice: "High" });
    const ctOnTm = value({ fieldId: SIGNED.id, matterId: "m-tm", date: "2026-10-01" });
    const d = data({ values: [tmOnBl, ctOnTm] });
    expect(valueFor(BL, PRIORITY, d)).toEqual({ state: "none" });
    expect(valueFor(TM, SIGNED, d)).toEqual({ state: "none" });
    expect(valueFor(LEAD, SIGNED, d)).toEqual({ state: "none" });
  });
  it("nothing recorded is none", () => {
    expect(valueFor(TM, PRIORITY, data())).toEqual({ state: "none" });
    expect(valueFor({ kind: "matter", id: "m-x", matterType: null }, PRIORITY, data())).toEqual({ state: "none" });
  });
});

describe("formatValue", () => {
  it("money via formatCents, 125000 and 0", () => {
    expect(formatValue(FEE, value({ fieldId: FEE.id, cents: 125000 }), members, TODAY)).toEqual({ text: formatCents(125000), tone: "value" });
    expect(formatValue(FEE, value({ fieldId: FEE.id, cents: 125000 }), members, TODAY).text).toBe("$1,250.00");
    expect(formatValue(FEE, value({ fieldId: FEE.id, cents: 0 }), members, TODAY).text).toBe("$0.00");
  });
  it("a date via shortDate", () => {
    expect(formatValue(SIGNED, value({ fieldId: SIGNED.id, date: "2026-10-30" }), members, TODAY)).toEqual({ text: shortDate("2026-10-30", TODAY), tone: "value" });
  });
  it("a person by the directory; an id it doesn't hold is someone no longer on the team; an unreadable directory says Couldn't load", () => {
    const v = value({ fieldId: PERSON.id, userId: "u-1" });
    expect(formatValue(PERSON, v, members, TODAY)).toEqual({ text: "Rebecca Ames", tone: "value" });
    const gone = value({ fieldId: PERSON.id, userId: "u-gone" });
    expect(formatValue(PERSON, gone, members, TODAY)).toEqual({ text: CUSTOM_NO_LONGER_ON_TEAM, tone: "value" });
    for (const x of [v, gone]) {
      const cell = formatValue(PERSON, x, null, TODAY);
      expect(cell).toEqual({ text: COL_COULDNT_LOAD, tone: "failed" });
      expect(cell.text).not.toBe(CUSTOM_NO_LONGER_ON_TEAM);
    }
  });
  it("a choice not in the options shows verbatim; text stays text; a long text is cut", () => {
    expect(formatValue(PRIORITY, value({ fieldId: PRIORITY.id, choice: "Urgent (old)" }), members, TODAY).text).toBe("Urgent (old)");
    expect(formatValue(NOTE, value({ fieldId: NOTE.id, text: "<b>bold</b>" }), members, TODAY).text).toBe("<b>bold</b>");
    const long = formatValue(NOTE, value({ fieldId: NOTE.id, text: "x".repeat(600) }), members, TODAY).text;
    expect(long.length).toBe(501);
    expect(long.endsWith("…")).toBe(true);
  });
  it("no value is a dash", () => {
    expect(formatValue(NOTE, null, members, TODAY)).toEqual({ text: BLANK, tone: "none" });
  });
});

describe("cells and the card", () => {
  const lead = value({ fieldId: PRIORITY.id, leadId: "l-9", choice: "High" });
  const child = value({ fieldId: NOTE.id, leadId: "l-dup", text: "From before" });
  const d = data({ values: [lead, child], leadOfMatter: { "m-tm": "l-9" }, mergedInto: { "l-dup": "l-1" } });

  it("cellFor puts the quiet title on a borrowed value", () => {
    expect(cellFor(TM, PRIORITY, d, members, TODAY)).toEqual({ text: "High", tone: "value", title: CUSTOM_FROM_LEAD });
    expect(cellFor(LEAD, NOTE, d, members, TODAY)).toEqual({ text: "From before", tone: "value", title: CUSTOM_FROM_MERGED });
  });

  it("customCells fills only the row's own section, by row key then cf:<id>", () => {
    const cells = customCells([{ ...TM, key: "a" }, { ...BL, key: "b" }], d.fields, d, members, TODAY);
    expect(Object.keys(cells.a)).toEqual([PRIORITY, BOTH, FEE, PERSON, NOTE].map((f) => `cf:${f.id}`));
    expect(Object.keys(cells.b)).toEqual([SIGNED, BOTH].map((f) => `cf:${f.id}`));
    expect(cells.b[`cf:${SIGNED.id}`]).toEqual({ text: BLANK, tone: "none" });
  });

  it("firmColumnsFor lists the record's section's fields in order, with their cells", () => {
    expect(firmColumnsFor(TM, d, members, TODAY).map((i) => i.label)).toEqual(["Priority", "Next review", "Quoted fee", "Reviewer", "Note"]);
    expect(firmColumnsFor(BL, d, members, TODAY).map((i) => i.label)).toEqual(["Signed on", "Next review"]);
    expect(firmColumnsFor(TM, d, null, TODAY)[0].cell.title).toBe(CUSTOM_FROM_LEAD);
  });
});
