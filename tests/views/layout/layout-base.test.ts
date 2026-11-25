import { describe, expect, it } from "vitest";
import { reviewBoardBase, reviewListBase } from "@/lib/review/layout-base";
import { applyReviewLayout } from "@/lib/review/layout";
import { columnsFor } from "@/lib/review/sheet-columns";
import { laneKey } from "@/lib/review/board-layout";
import { currentLayout } from "@/lib/views/layout/save";

describe("the base of an owner's List change: one per section", () => {
  it("Trademarks and Contracts each get their own columns, in their own default order", () => {
    const t = reviewListBase([], "trademarks").map((d) => d.key);
    const c = reviewListBase([], "contracts").map((d) => d.key);
    expect(t.slice(0, 3)).toEqual(["client", "mark", "serial"]);
    expect(c.slice(0, 3)).toEqual(["client", "practice_area", "mark"]);
    expect(t).not.toContain("practice_area");
    expect(c).not.toContain("serial");
    expect(reviewListBase([], "trademarks").find((d) => d.key === "client")!.pinned).toBe(true);
    // the same key carries each section's own built-in header
    expect(reviewListBase([], "trademarks").find((d) => d.key === "client")!.label).not.toBe(reviewListBase([], "contracts").find((d) => d.key === "client")!.label);
  });
  it("holds the firm's columns that fit the section, a Money one included (an owner's base)", () => {
    const F = "0a1b2c3d-0000-4000-8000-00000000f001";
    const M = "0a1b2c3d-0000-4000-8000-00000000f002";
    const fields = [
      { id: F, section: "both" as const, label: "Priority", kind: "text" as const, position: 0 },
      { id: M, section: "contracts" as const, label: "Quoted", kind: "money" as const, position: 1 },
    ];
    const t = reviewListBase(fields, "trademarks").map((d) => d.key);
    const c = reviewListBase(fields, "contracts").map((d) => d.key);
    expect(t).toContain(`cf:${F}`);
    expect(t).not.toContain(`cf:${M}`);
    expect(c).toContain(`cf:${F}`);
    expect(c).toContain(`cf:${M}`);
  });
  it("saving a layout built from a section's base changes nothing that section draws", () => {
    for (const section of ["trademarks", "contracts"] as const) {
      const cols = columnsFor(section, { canSeeMoney: true, hasNotes: true });
      const layout = currentLayout({ defaults: reviewListBase([], section) }, null);
      expect(applyReviewLayout(cols, layout).map((c) => c.id)).toEqual(cols.map((c) => c.id));
    }
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
