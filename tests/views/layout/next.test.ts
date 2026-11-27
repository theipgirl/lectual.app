import { describe, expect, it } from "vitest";
import { insertColumn, moveColumn, renameColumn, setHidden, setWidth, type Next } from "@/lib/views/layout/next";
import { LAYOUT_MAX_COLUMNS, type Layout } from "@/lib/views/layout/types";
import { parseLayout } from "@/lib/views/layout/validate";

const c = (key: string, over: Partial<Layout[number]> = {}): Layout[number] => ({ key, label: null, hidden: false, width: null, ...over });
const base = (): Layout => [c("client"), c("mark"), c("status"), c("next", { hidden: true }), c("notes")];
const keys = (l: Layout) => l.map((x) => x.key);
const ok = (n: Next): Layout => {
  if (!n.ok) throw new Error(`refused: ${n.reason}`);
  return n.layout;
};
const FIELD = "cf:0a1b2c3d-0000-4000-8000-00000000f001";

describe("renameColumn", () => {
  it("sets the label only; the key never changes", () => {
    const l = ok(renameColumn(base(), "status", "  Where it stands "));
    expect(l.find((x) => x.key === "status")).toEqual(c("status", { label: "Where it stands" }));
    expect(keys(l)).toEqual(keys(base()));
  });
  it("a blank label, or the built-in name, clears the override", () => {
    const named = ok(renameColumn(base(), "status", "Stage"));
    expect(ok(renameColumn(named, "status", "   ")).find((x) => x.key === "status")!.label).toBeNull();
    expect(ok(renameColumn(named, "status", "Status", "Status")).find((x) => x.key === "status")!.label).toBeNull();
  });
  it("refuses a bad label with its reason, an unknown column, and changes nothing", () => {
    const b = base();
    expect(renameColumn(b, "status", "a\tb")).toEqual({ ok: false, reason: "label-characters" });
    expect(renameColumn(b, "status", "x".repeat(61))).toEqual({ ok: false, reason: "label-too-long" });
    expect(renameColumn(b, "nope", "x")).toEqual({ ok: false, reason: "unknown-column" });
    expect(b).toEqual(base());
  });
});

describe("setHidden", () => {
  it("hides and shows", () => {
    expect(ok(setHidden(base(), "mark", true)).find((x) => x.key === "mark")!.hidden).toBe(true);
    expect(ok(setHidden(base(), "next", false)).find((x) => x.key === "next")!.hidden).toBe(false);
  });
  it("never hides a pinned column", () => {
    expect(setHidden(base(), "client", true, ["client"])).toEqual({ ok: false, reason: "pinned" });
    expect(ok(setHidden(base(), "client", false, ["client"]))).toBeTruthy();
  });
  it("never hides the last visible column", () => {
    const one: Layout = [c("a"), c("b", { hidden: true })];
    expect(setHidden(one, "a", true)).toEqual({ ok: false, reason: "last-column" });
    expect(ok(setHidden([c("a"), c("b")], "a", true)).filter((x) => !x.hidden)).toHaveLength(1);
  });
});

describe("moveColumn", () => {
  it("moves one place, stepping over a hidden neighbour so the move is seen", () => {
    expect(keys(ok(moveColumn(base(), "notes", -1)))).toEqual(["client", "mark", "notes", "status", "next"]);
    expect(keys(ok(moveColumn(base(), "status", 1)))).toEqual(["client", "mark", "next", "notes", "status"]);
    expect(keys(ok(moveColumn(base(), "mark", 1)))).toEqual(["client", "status", "mark", "next", "notes"]);
  });
  it("nothing moves into the pinned places and a pinned column doesn't move", () => {
    expect(moveColumn(base(), "mark", -1, ["client"])).toEqual({ ok: false, reason: "nothing-to-move" });
    expect(moveColumn(base(), "client", 1, ["client"])).toEqual({ ok: false, reason: "pinned" });
  });
  it("the ends don't move", () => {
    expect(moveColumn(base(), "notes", 1)).toEqual({ ok: false, reason: "nothing-to-move" });
    expect(moveColumn(base(), "client", -1)).toEqual({ ok: false, reason: "nothing-to-move" });
  });
  it("a hidden column next to the end counts as nothing to step to", () => {
    const l: Layout = [c("a"), c("b"), c("z", { hidden: true })];
    expect(moveColumn(l, "b", 1)).toEqual({ ok: false, reason: "nothing-to-move" });
  });
});

describe("insertColumn", () => {
  it("adds a new column to the left or right of another, visible", () => {
    expect(keys(ok(insertColumn(base(), { key: FIELD, label: "Priority" }, "status", "left")))).toEqual(["client", "mark", FIELD, "status", "next", "notes"]);
    const right = ok(insertColumn(base(), { key: FIELD }, "status", "right"));
    expect(keys(right)).toEqual(["client", "mark", "status", FIELD, "next", "notes"]);
    expect(right.find((x) => x.key === FIELD)).toEqual({ key: FIELD, label: null, hidden: false, width: null });
  });
  it("never to the left of a pinned column", () => {
    expect(insertColumn(base(), { key: FIELD }, "client", "left", ["client"])).toEqual({ ok: false, reason: "pinned" });
    expect(ok(insertColumn(base(), { key: FIELD }, "client", "right", ["client"]))).toBeTruthy();
  });
  it("refuses a taken or bad key, an unknown anchor, a bad label, and a ninety-first column", () => {
    expect(insertColumn(base(), { key: "status" }, "mark", "left")).toEqual({ ok: false, reason: "key-taken" });
    expect(insertColumn(base(), { key: "Bad Key" }, "mark", "left")).toEqual({ ok: false, reason: "bad-key" });
    expect(insertColumn(base(), { key: FIELD }, "nope", "left")).toEqual({ ok: false, reason: "unknown-column" });
    expect(insertColumn(base(), { key: FIELD, label: "a\u202Eb" }, "mark", "left")).toEqual({ ok: false, reason: "label-characters" });
    const full = Array.from({ length: LAYOUT_MAX_COLUMNS }, (_, i) => c(`c${i}`));
    expect(insertColumn(full, { key: FIELD }, "c0", "right")).toEqual({ ok: false, reason: "too-many" });
  });
});

describe("setWidth", () => {
  it("clamps to 40..800 and null clears", () => {
    expect(ok(setWidth(base(), "mark", 10)).find((x) => x.key === "mark")!.width).toBe(40);
    expect(ok(setWidth(base(), "mark", 5000)).find((x) => x.key === "mark")!.width).toBe(800);
    expect(ok(setWidth(base(), "mark", 133.4)).find((x) => x.key === "mark")!.width).toBe(133);
    expect(ok(setWidth(ok(setWidth(base(), "mark", 200)), "mark", null)).find((x) => x.key === "mark")!.width).toBeNull();
    expect(setWidth(base(), "mark", NaN)).toEqual({ ok: false, reason: "bad-width" });
    expect(setWidth(base(), "nope", 100)).toEqual({ ok: false, reason: "unknown-column" });
  });
});

describe("every layout a helper returns is one the database accepts", () => {
  it("a long random run of changes never produces an invalid layout, and never changes the previous one", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n);
    let layout = base();
    let cf = 0;
    for (let i = 0; i < 400; i++) {
      const before = JSON.stringify(layout);
      const key = layout[rnd(layout.length)].key;
      const pick = rnd(6);
      const next: Next =
        pick === 0 ? renameColumn(layout, key, ["", "Name", "x\ty", "Y".repeat(61), " Fine "][rnd(5)])
        : pick === 1 ? setHidden(layout, key, rnd(2) === 0, ["client"])
        : pick === 2 ? moveColumn(layout, key, rnd(2) === 0 ? -1 : 1, ["client"])
        : pick === 3 ? insertColumn(layout, { key: `cf:0a1b2c3d-0000-4000-8000-${String(cf++).padStart(12, "0")}` }, key, rnd(2) === 0 ? "left" : "right", ["client"])
        : pick === 4 ? setWidth(layout, key, rnd(1000) - 100)
        : renameColumn(layout, key, "Other");
      expect(JSON.stringify(layout)).toBe(before);
      if (next.ok) {
        expect(parseLayout(next.layout)).not.toBeNull();
        expect(next.layout[0].key).toBe("client");
        expect(next.layout.some((x) => !x.hidden)).toBe(true);
        layout = next.layout;
      }
    }
  });
});

describe("moveColumnTo", () => {
  it("moves a column to an index among all columns, hidden ones included", async () => {
    const { moveColumnTo } = await import("@/lib/views/layout/next");
    expect(keys(ok(moveColumnTo(base(), "notes", 1)))).toEqual(["client", "notes", "mark", "status", "next"]);
    expect(keys(ok(moveColumnTo(base(), "mark", 99)))).toEqual(["client", "status", "next", "notes", "mark"]);
  });
  it("nothing moves into the pinned places; a pinned column or an unknown one doesn't move; no change is no move", async () => {
    const { moveColumnTo } = await import("@/lib/views/layout/next");
    expect(keys(ok(moveColumnTo(base(), "notes", 0, ["client"])))).toEqual(["client", "notes", "mark", "status", "next"]);
    expect(moveColumnTo(base(), "client", 2, ["client"])).toEqual({ ok: false, reason: "pinned" });
    expect(moveColumnTo(base(), "nope", 2)).toEqual({ ok: false, reason: "unknown-column" });
    expect(moveColumnTo(base(), "mark", 1)).toEqual({ ok: false, reason: "nothing-to-move" });
    expect(moveColumnTo(base(), "mark", 1.5)).toEqual({ ok: false, reason: "nothing-to-move" });
  });
});

describe("moveColumnBeside (Move left / right go beside the VISIBLE neighbour)", () => {
  it("places the column beside a named one, past columns that are not drawn", async () => {
    const { moveColumnBeside } = await import("@/lib/views/layout/next");
    const l: Layout = [c("client"), c("a"), c("hidden_other", { hidden: true }), c("b"), c("other_section"), c("d")];
    expect(keys(ok(moveColumnBeside(l, "d", "b", "right")))).toEqual(["client", "a", "hidden_other", "b", "d", "other_section"]);
    expect(keys(ok(moveColumnBeside(l, "b", "a", "left")))).toEqual(["client", "b", "a", "hidden_other", "other_section", "d"]);
  });
  it("both keys must be in the layout; a pinned column doesn't move and nothing goes left of it; no change is no move", async () => {
    const { moveColumnBeside } = await import("@/lib/views/layout/next");
    const l: Layout = [c("client"), c("a"), c("b")];
    expect(moveColumnBeside(l, "a", "gone", "left")).toEqual({ ok: false, reason: "unknown-column" });
    expect(moveColumnBeside(l, "gone", "a", "left")).toEqual({ ok: false, reason: "unknown-column" });
    expect(moveColumnBeside(l, "client", "b", "right", ["client"])).toEqual({ ok: false, reason: "pinned" });
    expect(moveColumnBeside(l, "b", "client", "left", ["client"])).toEqual({ ok: false, reason: "pinned" });
    expect(moveColumnBeside(l, "a", "b", "left")).toEqual({ ok: false, reason: "nothing-to-move" });
    expect(moveColumnBeside(l, "a", "a", "left")).toEqual({ ok: false, reason: "nothing-to-move" });
    expect(l.map((x) => x.key)).toEqual(["client", "a", "b"]);
  });
});
