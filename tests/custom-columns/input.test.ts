import { describe, expect, it } from "vitest";
import {
  customUnchanged,
  editorForm,
  parseChoiceValue,
  parseChoicesInput,
  parseDateValue,
  parseKindInput,
  parseLabelInput,
  parsePersonValue,
  parseSectionInput,
  parseTextValue,
} from "@/lib/custom-columns/input";
import * as W from "@/lib/ui/words";

const cp = (...n: number[]) => String.fromCodePoint(...n);
const PERSON = "00000000-0000-4000-8000-0000000000a1";

describe("dates (R19)", () => {
  for (const x of ["2028-02-29", "0001-01-01", "9999-12-31", " 2026-11-02 "]) it(`accepts ${x}`, () => expect(parseDateValue(x)).toEqual({ ok: true, value: x.trim() }));
  for (const x of ["2026-02-30", "0000-01-01", "2026-1-5", "2026-13-01", "2026-00-10", "2026-04-31", "2027-02-29", "1900-02-29", "26-01-01", "2026/01/01", "x"])
    it(`refuses ${x}`, () => expect(parseDateValue(x)).toEqual({ ok: false, error: W.CUSTOM_DATE_BAD }));
  it("2000-02-29 is a leap day", () => expect(parseDateValue("2000-02-29").ok).toBe(true));
  it("blank is a clear", () => expect(parseDateValue("")).toEqual({ ok: true, value: null }));
});

describe("text by code points", () => {
  it("500 code points fit, 501 don't; emoji count once", () => {
    expect(parseTextValue("a".repeat(500)).ok).toBe(true);
    expect(parseTextValue("a".repeat(501))).toEqual({ ok: false, error: W.CUSTOM_TEXT_TOO_LONG });
    expect(parseTextValue(cp(0x1f600).repeat(500)).ok).toBe(true);
    expect(parseTextValue(cp(0x1f600).repeat(501)).ok).toBe(false);
  });
  it("is cleaned; blank is a clear", () => {
    expect(parseTextValue(`  Met\tat the ${cp(0xa0)}expo `)).toEqual({ ok: true, value: "Met at the expo" });
    expect(parseTextValue(" \t ")).toEqual({ ok: true, value: null });
  });
});

describe("choices (N2: exact; trimming only decides blank)", () => {
  const options = ["High\t", "Low"];
  it("a stored option with a tab can be picked exactly", () => expect(parseChoiceValue("High\t", options)).toEqual({ ok: true, value: "High\t" }));
  it("a cleaned look-alike is not the option", () => expect(parseChoiceValue("High", options)).toEqual({ ok: false, error: W.CUSTOM_CHOICE_BAD }));
  it("blank is a clear", () => expect(parseChoiceValue("  ", options)).toEqual({ ok: true, value: null }));
});

describe("people", () => {
  it("a uuid, lower-cased; anything else is not a member", () => {
    expect(parsePersonValue(PERSON.toUpperCase())).toEqual({ ok: true, value: PERSON });
    expect(parsePersonValue("rebecca")).toEqual({ ok: false, error: W.CUSTOM_PERSON_NOT_MEMBER });
    expect(parsePersonValue("")).toEqual({ ok: true, value: null });
  });
});

describe("a column's label, section, kind and choices", () => {
  it("labels", () => {
    expect(parseLabelInput("  ")).toEqual({ ok: false, error: W.CUSTOM_LABEL_EMPTY });
    expect(parseLabelInput("x".repeat(61))).toEqual({ ok: false, error: W.CUSTOM_LABEL_TOO_LONG });
    expect(parseLabelInput(`\tQuoted${cp(0xa0)} fee `)).toEqual({ ok: true, value: "Quoted fee" });
    expect(parseLabelInput(null)).toEqual({ ok: false, error: W.CUSTOM_LABEL_EMPTY });
  });
  it("sections and kinds", () => {
    expect(parseSectionInput("both")).toEqual({ ok: true, value: "both" });
    expect(parseSectionInput("everything")).toEqual({ ok: false, error: W.CUSTOM_BAD_SECTION });
    expect(parseKindInput("money")).toEqual({ ok: true, value: "money" });
    expect(parseKindInput("number")).toEqual({ ok: false, error: W.CUSTOM_BAD_KIND });
  });
  it("choices: CRLF lines, blanks dropped, counts, lengths, repeats", () => {
    expect(parseChoicesInput("High\r\nMedium\r\n\r\nLow\r\n")).toEqual({ ok: true, value: ["High", "Medium", "Low"] });
    expect(parseChoicesInput("")).toEqual({ ok: false, error: W.CUSTOM_CHOICES_COUNT });
    expect(parseChoicesInput(Array.from({ length: 31 }, (_, i) => `o${i}`).join("\n"))).toEqual({ ok: false, error: W.CUSTOM_CHOICES_COUNT });
    expect(parseChoicesInput("x".repeat(41))).toEqual({ ok: false, error: W.CUSTOM_CHOICE_TOO_LONG });
    expect(parseChoicesInput("High\nhigh")).toEqual({ ok: false, error: W.choiceRepeated("high") });
  });
  it("N3: a line equal to an existing choice is kept verbatim; only new lines are cleaned", () => {
    expect(parseChoicesInput("High\t\r\nLow \r\n", ["High\t", "Low"])).toEqual({ ok: true, value: ["High\t", "Low"] });
    expect(parseChoicesInput(`High\t\nMedium${cp(0xa0)}`, ["High\t"])).toEqual({ ok: true, value: ["High\t", "Medium"] });
  });
});

describe("customUnchanged: an unchanged editor posts nothing", () => {
  it("compares with the record's OWN value, parsed by the kind", () => {
    expect(customUnchanged("money", "1,250", "1250.00")).toBe(true);
    expect(customUnchanged("money", "$1250", "1250.00")).toBe(true);
    expect(customUnchanged("money", "1251", "1250.00")).toBe(false);
    expect(customUnchanged("text", "  Met at the expo ", "Met at the expo")).toBe(true);
    expect(customUnchanged("date", "2026-11-02", "2026-11-02")).toBe(true);
    expect(customUnchanged("person", PERSON, PERSON)).toBe(true);
  });
  it("both blank is unchanged (an inherited cell left empty posts nothing)", () => {
    for (const kind of ["text", "date", "money", "choice", "person"] as const) expect(customUnchanged(kind, "", null, ["High"])).toBe(true);
  });
  it("re-picking a stale choice that is the own value posts nothing", () => {
    expect(customUnchanged("choice", "Urgent (old)", "Urgent (old)", ["High", "Low"])).toBe(true);
    expect(customUnchanged("choice", "High", "Urgent (old)", ["High", "Low"])).toBe(false);
  });
  it("an input that doesn't parse is never unchanged (the server answers it)", () => {
    expect(customUnchanged("money", "abc", null)).toBe(false);
    expect(customUnchanged("date", "2026-02-30", "2026-02-28")).toBe(false);
  });
  it("editorForm", () => {
    expect(editorForm("money", "$1,250.5", [])).toBe("1250.50");
    expect(editorForm("text", "  x ", [])).toBe("x");
    expect(editorForm("money", "", [])).toBeNull();
    expect(editorForm("money", "x", [])).toBeUndefined();
  });
});
