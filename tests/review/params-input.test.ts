import { describe, expect, it } from "vitest";
import { applyReviewFilters, isMine, parseReviewParams, reviewHref } from "@/lib/review/params";
import { parseNextStep, parseWhatHappened } from "@/lib/review/input";
import { criticalAlert, detailsNote } from "@/lib/review/notes";
import { dueText, lastContactText, shortDate } from "@/lib/review/format";
import { row, TODAY } from "./fixtures";

const ID = "00000000-0000-4000-8000-000000000001";
const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });

describe("params", () => {
  it("defaults and parsing", () => {
    expect(parseReviewParams({})).toEqual({ since: "default", who: "all", kind: "both", q: "", view: "board", i: 1, person: null, open: null });
    expect(parseReviewParams({ view: "sheet" })).toMatchObject({ view: "sheet" });
    expect(parseReviewParams({ who: "mine", kind: "leads", q: "  a  b ", view: "cards", i: "4" })).toEqual({ since: "default", who: "mine", kind: "lead", q: "a b", view: "cards", i: 4, person: null, open: null });
    expect(parseReviewParams({ view: "nope", i: "-3", kind: "x" })).toMatchObject({ view: "board", i: 1, kind: "both" });
    for (const old of ["agenda", "meeting", "stage"]) expect(parseReviewParams({ view: old }).view).toBe("board");
  });
  it("href round-trips and omits defaults", () => {
    expect(reviewHref(parseReviewParams({}))).toBe("/dashboard/review/");
    expect(reviewHref(parseReviewParams({ view: "board" }))).toBe("/dashboard/review/");
    expect(reviewHref(parseReviewParams({ view: "sheet" }))).toBe("/dashboard/review/?view=sheet");
    expect(parseReviewParams(Object.fromEntries(new URL(reviewHref(parseReviewParams({ view: "sheet" })), "http://x").searchParams)).view).toBe("sheet");
    const p = parseReviewParams({ who: "mine", kind: "matters", q: "x", view: "cards", i: "3" });
    expect(parseReviewParams(Object.fromEntries(new URL(reviewHref(p), "http://x").searchParams))).toEqual(p);
  });
  it("filters: mine, kind, search", () => {
    const rows = [
      row({ key: "a", client: "Acme", assignedTo: "me" }),
      row({ key: "b", client: "Beta", kind: "lead", nextStep: { id: "t", title: "x", dueDate: null, assigneeId: "me" } }),
      row({ key: "c", client: "Gamma", mark: "ACMEX" }),
    ];
    const p = (o: object) => parseReviewParams(o);
    expect(isMine(rows[1], "me")).toBe(true);
    expect(isMine(rows[0], null)).toBe(false);
    expect(applyReviewFilters(rows, p({ who: "mine" }), "me").map((r) => r.key)).toEqual(["a", "b"]);
    expect(applyReviewFilters(rows, p({ kind: "leads" }), "me").map((r) => r.key)).toEqual(["b"]);
    expect(applyReviewFilters(rows, p({ q: "acme" }), "me").map((r) => r.key)).toEqual(["a", "c"]);
  });
});

describe("input", () => {
  it("next step", () => {
    expect(parseNextStep(form({ kind: "matter", id: ID, title: " Call ", dueAt: "2026-11-05", assigneeId: ID }))).toEqual({
      ok: true, value: { kind: "matter", id: ID, title: "Call", dueAt: "2026-11-05", assigneeId: ID },
    });
    expect(parseNextStep(form({ kind: "lead", id: ID, title: "x" }))).toMatchObject({ ok: true, value: { dueAt: null, assigneeId: null } });
  });
  it.each([
    [{ kind: "x", id: ID, title: "a" }],
    [{ kind: "lead", id: "nope", title: "a" }],
    [{ kind: "lead", id: ID, title: "  " }],
    [{ kind: "lead", id: ID, title: "a".repeat(201) }],
    [{ kind: "lead", id: ID, title: "a", dueAt: "2026-02-31" }],
    [{ kind: "lead", id: ID, title: "a", assigneeId: "bad" }],
  ])("rejects %j", (o) => expect(parseNextStep(form(o)).ok).toBe(false));
  it("note", () => {
    expect(parseWhatHappened(form({ kind: "lead", id: ID, body: " hi " }))).toMatchObject({ ok: true, value: { body: "hi" } });
    expect(parseWhatHappened(form({ kind: "lead", id: ID, body: "" })).ok).toBe(false);
    expect(parseWhatHappened(form({ kind: "lead", id: ID, body: "a".repeat(5001) })).ok).toBe(false);
  });
});

describe("copy", () => {
  it("notes name the sources, never an error", () => {
    expect(detailsNote([])).toBeNull();
    expect(detailsNote(["deadlines", "approvals"])).toBe("Some details couldn't load (deadlines, approvals). Refresh to try again.");
    expect(criticalAlert(["tasks"])).toContain("tasks couldn't load");
  });
  it("dates", () => {
    expect(shortDate("2026-10-30", TODAY)).toBe("Oct 30");
    expect(shortDate("2025-10-30", TODAY)).toBe("Oct 30, 2025");
    expect(dueText(null, TODAY)).toEqual({ text: "No date set", overdue: false });
    expect(dueText("2026-10-30", TODAY)).toEqual({ text: "Overdue since Oct 30", overdue: true });
    expect(dueText(TODAY, TODAY).text).toBe("Due today");
    expect(lastContactText({ contactKnown: true, lastContact: { date: "2026-10-28", type: "email_received" } }, TODAY)).toBe("Oct 28 · they replied");
    expect(lastContactText({ contactKnown: true, lastContact: null }, TODAY)).toBe("No contact recorded");
    expect(lastContactText({ contactKnown: false, lastContact: null }, TODAY)).toBe("Couldn't load");
  });
});
