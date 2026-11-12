import { describe, it, expect } from "vitest";
import { EMPTY_DIRTY, anyDirty, dirtyReducer } from "@/lib/proposal-editor/unsaved";

/** Sprint 1: ONE marker for the whole edit page (no per-section ids). */
describe("dirtyReducer (one page-level marker)", () => {
  it("typing, adding a row and removing a row each mark the page unsaved", () => {
    for (const type of ["edit", "rowAdded", "rowRemoved"] as const) {
      expect(anyDirty(dirtyReducer(EMPTY_DIRTY, { type }))).toBe(true);
    }
  });
  it("a successful save clears it; a refusal does not", () => {
    const dirty = dirtyReducer(EMPTY_DIRTY, { type: "edit" });
    expect(anyDirty(dirtyReducer(dirty, { type: "refused" }))).toBe(true);
    expect(anyDirty(dirtyReducer(dirty, { type: "saved" }))).toBe(false);
  });
  it("returns the same object when nothing changes", () => {
    const dirty = dirtyReducer(EMPTY_DIRTY, { type: "edit" });
    expect(dirtyReducer(dirty, { type: "edit" })).toBe(dirty);
    expect(dirtyReducer(EMPTY_DIRTY, { type: "saved" })).toBe(EMPTY_DIRTY);
    expect(dirtyReducer(EMPTY_DIRTY, { type: "refused" })).toBe(EMPTY_DIRTY);
  });
});
