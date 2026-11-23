import { describe, expect, it } from "vitest";
import { cleanText, cutCodePoints, pgBtrim, pgCharLength, sqlLabelOk, sqlOptionsOk } from "@/lib/custom-columns/text";
import { parseChoicesInput, parseLabelInput } from "@/lib/custom-columns/input";
import { customCells, firmColumnsBlock, parseField } from "@/lib/custom-columns/rules";
import { parseSettingsField } from "@/lib/custom-columns/settings-load";
import { columnsFor, customColumnId } from "@/lib/review/sheet-columns";
import { choiceRepeated } from "@/lib/ui/words";

/**
 * F14 (CO1): the read side agrees with 0115's label and option CHECKs, both ways. Every row's `db` verdict is HAND-WRITTEN from the SQL
 * (`char_length(label) between 1 and 60`, `label = btrim(label)`, `crm_custom_field_options_valid`; `btrim` with its default characters
 * strips only U+0020; `char_length` counts code points). The code never computes it. Characters are built from code points so no editor
 * or tool can silently change them.
 */

const cp = (...n: number[]) => String.fromCodePoint(...n);
const NBSP = cp(0xa0);
const IDEO = cp(0x3000);
const ZWSP = cp(0x200b);
const GRIN = cp(0x1f600);
const THUMB_TONE = cp(0x1f44d, 0x1f3fd);
const ID = "00000000-0000-4000-8000-00000000f0a1";

type LabelRow = { name: string; x: string; db: boolean };
const LABELS: LabelRow[] = [
  { name: "Priority", x: "Priority", db: true },
  { name: "a trailing tab", x: "Priority\t", db: true },
  { name: "a leading NBSP", x: `${NBSP}Priority`, db: true },
  { name: "a trailing NBSP", x: `Priority${NBSP}`, db: true },
  { name: "a leading U+0020", x: " Priority", db: false },
  { name: "a trailing U+0020", x: "Priority ", db: false },
  { name: "a leading ideographic space", x: `${IDEO}Priority`, db: true },
  { name: "40 emoji", x: GRIN.repeat(40), db: true },
  { name: "31 thumbs with a skin tone, 62 code points", x: THUMB_TONE.repeat(31), db: false },
  { name: "10 emoji + 50 a, 60 code points", x: GRIN.repeat(10) + "a".repeat(50), db: true },
  { name: "10 emoji + 51 a, 61 code points", x: GRIN.repeat(10) + "a".repeat(51), db: false },
  { name: "a combining mark (Cafe + U+0301)", x: `Cafe${cp(0x301)}`, db: true },
  { name: "empty", x: "", db: false },
  { name: "a leading zero-width space", x: `${ZWSP}Priority`, db: true },
];

type OptionRow = { name: string; kind: "choice" | "text"; xs: string[]; db: boolean; readOnlyNote?: string };
const OPTIONS: OptionRow[] = [
  { name: "High, Medium", kind: "choice", xs: ["High", "Medium"], db: true },
  { name: "a trailing tab", kind: "choice", xs: ["High\t"], db: true },
  { name: "a trailing NBSP", kind: "choice", xs: [`High${NBSP}`], db: true },
  { name: "a trailing U+0020", kind: "choice", xs: ["High "], db: false },
  { name: "none", kind: "choice", xs: [], db: false },
  { name: "31 options", kind: "choice", xs: Array.from({ length: 31 }, (_, i) => `o${i}`), db: false },
  { name: "one of 41 code points", kind: "choice", xs: ["x".repeat(41)], db: false },
  { name: "High and high", kind: "choice", xs: ["High", "high"], db: false, readOnlyNote: "write side only" },
  { name: "a text kind with []", kind: "text", xs: [], db: true },
  { name: "a text kind with [x]", kind: "text", xs: ["x"], db: false },
];

describe("F14: the table has 24 rows, each with its hand-written verdict", () => {
  it("24 rows", () => {
    expect(LABELS.length + OPTIONS.length).toBe(24);
  });
  it("the mirrors agree with each hand-written verdict", () => {
    for (const r of LABELS) expect(sqlLabelOk(r.x), `label: ${r.name}`).toBe(r.db);
    for (const r of OPTIONS) expect(sqlOptionsOk(r.kind, r.xs), `options: ${r.name}`).toBe(r.db);
  });
  it("the code-point counts the verdicts rest on", () => {
    expect(pgCharLength(GRIN.repeat(40))).toBe(40);
    expect(pgCharLength(THUMB_TONE.repeat(31))).toBe(62);
    expect(pgCharLength(GRIN.repeat(10) + "a".repeat(50))).toBe(60);
    expect(pgCharLength(`Cafe${cp(0x301)}`)).toBe(5);
    expect(pgBtrim(`${NBSP}x\t `)).toBe(`${NBSP}x\t`);
    expect(pgBtrim("  x  ")).toBe("x");
  });
});

describe("F14 labels, both ways", () => {
  const raw = (label: string) => ({ id: ID, section: "trademarks", label, kind: "text", options: [], position: 0 });
  for (const r of LABELS) {
    it(`${r.name} (db ${r.db})`, () => {
      // 1. what the database stores, the app keeps and draws
      if (r.db) expect(parseField(raw(r.x))?.label).toBe(r.x);
      else expect(parseField(raw(r.x))).toBeNull();
      // 2. whatever the write side sends passes the CHECKs
      const w = parseLabelInput(r.x);
      if (w.ok) expect(sqlLabelOk(w.value)).toBe(true);
      // 3. what the database refuses, the write side refuses or cleans into something it accepts
      if (!r.db) expect(!w.ok || sqlLabelOk(w.value)).toBe(true);
    });
  }
  it("a leading U+0020 is refused by the read mirror and cleaned by the write side; 61 code points are refused by both", () => {
    expect(parseField(raw(" Priority"))).toBeNull();
    expect(parseLabelInput(" Priority")).toEqual({ ok: true, value: "Priority" });
    const long = GRIN.repeat(10) + "a".repeat(51);
    expect(parseField(raw(long))).toBeNull();
    expect(parseLabelInput(long).ok).toBe(false);
  });
});

describe("F14 options, both ways", () => {
  for (const r of OPTIONS) {
    it(`${r.name} (db ${r.db}${r.readOnlyNote ? `, ${r.readOnlyNote}` : ""})`, () => {
      const field = { id: ID, section: "trademarks", label: "Priority", kind: r.kind, options: r.xs, position: 0 };
      if (r.db) expect(parseField(field)?.options).toEqual(r.xs);
      if (r.kind === "choice") {
        const w = parseChoicesInput(r.xs.join("\n"));
        if (w.ok) expect(sqlOptionsOk("choice", w.value)).toBe(true);
        if (!r.db) expect(!w.ok || sqlOptionsOk("choice", w.value)).toBe(true);
      } else {
        // A non-choice column always sends [] (the write side never posts choices for it).
        expect(sqlOptionsOk(r.kind, [])).toBe(true);
      }
    });
  }
  it("High and high: the write side refuses with its own sentence (the read side doesn't re-judge distinctness)", () => {
    expect(parseChoicesInput("High\nhigh")).toEqual({ ok: false, error: choiceRepeated("high") });
  });
});

describe("F14: a database-valid label and option are drawn on the List, in the chooser, on the card and in Settings", () => {
  const label = `Priority\t`;
  const option = `High${NBSP}`;
  const rawField = { id: ID, section: "trademarks", label, kind: "choice", options: [option, "Low"], position: 0 };
  const f = parseField(rawField)!;
  it("List and chooser: columnsFor carries it", () => {
    expect(columnsFor("trademarks", { canSeeMoney: false, hasNotes: false, customFields: [f] }).at(-1)).toMatchObject({ id: customColumnId(ID), header: label });
  });
  it("cells and card: the stored choice is drawn", () => {
    const data = { fields: [f], values: [{ id: "v1", fieldId: ID, leadId: "l1", matterId: null, text: null, date: null, cents: null, choice: option, userId: null, updatedAt: "2026-11-01T00:00:00Z" }], mergedInto: {}, leadOfMatter: {} };
    expect(customCells([{ key: "l1", kind: "lead", id: "l1", matterType: null }], [f], data, [], "2026-11-02").l1[customColumnId(ID)]).toEqual({ text: option, tone: "value" });
    const block = firmColumnsBlock({ status: "ok", ...data }, { kind: "lead", id: "l1", matterType: null }, [], "2026-11-02");
    expect(block).toMatchObject({ status: "ok", items: [{ label, cell: { text: option } }] });
  });
  it("Settings: the row is kept", () => {
    expect(parseSettingsField({ ...rawField, archived: false, updated_at: "2026-11-01T00:00:00.123456+00:00" })).toMatchObject({ label, options: [option, "Low"] });
  });
});

describe("the write cleaners and display cuts", () => {
  it("space-like and control characters become one space; ends go; a zero-width space is kept", () => {
    expect(cleanText(`\tHigh${NBSP}${NBSP} mid\u0007 end${IDEO}`)).toBe("High mid end");
    expect(cleanText(`${ZWSP}x`)).toBe(`${ZWSP}x`);
    expect(cleanText(`a${cp(0x2028)}b${cp(0xfeff)}`)).toBe("a b");
  });
  it("a display cut never splits a surrogate pair", () => {
    expect(cutCodePoints(GRIN.repeat(3), 2)).toBe(GRIN.repeat(2));
    expect(cutCodePoints("abc", 5)).toBe("abc");
  });
});
