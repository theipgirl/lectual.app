import type { ReviewKind, ReviewNextStep, ReviewRow } from "./buckets";
import { courtTarget, laneOf, withCourt } from "./lanes";
import { isCustomColumnId, type BuiltinColumnId, type ColumnId, type CustomColumnId } from "./sheet-columns";
import type { FactCell, FactCells } from "./sheet-cells";
import type { NoteCell } from "./sheet-notes";
import { BLANK, CUSTOM_FROM_LEAD_KEPT, CUSTOM_FROM_MERGED_KEPT } from "@/lib/ui/words";

/**
 * The owner view's editable Sheet. Pure: which cells a person may edit, which EXISTING review action each edit posts to
 * (with which fields), the save/revert state of the table, Tab order between editable cells, and the per-viewer column
 * widths kept in browser storage. No database, no React. The actions re-check everything on the server; this only decides
 * what is DRAWN and what is POSTED.
 */

/**
 * Every column the Sheet can draw (the registry's, `sheet-columns.ts`; the section decides which and in what order). Four are typed
 * by a person through a picker; Notes shows the newest plain note and a writer types a new one in place (its own inline editor, not a
 * picker); every other one is worked out and never edited here. The Owner column keeps its editor id `court` (this file's
 * tests and the `data-rse-cell="<row>|court"` hooks are pinned to it); the registry calls it `owner` (`editColumnOf`).
 */
export const SHEET_EDIT_COLUMNS = ["client", "mark", "practiceArea", "serial", "status", "next", "court", "source", "notes", "start", "legalFee", "legalFeeDue", "govFee", "govFeeDue", "oaDue", "waiting", "contact"] as const;
export type SheetEditColumn = (typeof SHEET_EDIT_COLUMNS)[number];

/** A column the Sheet draws and sizes: one of its own, or a firm's custom column. */
export type SizedColumn = SheetEditColumn | CustomColumnId;

/** The registry's id as this file's column id (a firm's custom column keeps its `cf:` id). */
export function editColumnOf(id: BuiltinColumnId): SheetEditColumn;
export function editColumnOf(id: ColumnId): SizedColumn;
export function editColumnOf(id: ColumnId): SizedColumn {
  if (isCustomColumnId(id)) return id;
  return id === "owner" ? "court" : id;
}

/** The key the Sheet draws and sizes a registry column by: `editColumnOf` for any id. */
export function sizeKeyOf(id: ColumnId): SizedColumn {
  return editColumnOf(id);
}
/** The spreadsheet's four typed columns. A firm's custom column (`cf:<id>`) is typed too (Sprint 3). */
export const EDITABLE_COLUMNS = ["status", "next", "court", "source"] as const;
export type BuiltinEditableColumn = (typeof EDITABLE_COLUMNS)[number];
export type EditableColumn = BuiltinEditableColumn | CustomColumnId;
export const LOCKED_COLUMNS = ["waiting", "contact"] as const satisfies readonly SheetEditColumn[];

export function isEditableColumn(col: string): col is EditableColumn {
  return (EDITABLE_COLUMNS as readonly string[]).includes(col) || isCustomColumnId(col);
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
  /** CUSTOM_VALUE_WRITE_ROLES: may type in the firm's own columns. Absent = no. */
  writeCustom?: boolean;
};

export const READ_ONLY_PERMS: SheetPerms = { writeMatter: false, writeLead: false, moveLead: false, matterStages: null, leadStages: null };

export function canWriteRow(kind: ReviewKind, perms: SheetPerms): boolean {
  return kind === "matter" ? perms.writeMatter : perms.writeLead;
}

export function stageChoices(kind: ReviewKind, perms: SheetPerms): StageChoice[] | null {
  return kind === "matter" ? perms.matterStages : perms.leadStages;
}

/**
 * Whether a firm's custom column is a live field drawn for this row's section. Built once by the table from the field meta and each
 * row's section; the SAME function goes to the render and to Tab, so the two can never disagree.
 */
export type CustomFit = (col: CustomColumnId, row: Pick<SheetEditRow, "key" | "kind">) => boolean;

/**
 * Whether a cell gets an editor, the ONE predicate (the render and Tab both use it). Locked columns, the client link and the mark never
 * do. A custom column needs `writeCustom` AND a `fit` that says the field is drawn for this row's section.
 */
export function cellEditable(col: SizedColumn, row: Pick<SheetEditRow, "key" | "kind">, perms: SheetPerms, fit?: CustomFit): boolean {
  if (isCustomColumnId(col)) return !!perms.writeCustom && !!fit && fit(col, row);
  if (!isEditableColumn(col)) return false;
  const kind = row.kind;
  if (col === "status") {
    const choices = stageChoices(kind, perms);
    if (!choices || choices.length === 0) return false;
    return kind === "matter" ? perms.writeMatter : perms.moveLead;
  }
  return canWriteRow(kind, perms);
}

/** Whether a row's Notes cell can be typed in (the plain-note write roles). */
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
  /** "3 documents" when the count is known and above 0; absent otherwise (never "0 documents"). */
  documentsText?: string | null;
  /** "Changed by Caitlyn · Nov 16"; null when the last-change read failed (no line is drawn). */
  changedText?: string | null;
  /** The read-only cells of the spreadsheet's other columns (serial, dates, practice area, owner-only fees), worked out by the server. */
  facts?: Partial<FactCells>;
  /** The firm's own columns' cells, by `cf:<field id>`, worked out by the server (absent when there are none to draw). */
  custom?: Record<string, FactCell>;
  /** The record's OWN value per custom column, in the editors' form (null = none). The inherited value is never here. */
  customOwn?: Record<string, string | null>;
  /** What a custom cell shows when the record has no own value (from the lead / a merged duplicate), present either way. */
  customInherited?: Record<string, { from: "lead" | "merged"; cell: FactCell }>;
  /** The Notes cell: the newest plain note, none, or couldn't load. Absent reads as couldn't load (never as "no note"). */
  note?: NoteCell;
};

/** The typed value of one cell, as the editor saves it and the table draws it. */
export type CellValue =
  | { col: "status"; stageId: string; stageLabel: string }
  | { col: "next"; title: string; dueDate: string | null }
  | { col: "court"; userId: string | null }
  | { col: "source"; source: string | null }
  /** A firm's column: what was typed, in the editors' form ("" = clear), and the cell it draws while it saves. */
  | { col: CustomColumnId; raw: string; shown?: FactCell };

const isCustomValue = (v: CellValue): v is Extract<CellValue, { raw: string }> => isCustomColumnId(v.col);

/** A custom cell's own value as held: blank is null. */
const ownOf = (raw: string): string | null => (raw.trim() === "" ? null : raw);

/** The row as it reads with any saved-or-saving values laid over it. */
export function applyValue(row: SheetEditRow, value: CellValue): SheetEditRow {
  if (isCustomValue(value)) {
    const own = ownOf(value.raw);
    const inherited = row.customInherited?.[value.col];
    // A clear draws what still shows without the own value (the lead's, a merged duplicate's, with its title), never "—" in its place.
    const cell: FactCell = own === null ? (inherited ? inherited.cell : { text: BLANK, tone: "none" }) : (value.shown ?? { text: value.raw, tone: "value" });
    return { ...row, customOwn: { ...(row.customOwn ?? {}), [value.col]: own }, custom: { ...(row.custom ?? {}), [value.col]: cell } };
  }
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
  // A custom cell: the record's OWN value only (an inherited value never counts as the saved one).
  if (isCustomValue(value)) return (row.customOwn?.[value.col] ?? null) === ownOf(value.raw);
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

export type SheetActionName = "moveStage" | "closeLead" | "updateNextStep" | "setNextStep" | "assignRecord" | "setSource" | "setCustomValue";
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
  // A firm's column: the value action, with the field, the RECORD kind and id, and what was typed. The server re-checks everything.
  if (isCustomValue(value)) return { action: "setCustomValue", fields: { fieldId: value.col.slice(3), kind: row.kind, id: row.id, value: value.raw } };
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


/** The field name in the "Saved · <client>, <field>" line. */
export const FIELD_WORDS: Record<BuiltinEditableColumn | "note", string> = { status: "status", next: "next step", court: "whose court", source: "source", note: "note" };

/** The field name for any cell: a built-in's word, or a custom column's label (from the field meta; "" when unknown). */
export function fieldWord(col: EditableColumn | "note", labels: Readonly<Record<string, string>>): string {
  return isCustomColumnId(col) ? (labels[col] ?? "") : FIELD_WORDS[col];
}

/**
 * R10: after a CLEAR of a custom cell whose row had an own value AND has an inherited one, the status says the inherited value still
 * shows. Every other save (a value typed, a clear with nothing inherited, a cell that had no own value) gets the plain "Saved" line.
 */
export function keptNote(row: Pick<SheetEditRow, "customOwn" | "customInherited">, value: CellValue): string | undefined {
  if (!isCustomValue(value) || ownOf(value.raw) !== null) return undefined;
  if ((row.customOwn?.[value.col] ?? null) === null) return undefined;
  const inh = row.customInherited?.[value.col];
  if (!inh) return undefined;
  return inh.from === "lead" ? CUSTOM_FROM_LEAD_KEPT : CUSTOM_FROM_MERGED_KEPT;
}

/* ── Save state: nothing is shown as saved until the server says so; a refusal puts the old value back ── */

export type SheetStatus = {
  tone: "saving" | "saved" | "error";
  client: string;
  field: EditableColumn | "note";
  /** The field's name for the status line (a custom column's label); absent = the built-in word. */
  label?: string;
  message?: string;
  /** R10's kept sentence, said in place of "Saved" after a clear that leaves an inherited value showing. */
  note?: string;
};
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
  | { type: "start"; cell: string; seq: number; value: CellValue; client: string; field: EditableColumn; label?: string }
  /**
   * `serverHas`: the server rows on screen when the answer came already read the saved value (`rowHolds`), i.e. the
   * revalidated tree landed while the cell was saving. Then the override goes now. Otherwise it stays (no longer saving)
   * until the next fresh rows, which the table asks for, so the old value never flashes back in between.
   */
  | { type: "saved"; cell: string; seq: number; client: string; field: EditableColumn | "note"; serverHas?: boolean; label?: string; note?: string }
  | { type: "failed"; cell: string; seq: number; client: string; field: EditableColumn | "note"; message: string; label?: string }
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
        status: { tone: "saving", client: event.client, field: event.field, ...(event.label ? { label: event.label } : {}) },
      };
    case "saved":
      if (state.seq[event.cell] !== event.seq) return state;
      return {
        ...state,
        overrides: event.serverHas ? without(state.overrides, event.cell) : state.overrides,
        saving: without(state.saving, event.cell),
        status: { tone: "saved", client: event.client, field: event.field, ...(event.label ? { label: event.label } : {}), ...(event.note ? { note: event.note } : {}) },
      };
    case "failed":
      if (state.seq[event.cell] !== event.seq) return state;
      // The value the person typed is taken off: the cell reads what the server holds again.
      return { ...state, overrides: without(state.overrides, event.cell), saving: without(state.saving, event.cell), status: { tone: "error", client: event.client, field: event.field, message: event.message, ...(event.label ? { label: event.label } : {}) } };
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
  // The firm's columns: every override of this row's custom cells.
  const prefix = `${row.key}|`;
  for (const [k, v] of Object.entries(state.overrides)) if (k.startsWith(prefix) && isCustomColumnId(k.slice(prefix.length))) out = applyValue(out, v);
  return out;
}

/* ── Tab: the next (or previous) editable cell, row by row ── */

/** A cell Tab can land on: a picker cell, a firm's column, or the Notes cell (its own inline editor) where it can be typed in. */
export type TabStop = EditableColumn | "notes";

export function nextEditableCell(
  rows: readonly Pick<SheetEditRow, "key" | "kind">[],
  from: { rowKey: string; col: TabStop },
  perms: SheetPerms,
  dir: 1 | -1 = 1,
  /** The columns a row DRAWS, in drawn order (its section's columns after the chooser). Default: the four built-in typed columns in the fixed order. */
  columnsFor?: (row: Pick<SheetEditRow, "key" | "kind">) => readonly SizedColumn[],
  /** The render's own `fit`: a custom cell is a stop only where the render draws an editor for it. Absent = no custom cell is a stop. */
  fit?: CustomFit,
): { rowKey: string; col: TabStop } | null {
  const cells: { rowKey: string; col: TabStop }[] = [];
  for (const r of rows)
    for (const col of columnsFor ? columnsFor(r) : EDITABLE_COLUMNS) {
      // Notes is a stop only where it is drawn (the caller's columns) and the row's note can be typed (`canNote`, the cell's own rule).
      if (col === "notes") {
        if (canNote(r.kind, perms)) cells.push({ rowKey: r.key, col });
      } else if (isEditableColumn(col) && cellEditable(col, r, perms, fit)) cells.push({ rowKey: r.key, col });
    }
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
export type SheetSizes = { cols: Partial<Record<SizedColumn, number>>; rows: Record<string, number> };
export const NO_SIZES: SheetSizes = { cols: {}, rows: {} };

/** Default column widths in px. Next step is flexible (no fixed width) and never narrower than `NEXT_MIN_WIDTH`. A stored width overrides these. */
export const DEFAULT_COL_WIDTHS: Record<SheetEditColumn, number | null> = {
  client: 140,
  mark: 130,
  practiceArea: 120,
  serial: 100,
  status: 130,
  next: null,
  court: 110,
  source: 100,
  start: 96,
  legalFee: 128,
  legalFeeDue: 128,
  govFee: 128,
  govFeeDue: 128,
  oaDue: 130,
  waiting: 140,
  contact: 84,
  notes: 150,
};
/** A firm's custom column, until this viewer resizes it. */
export const CUSTOM_COL_WIDTH = 140;
/** At most this many stored custom widths are kept (a firm has at most 40 live fields). */
const MAX_CUSTOM_SIZES = 64;
/** Next step's narrowest; each section table scrolls sideways inside its card when the columns it draws are wider than the card. */
export const NEXT_MIN_WIDTH = 200;

/** The width a column is drawn at: this viewer's stored width, else the default; null = flexible (Next step). */
export function colWidth(sizes: Pick<SheetSizes, "cols">, col: SizedColumn): number | null {
  return sizes.cols[col] ?? (isCustomColumnId(col) ? CUSTOM_COL_WIDTH : DEFAULT_COL_WIDTHS[col]);
}

/** The narrowest the table may get before it scrolls sideways inside its card (flexible Next step counted at its minimum). */
export function sheetMinWidth(sizes: Pick<SheetSizes, "cols">, columns: readonly SizedColumn[] = SHEET_EDIT_COLUMNS): number {
  let total = 0;
  for (const c of columns) total += colWidth(sizes, c) ?? NEXT_MIN_WIDTH;
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
    // A firm's custom column keeps its width by its `cf:` id; anything else stored is dropped.
    let kept = 0;
    for (const [k, v] of Object.entries(cols as Record<string, unknown>)) {
      if (kept >= MAX_CUSTOM_SIZES) break;
      if (isCustomColumnId(k) && typeof v === "number" && Number.isFinite(v)) {
        out.cols[k] = clampSize(v, MIN_COL, MAX_COL);
        kept += 1;
      }
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

/** The next step's title as typed in the Sheet's growing field: Windows line breaks become one, spaces around a break go, blank lines collapse to one break, the ends are trimmed. The server also trims and caps at 200 characters; it accepts a line break. */
export function normalizeNextStepTitle(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]*\n[ \t\n]*/g, "\n")
    .trim();
}

/** Height in pixels for the growing title field: its content, but never fewer than `minRows` or more than `maxRows` lines (it scrolls past that). */
export function growHeight(scrollHeight: number, lineHeight: number, chrome: number, minRows = 2, maxRows = 4): number {
  const min = lineHeight * minRows + chrome;
  const max = lineHeight * maxRows + chrome;
  return Math.round(Math.min(max, Math.max(min, scrollHeight)));
}

