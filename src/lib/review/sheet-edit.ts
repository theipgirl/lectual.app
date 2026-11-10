import type { ReviewKind, ReviewNextStep, ReviewRow } from "./buckets";
import { courtTarget, laneOf, withCourt } from "./lanes";

/**
 * The owner view's editable Sheet. Pure: which cells a person may edit, which EXISTING review action each edit posts to
 * (with which fields), the save/revert state of the table, Tab order between editable cells, and the per-viewer column
 * widths kept in browser storage. No database, no React. The actions re-check everything on the server; this only decides
 * what is DRAWN and what is POSTED.
 */

/** Columns, in table order. Four are typed by a person; Waiting on and Last contact are worked out and never edited here. */
export const SHEET_EDIT_COLUMNS = ["client", "mark", "status", "next", "court", "waiting", "source", "contact"] as const;
export type SheetEditColumn = (typeof SHEET_EDIT_COLUMNS)[number];
export const EDITABLE_COLUMNS = ["status", "next", "court", "source"] as const;
export type EditableColumn = (typeof EDITABLE_COLUMNS)[number];
export const LOCKED_COLUMNS = ["waiting", "contact"] as const satisfies readonly SheetEditColumn[];

export function isEditableColumn(col: string): col is EditableColumn {
  return (EDITABLE_COLUMNS as readonly string[]).includes(col);
}

export type StageChoice = { id: string; name: string; /** A lead stage's category; absent for a matter's docket stage. */ category?: string | null };

/** The stages a lead may be moved to from the Sheet: open, lost and nurture, never `won` (that move runs the matter handoff). */
export function sheetLeadStages(stages: readonly { id: string; name: string | null; category: string | null }[]): StageChoice[] {
  return stages
    .filter((s): s is { id: string; name: string; category: string } => !!s.name && (s.category === "open" || s.category === "lost" || s.category === "nurture"))
    .map((s) => ({ id: s.id, name: s.name, category: s.category }));
}

/** Who may edit what. The page computes these from the role it re-resolved; a stage list that couldn't be read is null. */
export type SheetPerms = {
  /** MATTER_WRITE_ROLES */
  writeMatter: boolean;
  /** CAN_WRITE_LEAD */
  writeLead: boolean;
  /** CAN_MOVE_STAGE and CAN_WRITE_LEAD (a lead's stage move needs both) */
  moveLead: boolean;
  matterStages: StageChoice[] | null;
  leadStages: StageChoice[] | null;
};

export const READ_ONLY_PERMS: SheetPerms = { writeMatter: false, writeLead: false, moveLead: false, matterStages: null, leadStages: null };

export function canWriteRow(kind: ReviewKind, perms: SheetPerms): boolean {
  return kind === "matter" ? perms.writeMatter : perms.writeLead;
}

export function stageChoices(kind: ReviewKind, perms: SheetPerms): StageChoice[] | null {
  return kind === "matter" ? perms.matterStages : perms.leadStages;
}

/** Whether a cell gets an editor. Locked columns, the client link and the mark never do. */
export function cellEditable(col: SheetEditColumn, kind: ReviewKind, perms: SheetPerms): boolean {
  if (!isEditableColumn(col)) return false;
  if (col === "status") {
    const choices = stageChoices(kind, perms);
    if (!choices || choices.length === 0) return false;
    return kind === "matter" ? perms.writeMatter : perms.moveLead;
  }
  return canWriteRow(kind, perms);
}

/** Whether "+ Note" is drawn on a row. */
export function canNote(kind: ReviewKind, perms: SheetPerms): boolean {
  return canWriteRow(kind, perms);
}

/** What the Sheet holds per row: the facts the server worked out plus the four typed values. */
export type SheetEditRow = {
  key: string;
  kind: ReviewKind;
  id: string;
  client: string;
  mark: string | null;
  /** The review URL with this record's panel open (the Client link, and every edit on a phone). */
  openHref: string;
  stageId: string | null;
  stageLabel: string | null;
  nextStep: ReviewNextStep | null;
  assignedTo: string | null;
  source: string | null;
  /** Locked, computed: "Us", "Client · followed up Nov 4", ... */
  waitingText: string;
  /** Locked, computed: a short date when known, else the fixed sentence. */
  contactText: string;
  contactIsDate: boolean;
  contactTitle: string | null;
};

/** The typed value of one cell, as the editor saves it and the table draws it. */
export type CellValue =
  | { col: "status"; stageId: string; stageLabel: string }
  | { col: "next"; title: string; dueDate: string | null }
  | { col: "court"; userId: string | null }
  | { col: "source"; source: string | null };

/** The row as it reads with any saved-or-saving values laid over it. */
export function applyValue(row: SheetEditRow, value: CellValue): SheetEditRow {
  switch (value.col) {
    case "status":
      return { ...row, stageId: value.stageId, stageLabel: value.stageLabel };
    case "next":
      return { ...row, nextStep: row.nextStep ? { ...row.nextStep, title: value.title, dueDate: value.dueDate } : { id: "", title: value.title, dueDate: value.dueDate, assigneeId: null } };
    case "court":
      return withCourt(row, value.userId);
    case "source":
      return { ...row, source: value.source };
  }
}

/**
 * Whether the server's row already reads `value` in that cell. A next step counts only when it is a real step (an id),
 * so a stand-in never passes for the saved one.
 */
export function rowHolds(row: SheetEditRow, value: CellValue): boolean {
  switch (value.col) {
    case "status":
      return row.stageId === value.stageId;
    case "next":
      return !!row.nextStep?.id && row.nextStep.title === value.title && (row.nextStep.dueDate ?? null) === (value.dueDate ?? null);
    case "court":
      return courtOf(row) === value.userId;
    case "source":
      return (row.source ?? null) === (value.source ?? null);
  }
}

/** Whose court, by the lane rule (`laneOf`). */
export function courtOf(row: Pick<SheetEditRow, "nextStep" | "assignedTo">): string | null {
  return laneOf(row);
}

export type SheetActionName = "moveStage" | "closeLead" | "updateNextStep" | "setNextStep" | "assignRecord" | "setSource" | "logWhatHappened";
export type SheetPost = { action: SheetActionName; fields: Record<string, string> };

/**
 * Which existing review action an edit posts to, and with which fields. Status: a matter -> `moveStage` (the docket move);
 * a lead -> `moveStage` for an open stage, `closeLead` for a lost / nurture one (Lost / Nurture keep their own rules), and
 * nothing at all for a `won` stage (refused here, and again by the action). Next step: `updateNextStep` on the existing
 * step, else `setNextStep`. Whose court: the step's assignee through `updateNextStep` when there is a step, else the
 * record's through `assignRecord` (`courtTarget`, the lane rule). Source: `setSource`. Returns null when nothing may be posted.
 */
export function postFor(row: Pick<SheetEditRow, "kind" | "id" | "nextStep">, value: CellValue, stage?: StageChoice | null): SheetPost | null {
  const base = { kind: row.kind, id: row.id };
  switch (value.col) {
    case "status": {
      if (row.kind === "lead") {
        const category = stage?.category ?? null;
        if (category === "won") return null;
        if (category === "lost" || category === "nurture") return { action: "closeLead", fields: { id: row.id, stageId: value.stageId } };
      }
      return { action: "moveStage", fields: { ...base, stageId: value.stageId } };
    }
    case "next":
      // A step added a moment ago is a stand-in with no id until the page reads it back: posting `setNextStep` again would
      // leave two open steps, so nothing is posted (the "try after refresh" sentence), as Whose court does below.
      if (row.nextStep && !row.nextStep.id) return null;
      return row.nextStep
        ? { action: "updateNextStep", fields: { taskId: row.nextStep.id, title: value.title, dueAt: value.dueDate ?? "" } }
        : { action: "setNextStep", fields: { ...base, title: value.title, dueAt: value.dueDate ?? "" } };
    case "court":
      if (courtTarget(row) === "record") return { action: "assignRecord", fields: { ...base, userId: value.userId ?? "" } };
      // A step added a moment ago has no id until the page reads it back: nothing is posted rather than the wrong person changed.
      return row.nextStep?.id ? { action: "updateNextStep", fields: { taskId: row.nextStep.id, assigneeId: value.userId ?? "" } } : null;
    case "source":
      return { action: "setSource", fields: { ...base, source: value.source ?? "" } };
  }
}

/** "+ Note": the existing "Log what happened" path (a plain timeline note that counts as last contact). */
export function notePost(row: Pick<SheetEditRow, "kind" | "id">, body: string): SheetPost {
  return { action: "logWhatHappened", fields: { kind: row.kind, id: row.id, body } };
}

/** The field name in the "Saved · <client>, <field>" line. */
export const FIELD_WORDS: Record<EditableColumn | "note", string> = { status: "status", next: "next step", court: "whose court", source: "source", note: "note" };

/* ── Save state: nothing is shown as saved until the server says so; a refusal puts the old value back ── */

export type SheetStatus = { tone: "saving" | "saved" | "error"; client: string; field: EditableColumn | "note"; message?: string };
export type SheetEditState = {
  /**
   * Values laid over the server's rows while saving, and after a save until rows that read the saved value arrive
   * (`saved` with `serverHas`, or the next `refreshed`). Key: `<row key>|<col>`.
   */
  overrides: Record<string, CellValue>;
  /** The newest save per cell; an older answer for the same cell is ignored. */
  seq: Record<string, number>;
  saving: Record<string, true>;
  status: SheetStatus | null;
};

export const EMPTY_SHEET_STATE: SheetEditState = { overrides: {}, seq: {}, saving: {}, status: null };

export type SheetEvent =
  | { type: "start"; cell: string; seq: number; value: CellValue; client: string; field: EditableColumn }
  /**
   * `serverHas`: the server rows on screen when the answer came already read the saved value (`rowHolds`), i.e. the
   * revalidated tree landed while the cell was saving. Then the override goes now. Otherwise it stays (no longer saving)
   * until the next fresh rows, which the table asks for, so the old value never flashes back in between.
   */
  | { type: "saved"; cell: string; seq: number; client: string; field: EditableColumn | "note"; serverHas?: boolean }
  | { type: "failed"; cell: string; seq: number; client: string; field: EditableColumn | "note"; message: string }
  | { type: "note-saved"; client: string }
  | { type: "note-failed"; client: string; message: string }
  /** Fresh rows came from the server: they are the truth now. */
  | { type: "refreshed" };

export function cellKey(rowKey: string, col: EditableColumn): string {
  return `${rowKey}|${col}`;
}

function without<T>(rec: Record<string, T>, key: string): Record<string, T> {
  const out = { ...rec };
  delete out[key];
  return out;
}

export function sheetReducer(state: SheetEditState, event: SheetEvent): SheetEditState {
  switch (event.type) {
    case "start":
      return {
        overrides: { ...state.overrides, [event.cell]: event.value },
        seq: { ...state.seq, [event.cell]: event.seq },
        saving: { ...state.saving, [event.cell]: true },
        status: { tone: "saving", client: event.client, field: event.field },
      };
    case "saved":
      if (state.seq[event.cell] !== event.seq) return state;
      return {
        ...state,
        overrides: event.serverHas ? without(state.overrides, event.cell) : state.overrides,
        saving: without(state.saving, event.cell),
        status: { tone: "saved", client: event.client, field: event.field },
      };
    case "failed":
      if (state.seq[event.cell] !== event.seq) return state;
      // The value the person typed is taken off: the cell reads what the server holds again.
      return { ...state, overrides: without(state.overrides, event.cell), saving: without(state.saving, event.cell), status: { tone: "error", client: event.client, field: event.field, message: event.message } };
    case "note-saved":
      return { ...state, status: { tone: "saved", client: event.client, field: "note" } };
    case "note-failed":
      return { ...state, status: { tone: "error", client: event.client, field: "note", message: event.message } };
    case "refreshed": {
      // Keep only what is still being saved; everything else now comes from the server's rows.
      const overrides: Record<string, CellValue> = {};
      for (const k of Object.keys(state.saving)) if (state.overrides[k]) overrides[k] = state.overrides[k];
      return { ...state, overrides };
    }
  }
}

/** The row with the overrides of its cells laid over it. */
export function shownRow(row: SheetEditRow, state: Pick<SheetEditState, "overrides">): SheetEditRow {
  let out = row;
  for (const col of EDITABLE_COLUMNS) {
    const v = state.overrides[cellKey(row.key, col)];
    if (v) out = applyValue(out, v);
  }
  return out;
}

/* ── Tab: the next (or previous) editable cell, row by row ── */

export function nextEditableCell(
  rows: readonly Pick<SheetEditRow, "key" | "kind">[],
  from: { rowKey: string; col: EditableColumn },
  perms: SheetPerms,
  dir: 1 | -1 = 1,
): { rowKey: string; col: EditableColumn } | null {
  const cells: { rowKey: string; col: EditableColumn }[] = [];
  for (const r of rows) for (const col of EDITABLE_COLUMNS) if (cellEditable(col, r.kind, perms)) cells.push({ rowKey: r.key, col });
  const at = cells.findIndex((c) => c.rowKey === from.rowKey && c.col === from.col);
  if (at < 0) return cells[dir === 1 ? 0 : cells.length - 1] ?? null;
  return cells[at + dir] ?? null;
}

/* ── Column widths and row heights: a per-viewer convenience in browser storage, never shared, never required ── */

export const SHEET_SIZES_KEY = "lx-review-sheet-sizes";
export const MIN_COL = 72;
export const MAX_COL = 640;
export const MIN_ROW = 40;
export const MAX_ROW = 320;
export type SheetSizes = { cols: Partial<Record<SheetEditColumn, number>>; rows: Record<string, number> };
export const NO_SIZES: SheetSizes = { cols: {}, rows: {} };

/** Default column widths in px. Next step is flexible (no fixed width) and never narrower than `NEXT_MIN_WIDTH`. A stored width overrides these. */
export const DEFAULT_COL_WIDTHS: Record<SheetEditColumn, number | null> = {
  client: 140,
  mark: 130,
  status: 130,
  next: null,
  court: 110,
  waiting: 140,
  source: 100,
  contact: 84,
};
/** With the Note column the defaults and this minimum sum to 1,110px, which fits the content area at 1440 with the rail open (1,114px). */
export const NEXT_MIN_WIDTH = 200;
/** The "+ Note" column, drawn only while editing. */
export const NOTE_COL_WIDTH = 76;

/** The width a column is drawn at: this viewer's stored width, else the default; null = flexible (Next step). */
export function colWidth(sizes: Pick<SheetSizes, "cols">, col: SheetEditColumn): number | null {
  return sizes.cols[col] ?? DEFAULT_COL_WIDTHS[col];
}

/** The narrowest the table may get before it scrolls sideways inside its card (flexible Next step counted at its minimum). */
export function sheetMinWidth(sizes: Pick<SheetSizes, "cols">, withNote: boolean): number {
  let total = withNote ? NOTE_COL_WIDTH : 0;
  for (const c of SHEET_EDIT_COLUMNS) total += colWidth(sizes, c) ?? NEXT_MIN_WIDTH;
  return total;
}

export function clampSize(n: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, n)));
}

/** Reads what was stored; anything malformed is dropped, never trusted. */
export function parseSizes(raw: string | null | undefined): SheetSizes {
  if (!raw) return NO_SIZES;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return NO_SIZES;
  }
  if (!data || typeof data !== "object") return NO_SIZES;
  const out: SheetSizes = { cols: {}, rows: {} };
  const cols = (data as { cols?: unknown }).cols;
  if (cols && typeof cols === "object") {
    for (const c of SHEET_EDIT_COLUMNS) {
      const v = (cols as Record<string, unknown>)[c];
      if (typeof v === "number" && Number.isFinite(v)) out.cols[c] = clampSize(v, MIN_COL, MAX_COL);
    }
  }
  const rows = (data as { rows?: unknown }).rows;
  if (rows && typeof rows === "object") {
    for (const [k, v] of Object.entries(rows as Record<string, unknown>).slice(0, 500)) {
      if (/^[A-Za-z0-9:_-]{1,80}$/.test(k) && typeof v === "number" && Number.isFinite(v)) out.rows[k] = clampSize(v, MIN_ROW, MAX_ROW);
    }
  }
  return out;
}

/** Initials for a person's avatar in the picker ("Rebecca Ames" -> "RA"). */
export function personInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] ?? "" : "")).toUpperCase();
}

/** The picker's search: case-insensitive on the name and the role label. */
export function matchPeople<T extends { name: string; roleLabel: string }>(people: readonly T[], term: string): T[] {
  const t = term.trim().toLowerCase();
  if (!t) return [...people];
  return people.filter((p) => p.name.toLowerCase().includes(t) || p.roleLabel.toLowerCase().includes(t));
}

/** Kept here so the client never needs the whole ReviewRow type. */
export type SheetRowSource = Pick<ReviewRow, "key" | "kind" | "id" | "client" | "mark" | "stageId" | "stageLabel" | "nextStep" | "assignedTo" | "source">;
