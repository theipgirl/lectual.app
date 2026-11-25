import { describe, expect, it } from "vitest";
import { cfKey, cleanLabel, isBuiltinKey, isCfKey, isLayoutKey, isViewKey, parseLayout, parseLayoutColumn } from "@/lib/views/layout/validate";
import { VIEW_KEYS } from "@/lib/views/layout/types";

const FIELD = "0a1b2c3d-0000-4000-8000-00000000f001";
const col = (over: Record<string, unknown> = {}) => ({ key: "status", label: null, hidden: false, width: null, ...over });

describe("layout keys", () => {
  it("the eight view keys, and nothing else", () => {
    expect([...VIEW_KEYS]).toEqual(["review_list", "review_board", "matters_list", "matters_board", "contracts_list", "contracts_board", "leads_list", "leads_board"]);
    expect(isViewKey("review_list")).toBe(true);
    for (const bad of ["review", "Review_List", "", null, 3, undefined]) expect(isViewKey(bad), String(bad)).toBe(false);
  });

  it("a built-in key is 1..40 of [a-z0-9_], starting with a letter (0119's regex)", () => {
    for (const ok of ["a", "status", "legal_fee_due", "a".repeat(40), "u0a1b2c3d00004000800000000000f001"]) expect(isBuiltinKey(ok), ok).toBe(true);
    for (const bad of ["", "Status", "legalFee", "1status", "_x", "a".repeat(41), "a-b", "a b", "cf:x", null, 5]) expect(isBuiltinKey(bad), String(bad)).toBe(false);
  });

  it("a firm column key is cf: and a LOWERCASE uuid; cfKey lowercases a field id", () => {
    expect(isCfKey(`cf:${FIELD}`)).toBe(true);
    expect(isCfKey(`cf:${FIELD.toUpperCase()}`)).toBe(false);
    expect(isCfKey(`cf:${FIELD.slice(1)}`)).toBe(false);
    expect(isCfKey(FIELD)).toBe(false);
    expect(cfKey(FIELD.toUpperCase())).toBe(`cf:${FIELD}`);
    expect(isLayoutKey(cfKey(FIELD.toUpperCase()))).toBe(true);
  });
});

describe("cleanLabel: what a person may name a column", () => {
  it("trims and keeps interior spaces", () => {
    expect(cleanLabel("  Next  step ")).toEqual({ ok: true, label: "Next  step" });
  });
  it("1..60 characters, counted as characters (a letter outside the basic plane is one)", () => {
    expect(cleanLabel("a".repeat(60))).toMatchObject({ ok: true });
    expect(cleanLabel("a".repeat(61))).toEqual({ ok: false, reason: "too-long" });
    expect(cleanLabel("😀".repeat(60))).toMatchObject({ ok: true });
    expect(cleanLabel("😀".repeat(61))).toEqual({ ok: false, reason: "too-long" });
  });
  it("empty, blank and non-strings are empty", () => {
    for (const x of ["", "   ", null, undefined, 4]) expect(cleanLabel(x), String(x)).toEqual({ ok: false, reason: "empty" });
  });
  it("refuses control characters (a tab and a newline included) and the invisible direction marks the database refuses", () => {
    const bad = ["a\tb", "a\nb", "a\u0000b", "a\u007fb", "a\u0085b", "a​b", "a‏b", "a‪b", "a‮b", "a⁦b", "a⁩b"];
    for (const x of bad) expect(cleanLabel(x), JSON.stringify(x)).toEqual({ ok: false, reason: "characters" });
    // Just outside the ranges: allowed.
    for (const x of ["a‐b", "a b", "a⁥b", "a b"]) expect(cleanLabel(x), JSON.stringify(x)).toMatchObject({ ok: true });
  });
});

describe("parseLayoutColumn / parseLayout: the same shape the database accepts", () => {
  it("a missing label or width reads as null", () => {
    expect(parseLayoutColumn({ key: "status", hidden: true })).toEqual({ key: "status", label: null, hidden: true, width: null });
  });
  it("refuses a column with another key, a non-boolean hidden, a bad key, an untrimmed or invalid label, a bad width", () => {
    const bad: unknown[] = [
      col({ extra: 1 }), col({ hidden: "no" }), { key: "status" }, col({ key: "Status" }), col({ key: "legalFee" }), col({ label: " x" }), col({ label: "x " }), col({ label: "" }), col({ label: "a\tb" }),
      col({ label: 5 }), col({ width: 39 }), col({ width: 801 }), col({ width: 120.5 }), col({ width: "120" }), col({ width: NaN }), null, [], "x",
    ];
    for (const b of bad) expect(parseLayoutColumn(b), JSON.stringify(b)).toBeNull();
  });
  it("width 40 and 800 are fine", () => {
    expect(parseLayoutColumn(col({ width: 40 }))?.width).toBe(40);
    expect(parseLayoutColumn(col({ width: 800 }))?.width).toBe(800);
  });
  it("a layout is an array of 1..80 distinct columns; anything else is unreadable (null)", () => {
    expect(parseLayout([col()])).toEqual([col()]);
    expect(parseLayout([])).toBeNull();
    expect(parseLayout({})).toBeNull();
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout([col(), col()])).toBeNull();
    const many = (n: number) => Array.from({ length: n }, (_, i) => col({ key: `c${i}` }));
    expect(parseLayout(many(80))).toHaveLength(80);
    expect(parseLayout(many(81))).toBeNull();
    expect(parseLayout([col(), { key: "x", hidden: "yes" }])).toBeNull();
  });
});
