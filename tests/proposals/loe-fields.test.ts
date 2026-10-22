import { describe, it, expect } from "vitest";
import { LOE_FIELDS_KEY, fieldWrites, isFieldId, parseLoeFieldsForm, readLoeFieldsConfig, withLoeFields } from "@/lib/proposals/loe-fields";
import { LOE_FIELD_NAMES } from "@/lib/proposals/loe-adapter";
import { withPackages } from "@/lib/proposals/package-list";
import { parseSettingsPricing } from "@/lib/proposal-editor/form";
import { CONCIERGE } from "./accepted-fixture";

/**
 * The firm's "LOE fields" setting (Sprint 19, stretch): OFF unless a firm saved it ON, stored
 * under `client_proposal_setting.pricing.lawmatics_loe_fields`, and untouched by every other
 * save of that row.
 */

const form = (entries: Array<[string, string]>) => {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
};

describe("readLoeFieldsConfig: off by default and total", () => {
  it.each([
    ["no pricing at all", undefined],
    ["null", null],
    ["a string", "pricing"],
    ["an array", []],
    ["pricing with no key", { packages: [CONCIERGE] }],
    ["a key that is not an object", { [LOE_FIELDS_KEY]: true }],
    ["a key that is a list", { [LOE_FIELDS_KEY]: [1, 2] }],
  ])("%s is off with nothing mapped", (_n, pricing) => {
    expect(readLoeFieldsConfig(pricing)).toEqual({ enabled: false, map: {} });
  });

  it("only a literal true switches it on", () => {
    for (const enabled of ["true", 1, "on", null, undefined]) expect(readLoeFieldsConfig({ [LOE_FIELDS_KEY]: { enabled, map: { "LOE Package": "1" } } }).enabled).toBe(false);
    expect(readLoeFieldsConfig({ [LOE_FIELDS_KEY]: { enabled: true, map: {} } }).enabled).toBe(true);
  });

  it("keeps the six known names with a plausible id (a number becomes text) and drops everything else", () => {
    const cfg = readLoeFieldsConfig({
      [LOE_FIELDS_KEY]: { enabled: true, map: { "LOE Package": "301", "LOE Fee Chart": 302, "LOE Classes": "has space", "LOE Legal Fee": "", "Nonsense": "9", "LOE USPTO Fees": "x".repeat(41), "LOE Signature Deadline": "a/b" } },
    });
    expect(cfg.map).toEqual({ "LOE Package": "301", "LOE Fee Chart": "302" });
  });

  it("isFieldId accepts short ids only", () => {
    for (const ok of ["1", "abc_DEF-9", "x".repeat(40)]) expect(isFieldId(ok)).toBe(true);
    for (const bad of ["", " ", "a b", "a/b", "x".repeat(41), 5, null]) expect(isFieldId(bad)).toBe(false);
  });
});

describe("the setting survives every other save of the same row", () => {
  const stored = withLoeFields({ includes: [{ label: "a", included: "b" }], office_action_note: "n" }, { enabled: true, map: { "LOE Package": "301" } });

  it("withLoeFields keeps every other key and writes enabled + map", () => {
    expect(stored).toMatchObject({ includes: [{ label: "a", included: "b" }], office_action_note: "n", [LOE_FIELDS_KEY]: { enabled: true, map: { "LOE Package": "301" } } });
  });

  it("saving the package list keeps it", () => {
    expect(withPackages(stored, [CONCIERGE])[LOE_FIELDS_KEY]).toEqual({ enabled: true, map: { "LOE Package": "301" } });
  });

  it("saving the main settings form (includes + note) keeps it", () => {
    const r = parseSettingsPricing(form([["officeActionNote", "New note"]]), stored);
    expect(r.ok && r.value).toMatchObject({ office_action_note: "New note", [LOE_FIELDS_KEY]: { enabled: true, map: { "LOE Package": "301" } } });
  });

  it("saving it keeps the package list", () => {
    const withList = withPackages({}, [CONCIERGE]);
    expect(withLoeFields(withList, { enabled: false, map: {} }).packages).toEqual([CONCIERGE]);
  });
});

describe("parseLoeFieldsForm", () => {
  it("reads the checkbox and one id per name, blank meaning 'not matched'", () => {
    const r = parseLoeFieldsForm(form([["enabled", "on"], ["map.LOE Package", "301"], ["map.LOE Fee Chart", ""], ["map.LOE Legal Fee", " 304 "]]));
    expect(r).toEqual({ ok: true, value: { enabled: true, map: { "LOE Package": "301", "LOE Legal Fee": "304" } } });
  });

  it("an unticked box is off", () => {
    expect(parseLoeFieldsForm(form([["map.LOE Package", "301"]]))).toEqual({ ok: true, value: { enabled: false, map: { "LOE Package": "301" } } });
    expect(parseLoeFieldsForm(form([]))).toEqual({ ok: true, value: { enabled: false, map: {} } });
  });

  it("refuses an id that is not a Lawmatics field id, naming the field", () => {
    const r = parseLoeFieldsForm(form([["map.LOE Classes", "../../prospects"]]));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("LOE Classes");
  });

  it("ignores names it does not know", () => {
    expect(parseLoeFieldsForm(form([["map.Something Else", "9"]]))).toEqual({ ok: true, value: { enabled: false, map: {} } });
  });
});

describe("fieldWrites", () => {
  const values = Object.fromEntries(LOE_FIELD_NAMES.map((n) => [n, `value of ${n}`])) as Record<(typeof LOE_FIELD_NAMES)[number], string>;

  it("writes exactly the mapped names, in display order, and names the rest as unmapped", () => {
    const r = fieldWrites({ enabled: true, map: { "LOE USPTO Fees": "305", "LOE Package": "301" } }, values);
    expect(r.writes).toEqual([{ id: "301", value: "value of LOE Package" }, { id: "305", value: "value of LOE USPTO Fees" }]);
    expect(r.unmapped).toEqual(["LOE Fee Chart", "LOE Classes", "LOE Legal Fee", "LOE Signature Deadline"]);
  });

  it("nothing mapped writes nothing", () => {
    expect(fieldWrites({ enabled: true, map: {} }, values).writes).toEqual([]);
  });

  it("the six names are exactly the ones the spec lists", () => {
    expect([...LOE_FIELD_NAMES]).toEqual(["LOE Package", "LOE Fee Chart", "LOE Classes", "LOE Legal Fee", "LOE USPTO Fees", "LOE Signature Deadline"]);
  });
});
