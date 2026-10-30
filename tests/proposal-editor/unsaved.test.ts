import { describe, it, expect } from "vitest";
import {
  EMPTY_DIRTY,
  anyDirty,
  blockingSentence,
  dirtyReducer,
  finishButtonState,
  isDirty,
  unsavedLabels,
} from "@/lib/proposal-editor/unsaved";

describe("dirtyReducer", () => {
  it("marks a section unsaved, cleans only that one, and resets", () => {
    let s = dirtyReducer(EMPTY_DIRTY, { type: "dirty", id: "pe-name-p1-n1", label: "The Fold" });
    s = dirtyReducer(s, { type: "dirty", id: "pe-details-p1", label: "Client" });
    expect(unsavedLabels(s)).toEqual(["The Fold", "Client"]);
    expect(isDirty(s, "pe-name-p1-n1")).toBe(true);
    s = dirtyReducer(s, { type: "clean", id: "pe-name-p1-n1" });
    expect(unsavedLabels(s)).toEqual(["Client"]);
    expect(anyDirty(dirtyReducer(s, { type: "reset" }))).toBe(false);
  });
  it("returns the same object when nothing changes", () => {
    const s = dirtyReducer(EMPTY_DIRTY, { type: "dirty", id: "a", label: "A" });
    expect(dirtyReducer(s, { type: "dirty", id: "a", label: "A" })).toBe(s);
    expect(dirtyReducer(s, { type: "clean", id: "zzz" })).toBe(s);
    expect(dirtyReducer(EMPTY_DIRTY, { type: "reset" })).toBe(EMPTY_DIRTY);
  });
  it("ignores an event with no form id", () => {
    expect(dirtyReducer(EMPTY_DIRTY, { type: "dirty", id: "", label: "X" })).toBe(EMPTY_DIRTY);
  });
});

describe("blockingSentence", () => {
  it("is null when nothing is unsaved", () => expect(blockingSentence([])).toBeNull());
  it("names one or several sections", () => {
    expect(blockingSentence(["The Fold"])).toBe("Save your changes to The Fold first.");
    expect(blockingSentence(["The Fold", "Client"])).toBe("Save your changes to The Fold and Client first.");
    expect(blockingSentence(["A", "B", "C"])).toBe("Save your changes to A, B and C first.");
  });
});

describe("finishButtonState", () => {
  it("is enabled when saved, no errors and not pending", () => {
    expect(finishButtonState({ pending: false, blockingErrors: 0, unsavedLabels: [] })).toEqual({ disabled: false, sentence: null });
  });
  it("is disabled, with the sentence, while anything is unsaved", () => {
    const r = finishButtonState({ pending: false, unsavedLabels: ["The Fold"] });
    expect(r.disabled).toBe(true);
    expect(r.sentence).toBe("Save your changes to The Fold first.");
  });
  it("stays disabled for blocking errors or a pending call", () => {
    expect(finishButtonState({ pending: false, blockingErrors: 2, unsavedLabels: [] }).disabled).toBe(true);
    expect(finishButtonState({ pending: true, unsavedLabels: [] }).disabled).toBe(true);
  });
});
