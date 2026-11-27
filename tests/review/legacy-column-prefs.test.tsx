import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LEGACY_COLUMN_PREFS_KEY, removeLegacyColumnPrefs } from "@/lib/review/legacy-column-prefs";
import { SHEET_SIZES_KEY } from "@/lib/review/sheet-edit";
import { labelsOf, renderOwnerSheet, renderReadOnly, rowOf, tableHeaders } from "./columns-fixtures";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/dashboard/review/actions", () => ({
  setNextStepAction: vi.fn(), updateNextStepAction: vi.fn(), moveStageAction: vi.fn(), closeLeadAction: vi.fn(),
  assignRecordAction: vi.fn(), setSourceAction: vi.fn(), logWhatHappenedAction: vi.fn(),
}));
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

const ROOT = path.resolve(__dirname, "../..");
const memory = () => {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
};

// The retired per-person chooser (Nov 25 decision): the firm's layout decides the columns; an old stored choice is only deleted.
describe("the old per-person column choice is removed, never read", () => {
  it("removes the old key once and leaves the widths key alone", () => {
    const store = memory();
    store.setItem(LEGACY_COLUMN_PREFS_KEY, JSON.stringify({ v: 1, trademarks: { order: ["status"], hidden: ["serial"] }, contracts: null }));
    store.setItem(SHEET_SIZES_KEY, JSON.stringify({ client: 220 }));
    expect(removeLegacyColumnPrefs(store)).toBe(true);
    expect(store.getItem(LEGACY_COLUMN_PREFS_KEY)).toBeNull();
    expect(store.getItem(SHEET_SIZES_KEY)).toBe(JSON.stringify({ client: 220 }));
    // A second pass is a no-op.
    expect(removeLegacyColumnPrefs(store)).toBe(true);
  });

  it("a store that throws, or no store, throws nothing", () => {
    expect(removeLegacyColumnPrefs({ removeItem: () => { throw new Error("denied"); } })).toBe(false);
    expect(removeLegacyColumnPrefs(null)).toBe(false);
    expect(removeLegacyColumnPrefs(undefined)).toBe(false);
  });

  it("a present, malformed or huge old value changes nothing about what is drawn, in either table, and throws nothing", async () => {
    const values = ["{not json", "[]", "null", JSON.stringify({ v: 1, trademarks: { order: ["status", "nope"], hidden: ["client", "mark"] }, contracts: { order: Array.from({ length: 5000 }, () => "mark"), hidden: ["client"] } }), "x".repeat(2_000_000)];
    const baseline = [await renderReadOnly({ canSeeMoney: true }), await renderOwnerSheet({ canSeeMoney: true })].map((h) => tableHeaders(h));
    for (const v of values) {
      const store = memory();
      store.setItem(LEGACY_COLUMN_PREFS_KEY, v);
      vi.stubGlobal("window", { localStorage: store, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false }) });
      const got = [await renderReadOnly({ canSeeMoney: true }), await renderOwnerSheet({ canSeeMoney: true })];
      expect(got.map((h) => tableHeaders(h))).toEqual(baseline);
      expect(labelsOf(rowOf(got[0], "Acme Studio"))).toEqual(baseline[0][0].slice(1));
      // Nothing in the draw path touched the old value; only the cleaner removes it.
      expect(store.getItem(LEGACY_COLUMN_PREFS_KEY)).toBe(v);
      removeLegacyColumnPrefs(store);
      expect(store.getItem(LEGACY_COLUMN_PREFS_KEY)).toBeNull();
    }
  });

  it("no source reads the old key for column choice, and no chooser file or word is left", () => {
    const read = (f: string) => readFileSync(path.join(ROOT, f), "utf8");
    expect(() => read("src/components/review/ColumnChooser.tsx")).toThrow();
    expect(() => read("src/components/review/use-column-prefs.ts")).toThrow();
    expect(() => read("src/lib/review/column-prefs-storage.ts")).toThrow();
    const cols = read("src/lib/review/sheet-columns.ts");
    for (const gone of ["applyColumnPrefs", "parseColumnPrefs", "prefsReducer", "parseStoredDocument"]) expect(cols).not.toContain(gone);
    expect(read("src/lib/ui/words.ts")).not.toMatch(/COLUMNS_(BUTTON|MENU_LABEL|RESET|MOVE_UP|KEPT_HERE)/);
    expect(read("src/components/review/review.css")).not.toContain("rv-cols-");
  });
});
