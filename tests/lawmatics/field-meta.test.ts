import { describe, expect, it, vi } from "vitest";
import { withoutBareIds, findField, isSelectType, parseFieldMeta, readFieldMeta, resolveValue, type FieldMeta, type FieldMetaRead } from "@/lib/lawmatics/field-meta";
import type { LawmaticsClient } from "@/lib/lawmatics/client";
import { customFieldPairs, readLawmaticsIntake, summariseProspect } from "@/lib/consult-prep/lawmatics-intake";

const REFERRAL: FieldMeta = { id: "42", name: "How did you hear about us?", type: "select", options: new Map([["589386", "Instagram"], ["878263", "A friend"]]) };
const MULTI: FieldMeta = { id: "43", name: "Services", type: "multi_select", options: new Map([["111", "Trademark"], ["222", "Copyright"]]) };
const TEXT: FieldMeta = { id: "44", name: "Date of first use", type: "text", options: new Map() };
const ok = (...fields: FieldMeta[]): FieldMetaRead => ({ state: "ok", index: { byId: new Map(fields.map((f) => [f.id, f])), byName: new Map(fields.map((f) => [f.name.toLowerCase(), f])) } });
const failed: FieldMetaRead = { state: "failed" };

describe("resolveValue: a picklist value prints as its label, never as an id", () => {
  it("1. formatted_value wins when it is words", () => {
    expect(resolveValue({ formatted: "Instagram", raw: "589386", meta: REFERRAL, labels: "ok" })).toBe("Instagram");
    expect(resolveValue({ formatted: "Instagram", raw: "589386", meta: undefined, labels: "failed" })).toBe("Instagram");
  });
  it("1. a formatted_value that is itself a bare id is not trusted: the option label is looked up instead", () => {
    expect(resolveValue({ formatted: "589386", raw: "589386", meta: REFERRAL, labels: "ok" })).toBe("Instagram");
  });
  it("2. the option label, for a single and for a multi select (comma-joined, in the order stored)", () => {
    expect(resolveValue({ formatted: null, raw: "878263", meta: REFERRAL, labels: "ok" })).toBe("A friend");
    expect(resolveValue({ formatted: null, raw: "222, 111", meta: MULTI, labels: "ok" })).toBe("Copyright, Trademark");
    expect(resolveValue({ formatted: null, raw: "111,999999", meta: MULTI, labels: "ok" })).toBe("Trademark"); // an option the list doesn't have is dropped, never printed
  });
  it("3. a bare number of 3+ digits on a select that has no such option is 'not recorded'", () => {
    expect(resolveValue({ formatted: null, raw: "700700", meta: REFERRAL, labels: "ok" })).toBeNull();
    expect(resolveValue({ formatted: null, raw: "700700", meta: { ...REFERRAL, options: new Map() }, labels: "ok" })).toBeNull(); // a select type with no options listed
  });
  it("3. a select with an unlisted SMALL number keeps it (it is not an id)", () => {
    expect(resolveValue({ formatted: null, raw: "5", meta: REFERRAL, labels: "ok" })).toBe("5");
  });
  it("4. otherwise the value: text, and a number on a field the list says is text", () => {
    expect(resolveValue({ formatted: null, raw: "Booth at UGW", meta: REFERRAL, labels: "ok" })).toBe("Booth at UGW");
    expect(resolveValue({ formatted: null, raw: "2021", meta: TEXT, labels: "ok" })).toBe("2021");
  });
  it("a failed field-list read prints no id: any 3+ digit number reads 'not recorded', words still print", () => {
    expect(resolveValue({ formatted: null, raw: "589386", meta: undefined, labels: "failed" })).toBeNull();
    expect(resolveValue({ formatted: null, raw: "589386, 878263", meta: undefined, labels: "failed" })).toBeNull();
    expect(resolveValue({ formatted: "589386", raw: "589386", meta: undefined, labels: "failed" })).toBeNull();
    expect(resolveValue({ formatted: null, raw: "Referral", meta: undefined, labels: "failed" })).toBe("Referral");
  });
  it("a field the (successful) list does not name, with a long number, is 'not recorded' too: the safe side of the doubt", () => {
    expect(resolveValue({ formatted: null, raw: "589386", meta: undefined, labels: "ok" })).toBeNull();
  });
  it("nothing at all is nothing (no pair)", () => {
    expect(resolveValue({ formatted: null, raw: null, meta: REFERRAL, labels: "ok" })).toBeNull();
    expect(resolveValue({ formatted: "  ", raw: " ", meta: REFERRAL, labels: "ok" })).toBeNull();
  });
  it("the type words that make a select", () => {
    for (const t of ["select", "multi_select", "picklist", "dropdown", "drop_down", "radio", "multiple_choice"]) expect(isSelectType(t), t).toBe(true);
    for (const t of ["text", "number", "date", "currency", ""]) expect(isSelectType(t), t).toBe(false);
  });
});

describe("parseFieldMeta tolerates the likely shapes", () => {
  const rec = (attributes: Record<string, unknown>, id = "1") => ({ id, type: "custom_fields", attributes });
  it("options under any of the likely keys, with id/value/key and name/label", () => {
    const idx = parseFieldMeta([
      rec({ name: "A", field_type: "select", options: [{ id: 10, name: "Ten" }] }, "1"),
      rec({ name: "B", field_type: "picklist", picklist_options: [{ value: 20, label: "Twenty" }] }, "2"),
      rec({ name: "C", type: "dropdown", values: [{ key: "30", name: "Thirty" }] }, "3"),
      rec({ name: "D", field_type: "radio", choices: { "40": "Forty" } }, "4"),
    ]);
    expect(idx.byId.get("1")?.options.get("10")).toBe("Ten");
    expect(idx.byId.get("2")?.options.get("20")).toBe("Twenty");
    expect(idx.byId.get("3")?.options.get("30")).toBe("Thirty");
    expect(idx.byId.get("4")?.options.get("40")).toBe("Forty");
    expect(idx.byId.get("3")?.type).toBe("dropdown");
    expect(idx.byName.get("a")?.id).toBe("1");
  });
  it("sideloaded options (relationships + included)", () => {
    const included = new Map([["custom_field_options:900", { id: "900", type: "custom_field_options", attributes: { name: "Nine hundred" } }]]);
    const idx = parseFieldMeta([{ id: "5", attributes: { name: "E", field_type: "select" }, relationships: { options: { data: [{ type: "custom_field_options", id: "900" }] } } }], included);
    expect(idx.byId.get("5")?.options.get("900")).toBe("Nine hundred");
  });
  it("a record with neither id nor name is skipped, and findField looks up by id then by name", () => {
    const idx = parseFieldMeta([{ attributes: {} }, rec({ name: "Goals" }, "7")]);
    expect(idx.byId.size).toBe(1);
    const lookup: FieldMetaRead = { state: "ok", index: idx };
    expect(findField(lookup, "7", null)?.name).toBe("Goals");
    expect(findField(lookup, null, " GOALS ")?.id).toBe("7");
    expect(findField(failed, "7", "Goals")).toBeUndefined();
    expect(findField(undefined, "7", "Goals")).toBeUndefined();
  });
});

describe("readFieldMeta: one read per client, and a failed read is its own answer", () => {
  const client = (listAll: LawmaticsClient["listAll"]): LawmaticsClient => ({ get: vi.fn(), listAll });
  const list = (records: unknown[], over: object = {}) => ({ records, included: new Map(), pagesFetched: 1, truncated: false, includeDropped: false, unrecognisedShape: false, ...over }) as never;
  it("reads /custom_fields once however many times it is asked", async () => {
    const listAll = vi.fn(async () => list([{ id: "1", attributes: { name: "A" } }]));
    const c = client(listAll as never);
    const [a, b] = await Promise.all([readFieldMeta(c), readFieldMeta(c)]);
    await readFieldMeta(c);
    expect(listAll).toHaveBeenCalledTimes(1);
    expect((listAll.mock.calls as unknown as Array<[string]>)[0][0]).toBe("/custom_fields");
    expect(a).toBe(b);
    expect(a.state).toBe("ok");
  });
  it("a throw, and a shape that is not a list, are 'failed' (never an empty list of fields)", async () => {
    expect((await readFieldMeta(client(async () => { throw new Error("planted-secret"); }))).state).toBe("failed");
    expect((await readFieldMeta(client(async () => list([], { unrecognisedShape: true })))).state).toBe("failed");
  });
});

describe("the brief's Lawmatics values go through the resolver", () => {
  const wrap = (attributes: Record<string, unknown>) => ({ data: { id: "p1", type: "prospects", attributes } });
  const cf = [{ custom_field_id: 42, value: 589386 }, { custom_field_id: 43, value: [111, 222] }, { custom_field_id: 44, value: "2021" }];
  const labels = ok(REFERRAL, MULTI, TEXT);

  it("an array of id-keyed values prints labels, joins a multi select, and keeps a text field's number", () => {
    const names = new Map([["42", REFERRAL.name], ["43", MULTI.name], ["44", TEXT.name]]);
    expect(customFieldPairs(wrap({ custom_field_values: cf }), names, labels)).toEqual([
      { label: REFERRAL.name, value: "Instagram" },
      { label: MULTI.name, value: "Trademark, Copyright" },
      { label: TEXT.name, value: "2021" },
    ]);
  });
  it("a value keyed by its field id (a map) is resolved the same way", () => {
    const names = new Map([["42", REFERRAL.name]]);
    expect(customFieldPairs(wrap({ custom_field_values: { "42": { value: "878263" } } }), names, labels)).toEqual([{ label: REFERRAL.name, value: "A friend" }]);
  });
  it("a label-named entry finds its field by name when it carries no id", () => {
    expect(customFieldPairs(wrap({ custom_fields: [{ name: REFERRAL.name, value: "589386" }] }), undefined, labels)).toEqual([{ label: REFERRAL.name, value: "Instagram" }]);
  });
  it("Lawmatics' own formatted_value is used when present", () => {
    expect(customFieldPairs(wrap({ custom_fields: [{ name: REFERRAL.name, value: "589386", formatted_value: "Instagram" }] }), undefined, labels)).toEqual([{ label: REFERRAL.name, value: "Instagram" }]);
  });
  it("an id with no option label is 'not recorded', and the number is NOT in the pair", () => {
    const pairs = customFieldPairs(wrap({ custom_fields: [{ name: REFERRAL.name, value: "700700" }] }), undefined, labels);
    expect(pairs).toEqual([{ label: REFERRAL.name, value: "not recorded" }]);
    expect(JSON.stringify(pairs)).not.toContain("700700");
  });
  it("a FAILED field list: every bare id reads 'not recorded', the brief's summary says the labels weren't read, and no id is anywhere", () => {
    const payload = wrap({ custom_fields: [{ name: "How did you hear about us?", value: 589386 }, { name: "Goals", value: "Grow" }] });
    const s = summariseProspect(payload, undefined, failed);
    expect(s.labels).toBe("failed");
    expect(s.intake.referralSource).toBeNull(); // "not recorded" never takes a fact's place
    expect(s.intake.goals).toBe("Grow");
    expect(JSON.stringify(s)).not.toContain("589386");
  });
  it("with no lookup passed at all, nothing is looked up and a bare id is not printed", () => {
    const pairs = customFieldPairs(wrap({ custom_fields: [{ name: "Source", value: 589386 }] }));
    expect(pairs).toEqual([{ label: "Source", value: "not recorded" }]);
  });
  it("an { id, name } object value prints its name", () => {
    expect(customFieldPairs(wrap({ custom_fields: [{ name: "Source", value: { id: 589386, name: "Instagram" } }] }), undefined, labels)).toEqual([{ label: "Source", value: "Instagram" }]);
  });
});

describe("readLawmaticsIntake reads the field list once per client, and says when it could not", () => {
  const prospect = { data: { id: "p1", attributes: { custom_fields: [{ custom_field_id: 42, value: 589386 }] } } };
  const record = { id: "42", attributes: { name: REFERRAL.name, field_type: "select", options: [{ id: 589386, name: "Instagram" }] } };
  const mk = (listAll: LawmaticsClient["listAll"]) => {
    const c: LawmaticsClient = { get: vi.fn(async () => prospect), listAll };
    return { client: async () => c };
  };
  const okList = () => ({ records: [record], included: new Map(), pagesFetched: 1, truncated: false, includeDropped: false, unrecognisedShape: false }) as never;

  it("prints the label, and asks /custom_fields once for any number of leads", async () => {
    const listAll = vi.fn(async () => okList());
    const reader = mk(listAll as never);
    const first = await readLawmaticsIntake(reader, "p1");
    const second = await readLawmaticsIntake(reader, "p1");
    expect(first).toMatchObject({ state: "ok", labels: "ok" });
    expect(JSON.stringify(first)).toContain("Instagram");
    expect(JSON.stringify(second)).toContain("Instagram");
    expect(listAll).toHaveBeenCalledTimes(1);
  });
  it("a /custom_fields that fails prints no id and the read says so", async () => {
    const out = await readLawmaticsIntake(mk(async () => { throw new Error("down"); }), "p1");
    expect(out).toMatchObject({ state: "ok", labels: "failed" });
    expect(JSON.stringify(out)).not.toContain("589386");
  });
});

describe("withoutBareIds", () => {
  it("replaces a bare 3+ digit value, or comma part, and leaves the rest", () => {
    expect(withoutBareIds("589386")).toBe("not recorded");
    expect(withoutBareIds("Booth, 589386, UGW")).toBe("Booth, not recorded, UGW");
    expect(withoutBareIds("Booth 2026")).toBe("Booth 2026");
    expect(withoutBareIds("12")).toBe("12");
    expect(withoutBareIds("  ")).toBeNull();
    expect(withoutBareIds(null)).toBeNull();
  });
});
