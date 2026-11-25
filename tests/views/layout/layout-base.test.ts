import { describe, expect, it } from "vitest";
import { mergeDefaults, reviewBoardBase, reviewListBase } from "@/lib/review/layout-base";
import { applyReviewLayout } from "@/lib/review/layout";
import { columnsFor } from "@/lib/review/sheet-columns";
import { laneKey } from "@/lib/review/board-layout";
import { currentLayout } from "@/lib/views/layout/save";

describe("the base of an owner's List change", () => {
  it("is both sections' columns merged: the Trademarks order, practice area after the client", () => {
    const keys = reviewListBase([]).map((d) => d.key);
    expect(keys.slice(0, 3)).toEqual(["client", "practice_area", "mark"]);
    for (const k of ["serial", "status", "notes", "owner", "legal_fee", "gov_fee", "oa_due", "next", "waiting", "contact"]) expect(keys).toContain(k);
    expect(new Set(keys).size).toBe(keys.length);
    expect(reviewListBase([]).find((d) => d.key === "client")!.pinned).toBe(true);
  });
  it("holds the firm's columns, a Money one included (an owner's base)", () => {
    const F = "0a1b2c3d-0000-4000-8000-00000000f001";
    const M = "0a1b2c3d-0000-4000-8000-00000000f002";
    const keys = reviewListBase([
      { id: F, section: "both", label: "Priority", kind: "text", position: 0 },
      { id: M, section: "contracts", label: "Quoted", kind: "money", position: 1 },
    ]).map((d) => d.key);
    expect(keys).toContain(`cf:${F}`);
    expect(keys).toContain(`cf:${M}`);
  });
  it("saving a layout built from it changes nothing either section draws until the firm changes something", () => {
    const base = reviewListBase([]);
    const layout = currentLayout({ defaults: base }, null);
    for (const section of ["trademarks", "contracts"] as const) {
      const cols = columnsFor(section, { canSeeMoney: true, hasNotes: true });
      const plain = cols.map((c) => c.id);
      const drawn = applyReviewLayout(cols, layout).map((c) => c.id);
      // the same columns; only the order may follow the merged one, and the trademarks order is untouched
      expect([...drawn].sort()).toEqual([...plain].sort());
      if (section === "trademarks") expect(drawn).toEqual(plain);
    }
  });
  it("mergeDefaults keeps the first list's order and slots the rest after their predecessor", () => {
    const d = (key: string) => ({ key, label: key });
    expect(mergeDefaults([d("a"), d("b"), d("c")], [d("a"), d("x"), d("c"), d("y")]).map((x) => x.key)).toEqual(["a", "x", "b", "c", "y"]);
  });
});

describe("the base of an owner's Board change", () => {
  it("is every member's lane (owners first, then by name) and Unassigned last", () => {
    const base = reviewBoardBase([
      { userId: "11111111-1111-4111-8111-111111111111", name: "Zed", role: "paralegal" },
      { userId: "22222222-2222-4222-8222-222222222222", name: "Amy", role: "paralegal" },
      { userId: "33333333-3333-4333-8333-333333333333", name: "Rebecca", role: "owner" },
    ]);
    expect(base.map((b) => b.label)).toEqual(["Rebecca", "Amy", "Zed", "Unassigned"]);
    expect(base[0].key).toBe(laneKey("33333333-3333-4333-8333-333333333333"));
    expect(base.at(-1)!.key).toBe("unassigned");
  });
});
