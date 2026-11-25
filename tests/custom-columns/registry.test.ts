import { describe, expect, it } from "vitest";
import {
  NOTES_PRESENT,
  columnsFor,
  customColumnId,
  type CustomColumnField,
} from "@/lib/review/sheet-columns";
import { CUSTOM_KIND_CHOICE, CUSTOM_KIND_DATE, CUSTOM_KIND_MONEY } from "@/lib/ui/words";

const A = "00000000-0000-4000-8000-00000000a001";
const B = "00000000-0000-4000-8000-00000000a002";
const C = "00000000-0000-4000-8000-00000000a003";
const fields: CustomColumnField[] = [
  { id: B, section: "contracts", label: "Signed on", kind: "date", position: 1 },
  { id: A, section: "trademarks", label: "Priority", kind: "choice", position: 2 },
  { id: C, section: "both", label: "Quoted fee", kind: "money", position: 0 },
];
// The owner's view: the Money field is a column (Nov 23: custom Money is owner-only, like the fee columns).
const opts = (customFields: CustomColumnField[] = fields) => ({ canSeeMoney: true, canSeeCustomMoney: true, hasNotes: NOTES_PRESENT, customFields });
const ids = (section: "trademarks" | "contracts", f?: CustomColumnField[]) => columnsFor(section, opts(f)).map((c) => c.id);

describe("columnsFor with the firm's fields", () => {
  it("returns the Sprint 1 list unchanged, then the section's fields in position order", () => {
    const plain = columnsFor("trademarks", { canSeeMoney: true, hasNotes: NOTES_PRESENT });
    const withCustom = columnsFor("trademarks", opts());
    expect(withCustom.slice(0, plain.length)).toEqual(plain);
    expect(withCustom.slice(plain.length).map((c) => c.id)).toEqual([customColumnId(C), customColumnId(A)]);
    expect(ids("contracts").slice(-2)).toEqual([customColumnId(C), customColumnId(B)]);
  });

  it("a custom column is typeable (cellEditable decides per role and row), not pinned; header = label, title = the kind word; a Money field is a money column", () => {
    const [fee, prio] = columnsFor("trademarks", opts()).slice(-2);
    // Changed on purpose (Nov 23): `money: true` for a Money field (it was false while custom money was open to every member).
    expect(fee).toEqual({ id: `cf:${C}`, header: "Quoted fee", title: CUSTOM_KIND_MONEY, money: true, pinned: false, editable: true, kind: "money" });
    expect(prio.money).toBe(false);
    expect(prio.title).toBe(CUSTOM_KIND_CHOICE);
    expect(columnsFor("contracts", opts()).at(-1)?.title).toBe(CUSTOM_KIND_DATE);
  });
});

describe("Money custom columns are owner-only (Taylor, Nov 23)", () => {
  it("without canSeeMoney a Money field is not a column in either section; every other field still is", () => {
    for (const section of ["trademarks", "contracts"] as const) {
      const got = columnsFor(section, { canSeeMoney: false, hasNotes: NOTES_PRESENT, customFields: fields }).map((c) => c.id);
      expect(got, section).not.toContain(customColumnId(C));
    }
    expect(columnsFor("trademarks", { canSeeMoney: false, hasNotes: NOTES_PRESENT, customFields: fields }).map((c) => c.id)).toContain(customColumnId(A));
  });
});
