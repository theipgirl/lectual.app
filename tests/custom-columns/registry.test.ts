import { describe, expect, it } from "vitest";
import {
  NOTES_PRESENT,
  applyColumnPrefs,
  columnsFor,
  customColumnId,
  parseColumnPrefs,
  prefsReducer,
  type ColumnId,
  type CustomColumnField,
} from "@/lib/review/sheet-columns";
import { COLUMN_PREFS_KEY, readPrefsDocument, serializePrefs, writePrefsDocument, type StorageLike } from "@/lib/review/column-prefs-storage";
import { CUSTOM_KIND_CHOICE, CUSTOM_KIND_DATE, CUSTOM_KIND_MONEY } from "@/lib/ui/words";

const A = "00000000-0000-4000-8000-00000000a001";
const B = "00000000-0000-4000-8000-00000000a002";
const C = "00000000-0000-4000-8000-00000000a003";
const ARCHIVED = "00000000-0000-4000-8000-00000000a0ff";
const fields: CustomColumnField[] = [
  { id: B, section: "contracts", label: "Signed on", kind: "date", position: 1 },
  { id: A, section: "trademarks", label: "Priority", kind: "choice", position: 2 },
  { id: C, section: "both", label: "Quoted fee", kind: "money", position: 0 },
];
const opts = (customFields: CustomColumnField[] = fields) => ({ canSeeMoney: false, hasNotes: NOTES_PRESENT, customFields });
const ids = (section: "trademarks" | "contracts", f?: CustomColumnField[]) => columnsFor(section, opts(f)).map((c) => c.id);

describe("columnsFor with the firm's fields", () => {
  it("returns the Sprint 1 list unchanged, then the section's fields in position order", () => {
    const plain = columnsFor("trademarks", { canSeeMoney: false, hasNotes: NOTES_PRESENT });
    const withCustom = columnsFor("trademarks", opts());
    expect(withCustom.slice(0, plain.length)).toEqual(plain);
    expect(withCustom.slice(plain.length).map((c) => c.id)).toEqual([customColumnId(C), customColumnId(A)]);
    expect(ids("contracts").slice(-2)).toEqual([customColumnId(C), customColumnId(B)]);
  });

  it("a custom column is read only, not money, not pinned; header = label, title = the kind word", () => {
    const [fee, prio] = columnsFor("trademarks", opts()).slice(-2);
    expect(fee).toEqual({ id: `cf:${C}`, header: "Quoted fee", title: CUSTOM_KIND_MONEY, money: false, pinned: false, editable: false, kind: "money" });
    expect(prio.title).toBe(CUSTOM_KIND_CHOICE);
    expect(columnsFor("contracts", opts()).at(-1)?.title).toBe(CUSTOM_KIND_DATE);
  });
});

describe("parseColumnPrefs with cf: ids", () => {
  const allowed = ids("trademarks");
  it("keeps a given field's id; drops one not given, an archived field's, the other section's, a malformed one, duplicates and an over-long list", () => {
    const clean = parseColumnPrefs({ order: [`cf:${A}`, `cf:${A}`, `cf:${ARCHIVED}`, `cf:${B}`, "cf:not-a-uuid", "cf:", "mark"], hidden: [`cf:${ARCHIVED}`, `cf:${B}`, `cf:${C}`] }, allowed);
    expect(clean.order.filter((x) => x.startsWith("cf:"))).toEqual([`cf:${A}`, `cf:${C}`]);
    expect(clean.hidden).toEqual([`cf:${C}`]);
    expect(new Set(clean.order).size).toBe(clean.order.length);
    expect([...clean.order].sort()).toEqual([...allowed].sort());
    const long = parseColumnPrefs({ order: Array.from({ length: 500 }, () => `cf:${A}`), hidden: [] }, allowed);
    expect(long.order.filter((x) => x === `cf:${A}`)).toHaveLength(1);
  });

  it("a missing custom id comes back at its default place (after the spreadsheet columns)", () => {
    const clean = parseColumnPrefs({ order: allowed.filter((x) => x !== `cf:${A}`), hidden: [] }, allowed);
    expect(clean.order).toEqual(allowed);
  });
});

describe("prefsReducer and applyColumnPrefs with cf: ids", () => {
  const allowed = ids("trademarks");
  const start = parseColumnPrefs(null, allowed);
  it("toggle hides and shows a custom column; reset restores (P1)", () => {
    const hidden = prefsReducer(start, { type: "toggle", id: `cf:${A}` }, allowed);
    expect(hidden.hidden).toEqual([`cf:${A}`]);
    expect(prefsReducer(hidden, { type: "toggle", id: `cf:${A}` }, allowed).hidden).toEqual([]);
    expect(prefsReducer(hidden, { type: "reset" }, allowed)).toEqual({ order: allowed, hidden: [] });
  });

  it("move works on a cf: id and never moves it above the pinned column (P2)", () => {
    let p = start;
    for (let i = 0; i < allowed.length + 3; i++) p = prefsReducer(p, { type: "move", id: `cf:${A}`, dir: -1 }, allowed);
    expect(p.order[0]).toBe("client");
    expect(p.order[1]).toBe(`cf:${A}`);
    const drawn = applyColumnPrefs(columnsFor("trademarks", opts()), p).map((c) => c.id);
    expect(drawn.indexOf(`cf:${A}` as ColumnId)).toBe(1);
  });

  it("a forged cf: id draws nothing extra", () => {
    const allowedCols = columnsFor("trademarks", opts());
    const drawn = applyColumnPrefs(allowedCols, { order: [`cf:${ARCHIVED}`, `cf:${B}`, ...allowed], hidden: [] });
    expect(drawn.map((c) => c.id)).toEqual(allowed);
  });

  it("a toggle or move of an id not given changes nothing", () => {
    expect(prefsReducer(start, { type: "toggle", id: `cf:${ARCHIVED}` }, allowed)).toEqual(start);
    expect(prefsReducer(start, { type: "move", id: `cf:${B}`, dir: 1 }, allowed)).toEqual(start);
  });
});

describe("storage round-trip with cf: ids", () => {
  const memory = (): StorageLike & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };
  it("writes and reads back the same choices (a reload keeps a hidden custom column hidden)", () => {
    const store = memory();
    const allowed = ids("trademarks");
    const prefs = prefsReducer(parseColumnPrefs(null, allowed), { type: "toggle", id: `cf:${A}` }, allowed);
    expect(writePrefsDocument(store, { trademarks: prefs })).toBe(true);
    expect(store.data.get(COLUMN_PREFS_KEY)).toBe(serializePrefs({ trademarks: prefs }));
    const back = readPrefsDocument(store);
    expect(parseColumnPrefs(back?.trademarks, allowed)).toEqual(prefs);
    expect(applyColumnPrefs(columnsFor("trademarks", opts()), back?.trademarks).map((c) => c.id)).not.toContain(`cf:${A}`);
  });
  it("survives a throwing storage", () => {
    const bad: StorageLike = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(readPrefsDocument(bad)).toBeNull();
    expect(writePrefsDocument(bad, { trademarks: { order: [`cf:${A}`], hidden: [] } })).toBe(false);
  });
});
