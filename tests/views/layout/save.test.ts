import { describe, expect, it, vi } from "vitest";
import { applyOp, changeLayout, currentLayout, parseOp, parseRev, writeFailure, type LayoutBase, type SaveDeps } from "@/lib/views/layout/save";
import type { Layout } from "@/lib/views/layout/types";
import type { OwnerState } from "@/lib/views/layout/owner";
import * as W from "@/lib/ui/words";

/** The layout write's logic over fakes: the owner row first, one operation, never a whole layout, fenced on rev. */

const FIELD = "cf:0a1b2c3d-0000-4000-8000-00000000f001";
const BASE: LayoutBase = {
  defaults: [
    { key: "client", label: "Trademark owner", pinned: true },
    { key: "mark", label: "Trademark" },
    { key: "status", label: "Status" },
    { key: "notes", label: "Notes" },
    { key: FIELD, label: "Priority" },
  ],
};
const col = (key: string, over: Partial<Layout[number]> = {}): Layout[number] => ({ key, label: null, hidden: false, width: null, ...over });
const SAVED: Layout = [col("client"), col("status"), col("mark", { hidden: true }), col("notes"), col(FIELD)];

type Over = Partial<{
  owner: OwnerState | (() => Promise<OwnerState>);
  read: unknown;
  reads: unknown[];
  base: LayoutBase | null;
  insert: (view: string, org: string, cols: Layout) => Promise<{ error: unknown }>;
  update: (view: string, cols: Layout, rev: number) => Promise<{ error: unknown; rev?: number | null }>;
}>;

function deps(over: Over = {}) {
  const reads = [...(over.reads ?? [])];
  const d = {
    owner: vi.fn(typeof over.owner === "function" ? over.owner : async () => (over.owner ?? "owner") as OwnerState),
    orgId: vi.fn(async () => "org-1"),
    read: vi.fn(async () => (reads.length ? reads.shift() : (over.read ?? { status: "ok", layout: SAVED, rev: 3 }))),
    base: vi.fn(async () => (over.base === undefined ? BASE : over.base)),
    insert: vi.fn(over.insert ?? (async () => ({ error: null }))),
    update: vi.fn(over.update ?? (async (_v: string, _c: Layout, rev: number) => ({ error: null, rev: rev + 1 }))),
    revalidate: vi.fn(),
  };
  return d as typeof d & SaveDeps;
}
const ok = { status: "ok" as const };

describe("who may change a view: an owner membership row, asked first", () => {
  for (const state of ["not-owner", "unreadable"] as const)
    it(`${state}: refused before any read or write`, async () => {
      const d = deps({ owner: state });
      expect(await changeLayout(d, "review_list_trademarks", { op: "hide", key: "mark" }, 3)).toEqual({ ok: false, error: W.LAYOUT_OWNER_ONLY });
      for (const spy of [d.read, d.base, d.orgId, d.insert, d.update]) expect(spy).not.toHaveBeenCalled();
    });
  it("a throwing owner check is not an owner", async () => {
    const d = deps({ owner: async () => Promise.reject(new Error("down")) });
    expect(await changeLayout(d, "review_list_trademarks", { op: "hide", key: "mark" }, 3)).toEqual({ ok: false, error: W.LAYOUT_OWNER_ONLY });
    expect(d.update).not.toHaveBeenCalled();
  });
  it("re-asked on every call", async () => {
    const answers: OwnerState[] = ["owner", "not-owner"];
    const d = deps({ owner: async () => answers.shift() ?? "not-owner" });
    expect((await changeLayout(d, "review_list_trademarks", { op: "show", key: "mark" }, 3)).ok).toBe(true);
    expect(await changeLayout(d, "review_list_trademarks", { op: "show", key: "mark" }, 3)).toEqual({ ok: false, error: W.LAYOUT_OWNER_ONLY });
    expect(d.owner).toHaveBeenCalledTimes(2);
  });
});

describe("what the browser may send", () => {
  it("an unknown view, a malformed operation or a bad rev changes nothing", async () => {
    const d = deps();
    for (const [view, op, rev] of [
      ["pipeline_board", { op: "hide", key: "mark" }, 3],
      ["review_list_trademarks", { op: "delete", key: "mark" }, 3],
      ["review_list_trademarks", { op: "hide" }, 3],
      ["review_list_trademarks", { op: "hide", key: "Not A Key!" }, 3],
      ["review_list_trademarks", { op: "move", key: "mark", dir: "up" }, 3],
      ["review_list_trademarks", { op: "hide", key: "mark" }, 0],
      ["review_list_trademarks", { op: "hide", key: "mark" }, "3"],
      ["review_list_trademarks", [], 3],
      ["review_list_trademarks", null, 3],
    ] as const) {
      const out = await changeLayout(d, view, op, rev);
      expect(out.ok).toBe(false);
    }
    expect(d.read).not.toHaveBeenCalled();
    expect(d.update).not.toHaveBeenCalled();
    expect(d.insert).not.toHaveBeenCalled();
  });
  it("a whole layout posted as the operation is not an operation", () => {
    expect(parseOp({ columns: SAVED })).toBeNull();
    expect(parseOp({ op: "hide", key: "mark", columns: [] })).toEqual({ op: "hide", key: "mark" });
  });
  it("parseRev: null or a positive whole number", () => {
    expect(parseRev(null)).toEqual({ ok: true, rev: null });
    expect(parseRev(2)).toEqual({ ok: true, rev: 2 });
    for (const bad of [0, -1, 1.5, "1", NaN, {}]) expect(parseRev(bad)).toEqual({ ok: false });
  });
});

describe("an update: built from the saved layout by the helpers, fenced on rev", () => {
  it("rename: only the label changes, written once with the rev read", async () => {
    const d = deps();
    expect(await changeLayout(d, "review_list_trademarks", { op: "rename", key: "status", label: "  Where it stands " }, 3)).toEqual({ ok: true, rev: 4 });
    expect(d.update).toHaveBeenCalledTimes(1);
    const [view, cols, rev] = d.update.mock.calls[0] as unknown as [string, Layout, number];
    expect(view).toBe("review_list_trademarks");
    expect(rev).toBe(3);
    expect(cols.map((c) => c.key)).toEqual(SAVED.map((c) => c.key));
    expect(cols.find((c) => c.key === "status")).toEqual(col("status", { label: "Where it stands" }));
    expect(d.insert).not.toHaveBeenCalled();
    expect(d.revalidate).toHaveBeenCalledTimes(1);
  });
  it("hide, show and move build on the firm's order (hidden stay hidden)", async () => {
    const hide = deps();
    await changeLayout(hide, "review_list_trademarks", { op: "hide", key: "notes" }, 3);
    expect((hide.update.mock.calls[0] as unknown as [string, Layout])[1].find((c) => c.key === "notes")!.hidden).toBe(true);
    const move = deps();
    await changeLayout(move, "review_list_trademarks", { op: "move", key: "notes", dir: "left" }, 3);
    // "mark" is hidden, so "notes" steps over it and lands before "status", where the change is seen.
    expect((move.update.mock.calls[0] as unknown as [string, Layout])[1].map((c) => c.key)).toEqual(["client", "notes", "status", "mark", FIELD]);
  });
  it("a column the base has but the saved layout lacks is part of the current layout (a new firm column)", () => {
    const cur = currentLayout(BASE, [col("client"), col("status")]);
    expect(cur.map((c) => c.key)).toEqual(["client", "status", "mark", "notes", FIELD]);
  });
  it("a stale rev: refused with the fixed sentence, nothing written", async () => {
    const d = deps({ read: { ...ok, layout: SAVED, rev: 5 } });
    expect(await changeLayout(d, "review_list_trademarks", { op: "hide", key: "mark" }, 3)).toEqual({ ok: false, error: W.LAYOUT_CHANGED });
    expect(d.update).not.toHaveBeenCalled();
  });
  it("the fence matching no row (someone saved between the read and the write): the same sentence", async () => {
    const d = deps({ update: async () => ({ error: null, rev: null }) });
    expect(await changeLayout(d, "review_list_trademarks", { op: "hide", key: "mark" }, 3)).toEqual({ ok: false, error: W.LAYOUT_CHANGED });
    expect(d.revalidate).not.toHaveBeenCalled();
  });
  it("a refused helper answers its own sentence and writes nothing", async () => {
    const d = deps();
    expect(await changeLayout(d, "review_list_trademarks", { op: "hide", key: "client" }, 3)).toEqual({ ok: false, error: W.LAYOUT_COLUMN_PINNED });
    expect(await changeLayout(d, "review_list_trademarks", { op: "rename", key: "status", label: "a\tb" }, 3)).toEqual({ ok: false, error: W.LAYOUT_NAME_CHARACTERS });
    expect(await changeLayout(d, "review_list_trademarks", { op: "rename", key: "gone", label: "x" }, 3)).toEqual({ ok: false, error: W.LAYOUT_COLUMN_GONE });
    expect(await changeLayout(d, "review_list_trademarks", { op: "move", key: "client", dir: "right" }, 3)).toEqual({ ok: false, error: W.LAYOUT_COLUMN_PINNED });
    expect(d.update).not.toHaveBeenCalled();
  });
  it("renaming a column to its built-in name clears the override", async () => {
    const d = deps({ read: { ...ok, layout: [col("client"), col("status", { label: "Stage" }), col("mark"), col("notes"), col(FIELD)], rev: 3 } });
    await changeLayout(d, "review_list_trademarks", { op: "rename", key: "status", label: "Status" }, 3);
    expect((d.update.mock.calls[0] as unknown as [string, Layout])[1].find((c) => c.key === "status")!.label).toBeNull();
  });
});

describe("an insert (no saved row yet)", () => {
  const none = { ...ok, layout: null, rev: null };
  it("inserts the whole current layout once with the active org, not an update", async () => {
    const d = deps({ read: none });
    expect(await changeLayout(d, "review_list_trademarks", { op: "rename", key: "mark", label: "Brand" }, null)).toEqual({ ok: true, rev: 1 });
    expect(d.insert).toHaveBeenCalledTimes(1);
    const [view, org, cols] = d.insert.mock.calls[0] as unknown as [string, string, Layout];
    expect([view, org]).toEqual(["review_list_trademarks", "org-1"]);
    expect(cols.map((c) => c.key)).toEqual(BASE.defaults.map((d) => d.key));
    expect(d.update).not.toHaveBeenCalled();
  });
  it("the browser saw a row but there is none now: changed", async () => {
    const d = deps({ read: none });
    expect(await changeLayout(d, "review_list_trademarks", { op: "hide", key: "mark" }, 2)).toEqual({ ok: false, error: W.LAYOUT_CHANGED });
    expect(d.insert).not.toHaveBeenCalled();
  });
  it("23505 (another owner created it at the same moment): re-read, apply the same operation to THEIR layout, update fenced on their rev, once", async () => {
    const theirs = [col("client"), col("mark"), col("status", { label: "Theirs" }), col("notes"), col(FIELD)];
    const d = deps({ reads: [none, { ...ok, layout: theirs, rev: 1 }], insert: async () => ({ error: { code: "23505" } }) });
    expect(await changeLayout(d, "review_list_trademarks", { op: "hide", key: "notes" }, null)).toEqual({ ok: true, rev: 2 });
    expect(d.insert).toHaveBeenCalledTimes(1);
    expect(d.update).toHaveBeenCalledTimes(1);
    const [, cols, rev] = d.update.mock.calls[0] as unknown as [string, Layout, number];
    expect(rev).toBe(1);
    expect(cols.find((c) => c.key === "status")!.label).toBe("Theirs");
    expect(cols.find((c) => c.key === "notes")!.hidden).toBe(true);
  });
  it("23505 twice: changed, no loop", async () => {
    const d = deps({ read: none, insert: async () => ({ error: { code: "23505" } }) });
    expect(await changeLayout(d, "review_list_trademarks", { op: "hide", key: "notes" }, null)).toEqual({ ok: false, error: W.LAYOUT_CHANGED });
    expect(d.insert).toHaveBeenCalledTimes(2);
  });
});

describe("reads and failures: three states and fixed sentences", () => {
  it("not set up: the not-ready sentence, nothing written", async () => {
    const d = deps({ read: { status: "not-set-up" } });
    expect(await changeLayout(d, "review_list_trademarks", { op: "hide", key: "mark" }, null)).toEqual({ ok: false, error: W.LAYOUT_NOT_READY });
    expect(d.insert).not.toHaveBeenCalled();
  });
  it("unavailable, a throwing read and an unreadable base: couldn't read, nothing written", async () => {
    for (const d of [deps({ read: { status: "unavailable" } }), deps({ base: null })]) {
      expect(await changeLayout(d, "review_list_trademarks", { op: "hide", key: "mark" }, 3)).toEqual({ ok: false, error: W.LAYOUT_READ_FAILED });
      expect(d.update).not.toHaveBeenCalled();
    }
    const throwing = deps();
    throwing.read.mockRejectedValue(new Error("boom"));
    expect(await changeLayout(throwing, "review_list_trademarks", { op: "hide", key: "mark" }, 3)).toEqual({ ok: false, error: W.LAYOUT_READ_FAILED });
  });
  it("writeFailure maps by code only: missing table, RLS, deadlock, anything else; never the message", () => {
    expect(writeFailure({ code: "42P01", message: "relation crm_view_layout does not exist" })).toBe(W.LAYOUT_NOT_READY);
    expect(writeFailure({ code: "PGRST205" })).toBe(W.LAYOUT_NOT_READY);
    expect(writeFailure({ code: "42501", message: "new row violates row-level security policy" })).toBe(W.LAYOUT_OWNER_ONLY);
    expect(writeFailure({ code: "40P01" })).toBe(W.LAYOUT_CHANGED);
    expect(writeFailure({ code: "23503", message: "view_layout_unknown_field: secret" })).toBe(W.LAYOUT_SAVE_FAILED);
    expect(writeFailure(new Error("secret internals"))).toBe(W.LAYOUT_SAVE_FAILED);
  });
  it("a refused write (RLS says not an owner) answers the owner sentence, with no database text", async () => {
    const d = deps({ update: async () => ({ error: { code: "42501", message: "permission denied for table crm_view_layout" } }) });
    const out = await changeLayout(d, "review_list_trademarks", { op: "hide", key: "mark" }, 3);
    expect(out).toEqual({ ok: false, error: W.LAYOUT_OWNER_ONLY });
  });
  it("a throwing write is a fixed sentence", async () => {
    const d = deps({ update: async () => Promise.reject(new Error("socket hang up")) });
    expect(await changeLayout(d, "review_list_trademarks", { op: "hide", key: "mark" }, 3)).toEqual({ ok: false, error: W.LAYOUT_SAVE_FAILED });
  });
});

describe("insert a new firm column", () => {
  it("lifts the appended column out and places it beside the chosen one", () => {
    const cur = currentLayout(BASE, [col("client"), col("mark"), col("status"), col("notes")]);
    expect(cur.at(-1)!.key).toBe(FIELD);
    const next = applyOp(cur, { op: "insert", key: FIELD, relativeTo: "mark", side: "right" }, BASE);
    expect(next.ok && next.layout.map((c) => c.key)).toEqual(["client", "mark", FIELD, "status", "notes"]);
    const left = applyOp(cur, { op: "insert", key: FIELD, relativeTo: "mark", side: "left" }, BASE);
    expect(left.ok && left.layout.map((c) => c.key)).toEqual(["client", FIELD, "mark", "status", "notes"]);
  });
  it("never to the left of the pinned column, and never a key the viewer doesn't have", () => {
    const cur = currentLayout(BASE, null);
    expect(applyOp(cur, { op: "insert", key: FIELD, relativeTo: "client", side: "left" }, BASE)).toEqual({ ok: false, reason: "pinned" });
    expect(applyOp(cur, { op: "insert", key: "cf:0a1b2c3d-0000-4000-8000-00000000f999", relativeTo: "mark", side: "right" }, BASE)).toEqual({ ok: false, reason: "unknown-column" });
  });
});

describe("moveBeside through the write", () => {
  it("parses only well-formed shapes", () => {
    expect(parseOp({ op: "moveBeside", key: "mark", relativeTo: "status", side: "left" })).toEqual({ op: "moveBeside", key: "mark", relativeTo: "status", side: "left" });
    expect(parseOp({ op: "moveBeside", key: "mark", relativeTo: "Bad Key", side: "left" })).toBeNull();
    expect(parseOp({ op: "moveBeside", key: "mark", relativeTo: "status", side: "up" })).toBeNull();
    expect(parseOp({ op: "moveBeside", key: "mark", side: "left" })).toBeNull();
  });
  it("the server checks both keys are in the current layout and writes the one move", async () => {
    const d = deps();
    expect(await changeLayout(d, "review_list_trademarks", { op: "moveBeside", key: "notes", relativeTo: "status", side: "left" }, 3)).toEqual({ ok: true, rev: 4 });
    expect((d.update.mock.calls[0] as unknown as [string, Layout])[1].map((x) => x.key)).toEqual(["client", "notes", "status", "mark", FIELD]);
    const bad = deps();
    expect(await changeLayout(bad, "review_list_trademarks", { op: "moveBeside", key: "notes", relativeTo: "other_section", side: "left" }, 3)).toEqual({ ok: false, error: W.LAYOUT_COLUMN_GONE });
    expect(await changeLayout(bad, "review_list_trademarks", { op: "moveBeside", key: "status", relativeTo: "client", side: "left" }, 3)).toEqual({ ok: false, error: W.LAYOUT_COLUMN_PINNED });
    expect(bad.update).not.toHaveBeenCalled();
  });
});
