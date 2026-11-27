import { describe, expect, it } from "vitest";
import { applyLayout, layoutOf, resolveLayout } from "@/lib/views/layout/apply";
import type { Layout, LayoutDefault } from "@/lib/views/layout/types";

const defaults: (LayoutDefault & { editable?: boolean })[] = [
  { key: "client", label: "Client", pinned: true },
  { key: "mark", label: "Mark" },
  { key: "status", label: "Status", editable: true },
  { key: "next", label: "Next step" },
  { key: "notes", label: "Notes" },
];
const c = (key: string, over: Partial<Layout[number]> = {}): Layout[number] => ({ key, label: null, hidden: false, width: null, ...over });
const keys = (cols: { key: string }[]) => cols.map((x) => x.key);

describe("applyLayout", () => {
  it("no saved layout: the defaults, untouched", () => {
    expect(keys(applyLayout(defaults, null))).toEqual(["client", "mark", "status", "next", "notes"]);
    expect(applyLayout(defaults, undefined).map((x) => x.label)).toEqual(["Client", "Mark", "Status", "Next step", "Notes"]);
  });

  it("saved order wins; a column missing from the layout comes after, in default order", () => {
    const out = applyLayout(defaults, [c("client"), c("notes"), c("status")]);
    expect(keys(out)).toEqual(["client", "notes", "status", "mark", "next"]);
  });

  it("a saved label shows instead of the built-in name; the key and the caller's own fields stay", () => {
    const out = applyLayout(defaults, [c("client"), c("status", { label: "Where it stands" })]);
    const status = out.find((x) => x.key === "status")!;
    expect(status.label).toBe("Where it stands");
    expect(status.editable).toBe(true);
    expect(out.find((x) => x.key === "mark")!.label).toBe("Mark");
  });

  it("hidden columns are left out; a width comes through (null when none)", () => {
    const out = applyLayout(defaults, [c("client", { width: 220 }), c("mark", { hidden: true }), c("status")]);
    expect(keys(out)).toEqual(["client", "status", "next", "notes"]);
    expect(out[0].width).toBe(220);
    expect(out[1].width).toBeNull();
  });

  it("a saved key that no longer exists is dropped; a repeated key counts once", () => {
    const out = applyLayout(defaults, [c("gone"), c("status"), { ...c("status"), label: "Dup" }, c("client")]);
    expect(keys(out)).toEqual(["client", "status", "mark", "next", "notes"]);
    expect(out.find((x) => x.key === "status")!.label).toBe("Status");
  });

  it("the pinned column is first and never hidden, whatever the layout says", () => {
    const out = applyLayout(defaults, [c("status"), c("client", { hidden: true }), c("mark")]);
    expect(keys(out)[0]).toBe("client");
    expect(keys(out)).toContain("client");
  });

  it("a layout that hides everything draws the defaults: a table is never empty", () => {
    const flat = defaults.map((d) => ({ key: d.key, label: d.label }));
    const out = applyLayout(flat, flat.map((d) => c(d.key, { hidden: true })));
    expect(keys(out)).toEqual(["client", "mark", "status", "next", "notes"]);
  });

  it("never changes its inputs", () => {
    const saved = [c("notes"), c("client")];
    const before = JSON.stringify([defaults, saved]);
    applyLayout(defaults, saved);
    expect(JSON.stringify([defaults, saved])).toBe(before);
  });
});

describe("a layout can't add a column the viewer may not have", () => {
  it("a saved key that isn't in the viewer's defaults (a Money column for a non-owner) draws nothing, and is not in the resolved list", () => {
    const money = "cf:0a1b2c3d-0000-4000-8000-00000000f001";
    const viewer = defaults; // the caller left the Money column out of the viewer's defaults
    expect(keys(applyLayout(viewer, [c("client"), c(money), c("status")]))).not.toContain(money);
    expect(keys(resolveLayout(viewer, [c(money)]))).not.toContain(money);
    // The owner's defaults hold it, so the same layout draws it (and renames it).
    const owner = [...defaults, { key: money, label: "Quoted fee" }];
    expect(keys(applyLayout(owner, [c("client"), c(money, { label: "Quote" })]))).toContain(money);
    expect(applyLayout(owner, [c("client"), c(money, { label: "Quote" })]).find((x) => x.key === money)!.label).toBe("Quote");
  });
});

describe("resolveLayout / layoutOf", () => {
  it("resolves every column the viewer has, hidden ones included, with renamed and builtinLabel", () => {
    const r = resolveLayout(defaults, [c("client"), c("mark", { hidden: true, label: "Brand" })]);
    const mark = r.find((x) => x.key === "mark")!;
    expect(mark).toMatchObject({ hidden: true, label: "Brand", builtinLabel: "Mark", renamed: true });
    expect(r.find((x) => x.key === "status")!.renamed).toBe(false);
  });
  it("layoutOf gives the saveable shape (a label equal to the built-in name is null) and round-trips through resolve", () => {
    const saved: Layout = [c("client"), c("mark", { label: "Brand", width: 150 }), c("notes", { hidden: true })];
    const full = layoutOf(resolveLayout(defaults, saved));
    expect(full.map((x) => x.key)).toEqual(["client", "mark", "notes", "status", "next"]);
    expect(full.find((x) => x.key === "status")).toEqual({ key: "status", label: null, hidden: false, width: null });
    expect(layoutOf(resolveLayout(defaults, full))).toEqual(full);
  });
  it("a label saved equal to the built-in name reads as not renamed", () => {
    expect(resolveLayout(defaults, [c("mark", { label: "Mark" })]).find((x) => x.key === "mark")!.renamed).toBe(false);
  });
});
