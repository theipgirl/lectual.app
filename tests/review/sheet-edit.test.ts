import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  growHeight,
  normalizeNextStepTitle,
  EDITABLE_COLUMNS,
  EMPTY_SHEET_STATE,
  LOCKED_COLUMNS,
  READ_ONLY_PERMS,
  SHEET_EDIT_COLUMNS,
  cellEditable,
  cellKey,
  DEFAULT_COL_WIDTHS,
  NEXT_MIN_WIDTH,
  colWidth,
  sheetMinWidth,
  courtOf,
  nextEditableCell,
  notePost,
  parseSizes,
  postFor,
  sheetLeadStages,
  sheetReducer,
  shownRow,
  type SheetEditRow,
  type SheetPerms,
} from "@/lib/review/sheet-edit";
import { courtTarget, laneOf, withCourt } from "@/lib/review/lanes";
import { row } from "./fixtures";

const ID = "00000000-0000-4000-8000-000000000001";
const TASK = "00000000-0000-4000-8000-000000000003";
const STAGE = "00000000-0000-4000-8000-000000000009";
const U1 = "00000000-0000-4000-8000-0000000000a1";
const U2 = "00000000-0000-4000-8000-0000000000a2";

function sheetRow(over: Partial<SheetEditRow> = {}): SheetEditRow {
  return {
    key: "matter:1",
    kind: "matter",
    id: ID,
    client: "Acme",
    mark: null,
    openHref: "/dashboard/review/?view=sheet&open=matter%3A1",
    stageId: null,
    stageLabel: "Filed",
    nextStep: { id: TASK, title: "Call back", dueDate: "2026-11-20", assigneeId: U1 },
    assignedTo: U2,
    source: null,
    waitingText: "Us",
    contactText: "Nov 5",
    contactIsDate: true,
    contactTitle: null,
    ...over,
  };
}

const OWNER: SheetPerms = { writeMatter: true, writeLead: true, moveLead: true, matterStages: [{ id: STAGE, name: "Filed" }], leadStages: [{ id: STAGE, name: "Consult", category: "open" }] };

describe("each editable cell posts to an existing review action", () => {
  it("Status: a matter -> moveStage; a lead's open stage -> moveStage; lost / nurture -> closeLead", () => {
    expect(postFor(sheetRow(), { col: "status", stageId: STAGE, stageLabel: "Filed" })).toEqual({ action: "moveStage", fields: { kind: "matter", id: ID, stageId: STAGE } });
    const lead = sheetRow({ kind: "lead" });
    expect(postFor(lead, { col: "status", stageId: STAGE, stageLabel: "Consult" }, { id: STAGE, name: "Consult", category: "open" })?.action).toBe("moveStage");
    expect(postFor(lead, { col: "status", stageId: STAGE, stageLabel: "Lost" }, { id: STAGE, name: "Lost", category: "lost" })).toEqual({ action: "closeLead", fields: { id: ID, stageId: STAGE } });
    expect(postFor(lead, { col: "status", stageId: STAGE, stageLabel: "Nurture" }, { id: STAGE, name: "Nurture", category: "nurture" })?.action).toBe("closeLead");
  });

  it("refuses a won stage for a lead (nothing is posted), and never offers one", () => {
    const lead = sheetRow({ kind: "lead" });
    expect(postFor(lead, { col: "status", stageId: STAGE, stageLabel: "Hired" }, { id: STAGE, name: "Hired", category: "won" })).toBeNull();
    const offered = sheetLeadStages([
      { id: "a", name: "New", category: "open" },
      { id: "b", name: "Hired", category: "won" },
      { id: "c", name: "Lost", category: "lost" },
      { id: "d", name: "Later", category: "nurture" },
    ]);
    expect(offered.map((s) => s.name)).toEqual(["New", "Lost", "Later"]);
  });

  it("Next step: the existing step through updateNextStep, else a new one through setNextStep", () => {
    expect(postFor(sheetRow(), { col: "next", title: "Send it", dueDate: "2026-11-14" })).toEqual({ action: "updateNextStep", fields: { taskId: TASK, title: "Send it", dueAt: "2026-11-14" } });
    expect(postFor(sheetRow({ nextStep: null }), { col: "next", title: "Send it", dueDate: null })).toEqual({ action: "setNextStep", fields: { kind: "matter", id: ID, title: "Send it", dueAt: "" } });
  });

  it("Whose court follows the lane rule: the step's assignee when there is a step, else the record's", () => {
    expect(postFor(sheetRow(), { col: "court", userId: U2 })).toEqual({ action: "updateNextStep", fields: { taskId: TASK, assigneeId: U2 } });
    expect(postFor(sheetRow({ nextStep: null }), { col: "court", userId: U1 })).toEqual({ action: "assignRecord", fields: { kind: "matter", id: ID, userId: U1 } });
    expect(postFor(sheetRow({ nextStep: null }), { col: "court", userId: null })?.fields.userId).toBe("");
    // A step added a moment ago (no id yet) posts nothing rather than changing the record's assignee by mistake.
    expect(postFor(sheetRow({ nextStep: { id: "", title: "x", dueDate: null, assigneeId: null } }), { col: "court", userId: U1 })).toBeNull();
  });

  it("the lane helpers in lanes.ts are the one rule: courtTarget / withCourt agree with laneOf", () => {
    const withStep = row({ nextStep: { id: "t", title: "x", dueDate: null, assigneeId: U1 }, assignedTo: U2 });
    expect(courtTarget(withStep)).toBe("step");
    expect(laneOf(withCourt(withStep, U2))).toBe(U2);
    expect(withCourt(withStep, U2).assignedTo).toBe(U2);
    const noStep = row({ nextStep: null, assignedTo: U2 });
    expect(courtTarget(noStep)).toBe("record");
    expect(laneOf(withCourt(noStep, U1))).toBe(U1);
    expect(laneOf(withCourt(noStep, null))).toBeNull();
    expect(courtOf(sheetRow())).toBe(U1);
  });

  it("Source -> setSource; + Note -> logWhatHappened", () => {
    expect(postFor(sheetRow({ kind: "lead" }), { col: "source", source: "Referral" })).toEqual({ action: "setSource", fields: { kind: "lead", id: ID, source: "Referral" } });
    expect(postFor(sheetRow(), { col: "source", source: null })?.fields.source).toBe("");
    expect(notePost(sheetRow(), "Called")).toEqual({ action: "logWhatHappened", fields: { kind: "matter", id: ID, body: "Called" } });
  });
});

describe("who may edit what", () => {
  it("locked columns, the client link and the mark never get an editor", () => {
    for (const col of [...LOCKED_COLUMNS, "client", "mark"] as const) {
      expect(cellEditable(col, "matter", OWNER)).toBe(false);
      expect(cellEditable(col, "lead", OWNER)).toBe(false);
    }
    expect(SHEET_EDIT_COLUMNS.filter((c) => cellEditable(c, "matter", OWNER))).toEqual([...EDITABLE_COLUMNS]);
  });

  it("read-only roles get no editors at all", () => {
    for (const col of SHEET_EDIT_COLUMNS) for (const kind of ["matter", "lead"] as const) expect(cellEditable(col, kind, READ_ONLY_PERMS)).toBe(false);
  });

  it("a lead's Status needs the move-stage role; an unreadable stage list gives no Status editor", () => {
    const noMove = { ...OWNER, moveLead: false };
    expect(cellEditable("status", "lead", noMove)).toBe(false);
    expect(cellEditable("next", "lead", noMove)).toBe(true);
    expect(cellEditable("status", "matter", { ...OWNER, matterStages: null })).toBe(false);
    expect(cellEditable("status", "matter", { ...OWNER, matterStages: [] })).toBe(false);
  });
});

describe("save state: a refused save puts the old value back", () => {
  const value = { col: "next" as const, title: "New", dueDate: "2026-11-14" };
  const cell = cellKey("matter:1", "next");

  it("shows the typed value while saving, says Saved only after ok", () => {
    let s = sheetReducer(EMPTY_SHEET_STATE, { type: "start", cell, seq: 1, value, client: "Acme", field: "next" });
    expect(shownRow(sheetRow(), s).nextStep?.title).toBe("New");
    expect(s.status?.tone).toBe("saving");
    s = sheetReducer(s, { type: "saved", cell, seq: 1, client: "Acme", field: "next" });
    expect(s.status).toEqual({ tone: "saved", client: "Acme", field: "next" });
    expect(shownRow(sheetRow(), s).nextStep?.title).toBe("New");
  });

  it("a failure reverts the cell and carries the action's sentence", () => {
    let s = sheetReducer(EMPTY_SHEET_STATE, { type: "start", cell, seq: 1, value, client: "Acme", field: "next" });
    s = sheetReducer(s, { type: "failed", cell, seq: 1, client: "Acme", field: "next", message: "You don't have permission to change this." });
    expect(shownRow(sheetRow(), s).nextStep?.title).toBe("Call back");
    expect(s.status).toMatchObject({ tone: "error", message: "You don't have permission to change this." });
    expect(s.saving).toEqual({});
  });

  it("an older answer for the same cell is ignored", () => {
    let s = sheetReducer(EMPTY_SHEET_STATE, { type: "start", cell, seq: 1, value, client: "Acme", field: "next" });
    s = sheetReducer(s, { type: "start", cell, seq: 2, value: { ...value, title: "Newer" }, client: "Acme", field: "next" });
    s = sheetReducer(s, { type: "failed", cell, seq: 1, client: "Acme", field: "next", message: "x" });
    expect(shownRow(sheetRow(), s).nextStep?.title).toBe("Newer");
  });

  it("fresh rows from the server replace saved overrides, keep the ones still saving", () => {
    let s = sheetReducer(EMPTY_SHEET_STATE, { type: "start", cell, seq: 1, value, client: "Acme", field: "next" });
    s = sheetReducer(s, { type: "start", cell: cellKey("matter:1", "source"), seq: 2, value: { col: "source", source: "Referral" }, client: "Acme", field: "source" });
    s = sheetReducer(s, { type: "saved", cell, seq: 1, client: "Acme", field: "next" });
    s = sheetReducer(s, { type: "refreshed" });
    expect(Object.keys(s.overrides)).toEqual([cellKey("matter:1", "source")]);
  });

  it("Whose court shown while saving follows the lane rule", () => {
    const s = sheetReducer(EMPTY_SHEET_STATE, { type: "start", cell: cellKey("matter:1", "court"), seq: 1, value: { col: "court", userId: U2 }, client: "Acme", field: "court" });
    const shown = shownRow(sheetRow(), s);
    expect(shown.nextStep?.assigneeId).toBe(U2);
    expect(shown.assignedTo).toBe(U2);
    expect(courtOf(shown)).toBe(U2);
  });
});

describe("Tab and sizes", () => {
  it("Tab walks editable cells row by row, skipping what the viewer can't edit", () => {
    const rows = [{ key: "a", kind: "matter" as const }, { key: "b", kind: "lead" as const }];
    const perms = { ...OWNER, moveLead: false };
    expect(nextEditableCell(rows, { rowKey: "a", col: "status" }, perms)).toEqual({ rowKey: "a", col: "next" });
    expect(nextEditableCell(rows, { rowKey: "a", col: "source" }, perms)).toEqual({ rowKey: "b", col: "next" });
    expect(nextEditableCell(rows, { rowKey: "b", col: "next" }, perms, -1)).toEqual({ rowKey: "a", col: "source" });
    expect(nextEditableCell(rows, { rowKey: "b", col: "source" }, perms)).toBeNull();
  });

  it("stored widths are read defensively and clamped", () => {
    expect(parseSizes(null)).toEqual({ cols: {}, rows: {} });
    expect(parseSizes("{not json")).toEqual({ cols: {}, rows: {} });
    expect(parseSizes(JSON.stringify({ cols: { next: 9999, nope: 10, court: "x" }, rows: { "matter:1": 5, "bad key!": 50 } }))).toEqual({ cols: { next: 640 }, rows: { "matter:1": 40 } });
  });
});

describe("default column widths", () => {
  it("are the director's defaults, with Next step flexible", () => {
    expect(DEFAULT_COL_WIDTHS).toEqual({ client: 140, mark: 130, status: 130, next: null, court: 110, waiting: 140, source: 100, contact: 84 });
    expect(NEXT_MIN_WIDTH).toBe(200);
  });
  it("a stored width overrides the default; nothing stored reads the default", () => {
    expect(colWidth(parseSizes(null), "client")).toBe(140);
    expect(colWidth(parseSizes(null), "next")).toBeNull();
    const stored = parseSizes(JSON.stringify({ cols: { client: 220, next: 400 } }));
    expect(colWidth(stored, "client")).toBe(220);
    expect(colWidth(stored, "next")).toBe(400);
    expect(colWidth(stored, "mark")).toBe(130);
  });
  it("the table's minimum is the sum, Next step counted at 200 and the note column only while editing", () => {
    expect(sheetMinWidth(parseSizes(null), false)).toBe(140 + 130 + 130 + 200 + 110 + 140 + 100 + 84);
    expect(sheetMinWidth(parseSizes(null), true)).toBe(1034 + 76);
  });
});

describe("setSourceAction (the Sheet's Source cell)", () => {
  const setReferralSource = vi.fn(async () => ({}));
  const updateMatterHeader = vi.fn(async () => ({}));
  let role = "owner";
  let visible = true;
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    role = "owner";
    visible = true;
    vi.doMock("next/cache", () => ({ revalidatePath: vi.fn() }));
    vi.doMock("@/lib/db/scoped-client", () => ({
      getScopedClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: visible ? { id: ID } : null, error: null }) }) }) }) }),
    }));
    vi.doMock("@/lib/pipeline", () => ({ CAN_WRITE_LEAD: ["owner", "attorney"], CAN_MOVE_STAGE: ["owner"], resolveCurrentRole: async () => role }));
    vi.doMock("@/lib/matters/matters", () => ({ MATTER_WRITE_ROLES: ["owner", "attorney"], updateMatterHeader }));
    vi.doMock("@/lib/intake/leads", () => ({ setReferralSource }));
  });

  it("a lead goes through setReferralSource, a matter through updateMatterHeader (blank clears)", async () => {
    const { setSourceAction } = await import("../../src/app/dashboard/review/actions");
    expect(await setSourceAction({}, fd({ kind: "lead", id: ID, source: "Referral" }))).toEqual({ saved: true });
    expect(setReferralSource).toHaveBeenCalledWith(ID, "Referral");
    expect(await setSourceAction({}, fd({ kind: "matter", id: ID, source: "Website" }))).toEqual({ saved: true });
    expect(updateMatterHeader).toHaveBeenCalledWith(ID, { referralSource: "Website" });
    await setSourceAction({}, fd({ kind: "lead", id: ID, source: "" }));
    expect(setReferralSource).toHaveBeenLastCalledWith(ID, null);
  });

  it("refuses a read-only role, a free-text source and an invisible record, writing nothing", async () => {
    const { setSourceAction } = await import("../../src/app/dashboard/review/actions");
    expect((await setSourceAction({}, fd({ kind: "lead", id: ID, source: "Made up" }))).error).toBe("That isn't one of the sources.");
    role = "viewer";
    expect((await setSourceAction({}, fd({ kind: "matter", id: ID, source: "Website" }))).error).toMatch(/permission/);
    role = "owner";
    visible = false;
    expect((await setSourceAction({}, fd({ kind: "matter", id: ID, source: "Website" }))).error).toMatch(/couldn't be found/);
    expect(setReferralSource).not.toHaveBeenCalled();
    expect(updateMatterHeader).not.toHaveBeenCalled();
  });
});

describe("a new next step saved twice before the refresh is not posted twice", () => {
  const cell = cellKey("matter:1", "next");
  const A = { col: "next" as const, title: "Step A", dueDate: "2026-11-14" };
  const B = { col: "next" as const, title: "Step B", dueDate: null };

  it("the stand-in step (no id yet) posts nothing, so setNextStep is never sent a second time", () => {
    const server = sheetRow({ nextStep: null });
    // First save: no step -> setNextStep.
    expect(postFor(server, A)?.action).toBe("setNextStep");
    let s = sheetReducer(EMPTY_SHEET_STATE, { type: "start", cell, seq: 1, value: A, client: "Acme", field: "next" });
    s = sheetReducer(s, { type: "saved", cell, seq: 1, client: "Acme", field: "next", serverHas: false });
    // The page hasn't read the new step back: the row shows a stand-in with an empty id.
    const shown = shownRow(server, s);
    expect(shown.nextStep).toMatchObject({ id: "", title: "Step A" });
    // Second save before the refresh: nothing is posted (the table says "try after refresh").
    expect(postFor(shown, B)).toBeNull();
  });

  it("once the refresh brings the real step, the next save updates it", () => {
    let s = sheetReducer(EMPTY_SHEET_STATE, { type: "start", cell, seq: 1, value: A, client: "Acme", field: "next" });
    s = sheetReducer(s, { type: "saved", cell, seq: 1, client: "Acme", field: "next", serverHas: false });
    s = sheetReducer(s, { type: "refreshed" });
    const fresh = sheetRow({ nextStep: { id: TASK, title: "Step A", dueDate: "2026-11-14", assigneeId: null } });
    expect(postFor(shownRow(fresh, s), B)).toEqual({ action: "updateNextStep", fields: { taskId: TASK, title: "Step B", dueAt: "" } });
  });
});

describe("a saved value never outlives its save", () => {
  const value = { col: "next" as const, title: "New", dueDate: "2026-11-14" };
  const cell = cellKey("matter:1", "next");
  const before = sheetRow();
  const after = sheetRow({ nextStep: { id: TASK, title: "New", dueDate: "2026-11-14", assigneeId: U1 } });

  it("rowHolds: the server row reads the value (a stand-in next step never counts)", async () => {
    const { rowHolds } = await import("@/lib/review/sheet-edit");
    expect(rowHolds(after, value)).toBe(true);
    expect(rowHolds(before, value)).toBe(false);
    expect(rowHolds(sheetRow({ nextStep: { id: "", title: "New", dueDate: "2026-11-14", assigneeId: null } }), value)).toBe(false);
    expect(rowHolds(sheetRow({ stageId: STAGE }), { col: "status", stageId: STAGE, stageLabel: "Filed" })).toBe(true);
    expect(rowHolds(sheetRow({ source: "Referral" }), { col: "source", source: "Referral" })).toBe(true);
    expect(rowHolds(sheetRow(), { col: "court", userId: U1 })).toBe(true);
    expect(rowHolds(sheetRow(), { col: "court", userId: U2 })).toBe(false);
  });

  it("refreshed (the tree with the save) then saved: no override is left", () => {
    let s = sheetReducer(EMPTY_SHEET_STATE, { type: "start", cell, seq: 1, value, client: "Acme", field: "next" });
    s = sheetReducer(s, { type: "refreshed" });
    expect(s.overrides[cell]).toEqual(value); // still saving: kept, no flash of the old value
    s = sheetReducer(s, { type: "saved", cell, seq: 1, client: "Acme", field: "next", serverHas: true });
    expect(s.overrides).toEqual({});
    expect(s.saving).toEqual({});
    expect(shownRow(after, s).nextStep?.title).toBe("New");
  });

  it("then a colleague's change (or a different stored value) shows, not the typed one", () => {
    let s = sheetReducer(EMPTY_SHEET_STATE, { type: "start", cell, seq: 1, value, client: "Acme", field: "next" });
    s = sheetReducer(s, { type: "refreshed" });
    s = sheetReducer(s, { type: "saved", cell, seq: 1, client: "Acme", field: "next", serverHas: true });
    const colleague = sheetRow({ nextStep: { id: TASK, title: "Colleague's step", dueDate: null, assigneeId: U1 } });
    expect(shownRow(colleague, s).nextStep?.title).toBe("Colleague's step");
  });

  it("a stale tree landing during the save keeps the typed value until rows read after the write arrive", () => {
    let s = sheetReducer(EMPTY_SHEET_STATE, { type: "start", cell, seq: 1, value, client: "Acme", field: "next" });
    s = sheetReducer(s, { type: "refreshed" }); // an earlier save's tree, without this write
    s = sheetReducer(s, { type: "saved", cell, seq: 1, client: "Acme", field: "next", serverHas: false });
    expect(shownRow(before, s).nextStep?.title).toBe("New"); // never flashes "Call back"
    s = sheetReducer(s, { type: "refreshed" }); // the rows the table asked for after the save
    expect(s.overrides).toEqual({});
    expect(shownRow(after, s).nextStep?.title).toBe("New");
  });

  it("saved then refreshed: the server's value shows", () => {
    let s = sheetReducer(EMPTY_SHEET_STATE, { type: "start", cell, seq: 1, value, client: "Acme", field: "next" });
    s = sheetReducer(s, { type: "saved", cell, seq: 1, client: "Acme", field: "next", serverHas: false });
    expect(shownRow(before, s).nextStep?.title).toBe("New"); // no flash before the tree arrives
    s = sheetReducer(s, { type: "refreshed" });
    expect(s.overrides).toEqual({});
    const stored = sheetRow({ nextStep: { id: TASK, title: "New (as stored)", dueDate: "2026-11-14", assigneeId: U1 } });
    expect(shownRow(stored, s).nextStep?.title).toBe("New (as stored)");
  });

  it("a refused save still reverts, whichever order the tree comes in", () => {
    let s = sheetReducer(EMPTY_SHEET_STATE, { type: "start", cell, seq: 1, value, client: "Acme", field: "next" });
    s = sheetReducer(s, { type: "refreshed" });
    s = sheetReducer(s, { type: "failed", cell, seq: 1, client: "Acme", field: "next", message: "No." });
    expect(s.overrides).toEqual({});
    expect(shownRow(before, s).nextStep?.title).toBe("Call back");
  });
});

describe("next step title field", () => {
  it("keeps a single line break, drops blank lines and edge spaces", () => {
    expect(normalizeNextStepTitle("  Follow up \r\n  on the proposal \n\n\n and send  ")).toBe("Follow up\non the proposal\nand send");
    expect(normalizeNextStepTitle("one line")).toBe("one line");
    expect(normalizeNextStepTitle(" \n ")).toBe("");
  });
  it("grows to its content between 2 and 4 lines", () => {
    expect(growHeight(10, 21, 18)).toBe(60);
    expect(growHeight(70, 21, 18)).toBe(70);
    expect(growHeight(400, 21, 18)).toBe(102);
  });
});
