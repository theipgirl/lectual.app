import { describe, expect, it, vi } from "vitest";
import { addColumn, type AddColumnDeps } from "@/lib/views/layout/add-column";
import * as W from "@/lib/ui/words";

const ID = "0A1B2C3D-0000-4000-8000-00000000F001";
const input = { view: "review_list_trademarks", rev: 2, relativeTo: "mark", side: "right", label: "Priority", section: "trademarks", kind: "text", choices: "" };

function deps(over: Partial<AddColumnDeps> = {}) {
  return {
    createField: vi.fn(async () => ({ state: { saved: true }, id: ID })),
    changeLayout: vi.fn(async () => ({ ok: true as const, rev: 3 })),
    ...over,
  } as AddColumnDeps & { createField: ReturnType<typeof vi.fn>; changeLayout: ReturnType<typeof vi.fn> };
}

describe("Add a column: the field and its place, in one action", () => {
  it("creates the field, then places its lowercase cf: key beside the chosen column with the rev the page drew", async () => {
    const d = deps();
    expect(await addColumn(d, input)).toEqual({ ok: true, rev: 3, placed: true });
    expect(d.createField).toHaveBeenCalledWith({ label: "Priority", section: "trademarks", kind: "text", choices: "" });
    expect(d.changeLayout).toHaveBeenCalledWith("review_list_trademarks", { op: "insert", key: "cf:0a1b2c3d-0000-4000-8000-00000000f001", relativeTo: "mark", side: "right" }, 2);
  });
  it("a refused field (the owner sentence, a clash, a bad kind) is the answer, and nothing is placed", async () => {
    const d = deps({ createField: vi.fn(async () => ({ state: { error: W.COLUMNS_NO_PERMISSION }, id: null })) });
    expect(await addColumn(d, input)).toEqual({ ok: false, error: W.COLUMNS_NO_PERMISSION });
    expect(d.changeLayout).not.toHaveBeenCalled();
  });
  it("the field made but its place not saved: still ok, said once, with a fixed sentence", async () => {
    const d = deps({ changeLayout: vi.fn(async () => ({ ok: false as const, error: W.LAYOUT_CHANGED })) });
    expect(await addColumn(d, input)).toEqual({ ok: true, rev: null, placed: false, note: W.LAYOUT_PLACE_NOT_SAVED });
  });
  it("a throwing layout write, or a field with no id, is the same", async () => {
    const throwing = deps({ changeLayout: vi.fn(async () => Promise.reject(new Error("x"))) });
    expect(await addColumn(throwing, input)).toMatchObject({ ok: true, placed: false, note: W.LAYOUT_PLACE_NOT_SAVED });
    const noId = deps({ createField: vi.fn(async () => ({ state: { saved: true }, id: null })) });
    expect(await addColumn(noId, input)).toMatchObject({ ok: true, placed: false });
    expect(noId.changeLayout).not.toHaveBeenCalled();
  });
  it("a bad view or side is refused before a field is made", async () => {
    const d = deps();
    expect((await addColumn(d, { ...input, view: "nope" })).ok).toBe(false);
    // only a List section takes a new column: the Board and every other view are refused before createField
    for (const view of ["review_board", "matters_board", "contracts_board", "leads_list", "review_list"]) expect((await addColumn(d, { ...input, view })).ok, view).toBe(false);
    expect((await addColumn(d, { ...input, side: "up" })).ok).toBe(false);
    expect((await addColumn(d, { ...input, relativeTo: 4 })).ok).toBe(false);
    expect(d.createField).not.toHaveBeenCalled();
  });
  it("the Matters and Contracts Lists take a new column, placed in their own layout", async () => {
    for (const view of ["matters_list", "contracts_list"]) {
      const d = deps();
      expect(await addColumn(d, { ...input, view }), view).toEqual({ ok: true, rev: 3, placed: true });
      expect(d.changeLayout).toHaveBeenCalledWith(view, expect.objectContaining({ op: "insert", relativeTo: "mark" }), 2);
    }
  });
  it("a throwing field create is a fixed sentence", async () => {
    const d = deps({ createField: vi.fn(async () => Promise.reject(new Error("db down"))) });
    expect(await addColumn(d, input)).toEqual({ ok: false, error: W.CUSTOM_SAVE_FAILED });
  });
});
