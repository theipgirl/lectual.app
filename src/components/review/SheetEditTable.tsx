"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  closeLeadAction,
  moveStageAction,
  assignRecordAction,
  setNextStepAction,
  setSourceAction,
  updateNextStepAction,
  type ReviewActionState,
} from "@/app/dashboard/review/actions";
import { setCustomValueAction } from "@/lib/custom-columns/actions";
import { customUnchanged, editorForm } from "@/lib/custom-columns/input";
import { typedCell } from "@/lib/custom-columns/rules";
import { shortDate } from "@/lib/review/format";
import { Icon } from "@/components/ui/Icon";
import { UNASSIGNED_LANE } from "@/lib/review/lanes";
import {
  EMPTY_SHEET_STATE,
  MAX_COL,
  MAX_ROW,
  MIN_COL,
  NEXT_MIN_WIDTH,
  drawnWidth,
  MIN_ROW,
  NO_SIZES,
  SHEET_SIZES_KEY,
  canNote,
  cellEditable,
  isEditableColumn,
  cellKey,
  clampSize,
  fieldWord,
  keptNote,
  courtOf,
  matchPeople,
  nextEditableCell,
  parseSizes,
  growHeight,
  normalizeNextStepTitle,
  personInitials,
  postFor,
  rowHolds,
  sheetReducer,
  shownRow,
  stageChoices,
  sizeKeyOf,
  type CellValue,
  type CustomFit,
  type EditableColumn,
  type SheetActionName,
  type SheetEditColumn,
  type SizedColumn,
  type SheetEditRow,
  type SheetPerms,
  type SheetSizes,
  type StageChoice,
  type TabStop,
} from "@/lib/review/sheet-edit";
import {
  BLANK,
  OWNER_COLUMN,
  TEAMMATE,
  SHEET_DUE,
  SHEET_EMPTY_SECTION,
  SHEET_ENTER_ESC,
  SHEET_ENTER_TITLE,
  SHEET_FIND_PERSON,
  SHEET_KEYS_CANCEL,
  SHEET_KEYS_EDIT,
  SHEET_KEYS_NEXT,
  SHEET_MOVE_TO_STAGE,
  SHEET_NEXT_STEP,
  SHEET_NO_ONE_FOUND,
  SHEET_NO_SOURCE,
  SHEET_NOTE_NOT_SAVED,
  SHEET_OVERDUE,
  SHEET_RESIZE_ROW,
  SHEET_SAVE_FAILED,
  SHEET_SOURCE_LABEL,
  SHEET_TRY_AFTER_REFRESH,
  sheetMoveLogged,
  sheetResizeColumn,
  CUSTOM_NO_ONE,
  customCellLabel,
  fromLeadHint,
  fromMergedHint,
  noLongerAChoice,
} from "@/lib/ui/words";
import type { PrefsDocument } from "@/lib/review/column-prefs-storage";
import { fieldFits, isCustomColumnId, type CustomColumnId, type CustomKind, type CustomSection, type ColumnId, type CustomStateLike, type SheetColumn, type SheetSectionId } from "@/lib/review/sheet-columns";
import type { CustomMember } from "@/lib/custom-columns/rules";
import { CustomValuePop } from "./CustomValueInput";
import { SectionNote } from "./SectionNote";
import { SheetFactTd } from "./SheetFactTd";
import { useColumnPrefs } from "./use-column-prefs";
import { usePopPlacement } from "./pop-placement";
import { NotesCell } from "./NotesCell";
import { sheetStatusStore } from "./sheet-status-store";
import { SheetCard } from "@/components/ui/SheetTable";
import { ViewTable } from "@/components/views/table/ViewTable";
import { ColumnMenu } from "@/components/views/layout/ColumnMenu";
import { layoutKeyOf } from "@/lib/review/layout";
import { listColumnOf } from "@/lib/review/list-columns";
import "./review-sheet-edit.css";

export type SheetPerson = { userId: string; name: string; /** What the cell shows. */ short: string; roleLabel: string };
export type SheetSection = { id: SheetSectionId; title: string; rows: SheetEditRow[] };
/** What the table knows of a firm's live column, by `cf:<field id>`: enough to draw its editor and to say where it shows. */
export type CustomFieldMeta = { label: string; kind: CustomKind; options: string[]; section: CustomSection };
type OpenCell = { rowKey: string; col: EditableColumn };

/** Drawing-only starting state (a preview harness opens editors with it). The default is everything closed. */
export type SheetEditInitial = {
  open?: OpenCell[];
  /** The next-step editor's text, by row key. */
  nextDraft?: Record<string, { title: string; dueDate: string | null }>;
  /** A column whose resize grip and width tip are shown, and a row whose grip is shown. */
  activeColumn?: SheetEditColumn;
  activeRow?: string;
};

const ACTIONS: Record<SheetActionName, (prev: ReviewActionState, form: FormData) => Promise<ReviewActionState>> = {
  moveStage: (p, f) => moveStageAction(p, f),
  closeLead: (p, f) => closeLeadAction(p, f),
  updateNextStep: (p, f) => updateNextStepAction(p, f),
  setNextStep: (p, f) => setNextStepAction(p, f),
  assignRecord: (p, f) => assignRecordAction(p, f),
  setSource: (p, f) => setSourceAction(p, f),
  setCustomValue: (p, f) => setCustomValueAction(p, f),
};

async function post(action: SheetActionName, fields: Record<string, string>): Promise<{ ok: boolean; message: string | null }> {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  try {
    const res = await ACTIONS[action]({}, form);
    // Lost / Nurture can report "moved, but the reason note failed": the move itself saved.
    if (res.saved) return { ok: true, message: null };
    return { ok: false, message: res.error ?? SHEET_SAVE_FAILED };
  } catch {
    return { ok: false, message: SHEET_SAVE_FAILED };
  }
}

const PHONE = "(max-width: 640px)";
function subscribePhone(cb: () => void) {
  try {
    const m = window.matchMedia(PHONE);
    m.addEventListener("change", cb);
    return () => m.removeEventListener("change", cb);
  } catch {
    return () => {};
  }
}
function isPhone(): boolean {
  try {
    return window.matchMedia(PHONE).matches;
  } catch {
    return false;
  }
}

function readSizes(): SheetSizes {
  try {
    return parseSizes(window.localStorage.getItem(SHEET_SIZES_KEY));
  } catch {
    return NO_SIZES;
  }
}
function writeSizes(sizes: SheetSizes) {
  try {
    window.localStorage.setItem(SHEET_SIZES_KEY, JSON.stringify(sizes));
  } catch {
    // A per-viewer convenience: a browser that refuses storage just doesn't remember the widths.
  }
}

/** Each save gets a number; an older answer for the same cell is then ignored (see sheetReducer). */
let seqCounter = 0;
function nextSeq(): number {
  seqCounter += 1;
  return seqCounter;
}

/** Column widths and row heights for this viewer: read from browser storage once, kept in memory, written on change. */
let sizeCache: SheetSizes | null = null;
const sizeListeners = new Set<() => void>();
const sizeStore = {
  get: (): SheetSizes => (sizeCache ??= readSizes()),
  server: (): SheetSizes => NO_SIZES,
  subscribe(l: () => void) {
    sizeListeners.add(l);
    return () => {
      sizeListeners.delete(l);
    };
  },
  update(next: SheetSizes | ((s: SheetSizes) => SheetSizes)) {
    sizeCache = typeof next === "function" ? next(sizeStore.get()) : next;
    for (const l of sizeListeners) l();
  },
};

function nextText(row: SheetEditRow, today: string): { text: string; overdue: boolean } | null {
  if (!row.nextStep) return null;
  const due = row.nextStep.dueDate;
  return { text: due ? `${row.nextStep.title} · ${shortDate(due, today)}` : row.nextStep.title, overdue: !!due && due < today };
}

export function SheetEditTable({
  sections,
  people,
  perms,
  sources,
  today,
  initial,
  columns,
  initialPrefs,
  noteState = null,
  adminTier = false,
  fieldMeta = {},
  cellMembers = null,
  layoutEdit = null,
}: {
  sections: SheetSection[];
  people: SheetPerson[];
  perms: SheetPerms;
  sources: string[];
  today: string;
  initial?: SheetEditInitial;
  /** What `columnsFor` allowed this viewer, per section (the server decides; the chooser only thins and reorders). */ columns: Record<SheetSectionId, SheetColumn[]>;
  /** Drawing-only starting column choices (a test or preview). */ initialPrefs?: PrefsDocument;
  /** What the section notes need of the custom state (null: not read). */ noteState?: CustomStateLike;
  /** The admin tier (the page's re-resolved role): the notes' "not switched on" line and "Add a column" link. */ adminTier?: boolean;
  /** The firm's live columns, by `cf:<field id>` (empty unless the custom state is ok). */ fieldMeta?: Record<string, CustomFieldMeta>;
  /** The member directory for person cells as they are drawn while saving; null when it couldn't be read. */ cellMembers?: CustomMember[] | null;
  /** Given ONLY for an owner (the page's membership-row check, with a saved-layout read that worked): each header gets the column menu. `rev` is the layout's. */ layoutEdit?: { rev: number | null } | null;
}) {
  // One hook per section, always both: the chooser's choices apply to this table and to the read-only List alike.
  const drawnBy: Record<SheetSectionId, SheetColumn[]> = {
    trademarks: useColumnPrefs("trademarks", columns.trademarks, initialPrefs).columns,
    contracts: useColumnPrefs("contracts", columns.contracts, initialPrefs).columns,
  };
  const [state, dispatch] = useReducer(sheetReducer, EMPTY_SHEET_STATE);
  const [open, setOpen] = useState<OpenCell[]>(initial?.open ?? []);
  const sizes = useSyncExternalStore(sizeStore.subscribe, sizeStore.get, sizeStore.server);
  const setSizes = sizeStore.update;
  const [dragCol, setDragCol] = useState<SizedColumn | null>(null);
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);
  const rootId = `rse-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const names = useMemo(() => new Map(people.map((p) => [p.userId, p.short])), [people]);
  const allRows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  // The ONE `fit` (a live field drawn for the row's section): the render's `can` and Tab's `nextEditableCell` both get it.
  const sectionOfRow = useMemo(() => new Map(sections.flatMap((s) => s.rows.map((r) => [r.key, s.id] as const))), [sections]);
  const fit: CustomFit = (col, r) => {
    const meta = fieldMeta[col];
    const section = sectionOfRow.get(r.key);
    return !!meta && !!section && fieldFits(meta, section);
  };
  const customCols = Object.keys(fieldMeta).filter(isCustomColumnId);
  const editing =
    !phone &&
    allRows.some((r) => canNote(r.kind, perms) || (["status", "next", "court", "source"] as const).some((c) => cellEditable(c, r, perms)) || customCols.some((c) => cellEditable(c, r, perms, fit)));
  const labels: Record<string, string> = Object.fromEntries(Object.entries(fieldMeta).map(([k, m]) => [k, m.label]));

  const router = useRouter();
  // The server's rows as last drawn, read when a save answers (the closure's `row` is the one from before the save).
  const latestRows = useRef(allRows);
  useEffect(() => {
    latestRows.current = allRows;
    dispatch({ type: "refreshed" });
  }, [sections, allRows]);
  useEffect(() => {
    if (state.status) sheetStatusStore.set(state.status);
  }, [state.status]);

  // A click outside the open editor closes it; nothing is saved.
  useEffect(() => {
    if (open.length === 0) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (t && t.closest?.(".rse-pop, .rse-on")) return;
      setOpen([]);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const focusCell = (rowKey: string, col: TabStop) => {
    requestAnimationFrame(() => {
      const el = [...(document.getElementById(rootId)?.querySelectorAll<HTMLElement>("[data-rse-cell]") ?? [])].find((n) => n.dataset.rseCell === `${rowKey}|${col}`);
      // A picker cell's hook is its button; the Notes cell's hook is its cell, so focus goes to the cell's own button inside it.
      const target = el && !el.matches("button, textarea, input, select, a[href]") ? el.querySelector<HTMLElement>("button, textarea") : el;
      target?.focus();
    });
  };
  const isOpen = (rowKey: string, col: OpenCell["col"]) => open.some((o) => o.rowKey === rowKey && o.col === col);
  const close = (rowKey: string, col: OpenCell["col"]) => {
    setOpen([]);
    focusCell(rowKey, col);
  };
  const moveFrom = (rowKey: string, col: EditableColumn, dir: 1 | -1) => {
    setOpen([]);
    // Tab follows what is DRAWN: each row's section columns (after the chooser), in drawn order.
    const to = nextEditableCell(allRows, { rowKey, col }, perms, dir, (r) => drawnBy[sectionOfRow.get(r.key) ?? "trademarks"].filter((c) => c.editable || c.id === "notes").map((c) => sizeKeyOf(c.id)), fit);
    if (to) focusCell(to.rowKey, to.col);
  };

  async function save(row: SheetEditRow, value: CellValue, stage?: StageChoice | null) {
    const shown = shownRow(row, state);
    const field = value.col;
    const label = isCustomColumnId(field) ? fieldWord(field, labels) : undefined;
    const p = postFor(shown, value, stage);
    if (!p) {
      sheetStatusStore.set({ tone: "error", client: row.client, field, message: SHEET_TRY_AFTER_REFRESH });
      return;
    }
    // R10: decided from the row as it read BEFORE this save (its own value and what is inherited).
    const note = keptNote(shown, value);
    const cell = cellKey(row.key, field);
    const mine = nextSeq();
    dispatch({ type: "start", cell, seq: mine, value, client: row.client, field, label });
    const res = await post(p.action, p.fields);
    if (!res.ok) {
      dispatch({ type: "failed", cell, seq: mine, client: row.client, field, message: res.message ?? SHEET_SAVE_FAILED, label });
      return;
    }
    const current = latestRows.current.find((r) => r.key === row.key);
    const serverHas = !!current && rowHolds(current, value);
    dispatch({ type: "saved", cell, seq: mine, client: row.client, field, serverHas, label, note });
    // The rows on screen don't read the saved value yet: ask for fresh ones (read after the write), which then replace the
    // typed value, so it never outlives the save or hides what the server really holds.
    if (!serverHas) router.refresh();
  }

  // The Notes cell saves itself (the same "Log what happened" action); its answer feeds the header's save line.
  const noteResult = (client: string) => (ok: boolean, message: string | null) =>
    dispatch(ok ? { type: "note-saved", client } : { type: "note-failed", client, message: `${message ?? SHEET_SAVE_FAILED} ${SHEET_NOTE_NOT_SAVED}` });

  // Column and row sizes: pointer drag or arrow keys on the grip; stored for this viewer only.
  const startColDrag = (col: SizedColumn) => (e: ReactPointerEvent<HTMLSpanElement>) => {
    const th = (e.currentTarget as HTMLElement).closest("th");
    if (!th) return;
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = th.getBoundingClientRect().width;
    setDragCol(col);
    const onMove = (ev: PointerEvent) => setSizes((s) => ({ ...s, cols: { ...s.cols, [col]: clampSize(w0 + ev.clientX - x0, MIN_COL, MAX_COL) } }));
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      setDragCol(null);
      writeSizes(sizeStore.get());
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };
  /** The firm's saved width for a column, from the layout the page applied (the same in both sections). */
  const layoutWidthOf = (col: SizedColumn): number | null => [...drawnBy.trademarks, ...drawnBy.contracts].find((c) => sizeKeyOf(c.id) === col)?.width ?? null;
  const colKey = (col: SizedColumn) => (e: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const th = (e.currentTarget as HTMLElement).closest("th");
    const now = drawnWidth(sizes, col, layoutWidthOf(col)) ?? th?.getBoundingClientRect().width ?? NEXT_MIN_WIDTH;
    const next = { ...sizes, cols: { ...sizes.cols, [col]: clampSize(now + (e.key === "ArrowRight" ? 16 : -16), MIN_COL, MAX_COL) } };
    setSizes(next);
    writeSizes(next);
  };
  const startRowDrag = (rowKey: string) => (e: ReactPointerEvent<HTMLSpanElement>) => {
    const tr = (e.currentTarget as HTMLElement).closest("tr");
    if (!tr) return;
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = tr.getBoundingClientRect().height;
    const onMove = (ev: PointerEvent) => setSizes((s) => ({ ...s, rows: { ...s.rows, [rowKey]: clampSize(h0 + ev.clientY - y0, MIN_ROW, MAX_ROW) } }));
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      writeSizes(sizeStore.get());
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };
  const rowKeyDown = (rowKey: string) => (e: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const tr = (e.currentTarget as HTMLElement).closest("tr");
    const now = sizes.rows[rowKey] ?? tr?.getBoundingClientRect().height ?? 48;
    const next = { ...sizes, rows: { ...sizes.rows, [rowKey]: clampSize(now + (e.key === "ArrowDown" ? 12 : -12), MIN_ROW, MAX_ROW) } };
    setSizes(next);
    writeSizes(next);
  };

  const courtName = (id: string | null) => (id ? names.get(id) ?? TEAMMATE : UNASSIGNED_LANE);
  /** A typed custom value as it is posted (the editors' form) and drawn while it saves. */
  const customValue = (col: CustomColumnId, raw: string): CellValue => {
    const meta = fieldMeta[col];
    const form = meta ? editorForm(meta.kind, raw, meta.kind === "choice" ? [...meta.options, raw] : meta.options) : undefined;
    return { col, raw: form === undefined ? raw : (form ?? ""), shown: meta ? typedCell(meta, raw, cellMembers, today) : undefined };
  };
  // The Notes column's pencil: someone here can type a note on at least one row.
  const anyNote = allRows.some((r) => canNote(r.kind, perms));

  return (
    <div className="rse-wrap" id={rootId} data-editing={editing ? "true" : "false"}>
      {editing && (
        <p className="rse-keys">
          <kbd className="rse-key">Enter</kbd> {SHEET_KEYS_EDIT} <kbd className="rse-key">Tab</kbd> {SHEET_KEYS_NEXT} <kbd className="rse-key">Esc</kbd> {SHEET_KEYS_CANCEL}
        </p>
      )}
      {/* eslint-disable-next-line react-hooks/refs -- the rows carry the editors' handlers; `save` reads `latestRows.current` only after its request answers (never in render), as it did when these handlers sat inline in the JSX. */}
      {sections.map((sec) => {
        const drawn = drawnBy[sec.id];
        const labelOf = (col: SizedColumn) => columns[sec.id].find((c) => sizeKeyOf(c.id) === col)?.header ?? "";
        /** What a header cell needs to know about its column in this section (the pencil, the lock, the width, the resize tip). */
        const headState = (c: SheetColumn) => {
          const col = sizeKeyOf(c.id);
          // The pencil only on a column someone here can type in, in this table: Notes by the note rule (its own inline editor),
          // every other typed column by the cells' own predicate (a firm's column also needs `writeCustom` and to be drawn here).
          const notes = c.id === "notes";
          const typed = editing && (notes ? sec.rows.some((r) => canNote(r.kind, perms)) : c.editable && isEditableColumn(col) && sec.rows.some((r) => cellEditable(col, r, perms, fit)));
          const locked = (notes ? !anyNote : !c.editable || (!!c.kind && !perms.writeCustom)) && !c.pinned && c.id !== "mark";
          const active = initial?.activeColumn === col || dragCol === col;
          return { col, typed, locked, active };
        };
        /** A column's drawn width: this viewer's own resize, else the firm's saved width, else the default (null = flexible). */
        const widthFor = (id: ColumnId, layoutWidth: number | null | undefined): number | null => drawnWidth(sizes, sizeKeyOf(id), layoutWidth);
        const listColumns = drawn.map((c) => ({ ...listColumnOf(c), headClass: headState(c).locked ? "rse-lock-th" : undefined }));
        const tableRows = sec.rows.map((raw) => {
                  const row = shownRow(raw, state);
                  const h = sizes.rows[row.key];
                  const nt = nextText(row, today);
                  const court = courtOf(row);
                  const can = (c: EditableColumn) => !phone && cellEditable(c, row, perms, fit);
                  const canNoteHere = !phone && canNote(row.kind, perms);
                  const saving = (c: EditableColumn) => !!state.saving[cellKey(row.key, c)];
                  const dialogCell = (c: EditableColumn) => c === "next" || (isCustomColumnId(c) && ["text", "money", "date"].includes(fieldMeta[c]?.kind ?? ""));
                  const cellProps = (c: EditableColumn) => ({
                    "data-rse-cell": `${row.key}|${c}`,
                    "aria-haspopup": dialogCell(c) ? ("dialog" as const) : ("listbox" as const),
                    "aria-expanded": isOpen(row.key, c),
                    "aria-busy": saving(c) || undefined,
                    "aria-disabled": saving(c) || undefined,
                    // Not reopened while its save is in flight: a second save would race the first (two new next steps).
                    onClick: () => {
                      if (saving(c)) return;
                      setOpen([{ rowKey: row.key, col: c }]);
                    },
                    onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => {
                      if (e.key === "Escape" && isOpen(row.key, c)) {
                        e.preventDefault();
                        close(row.key, c);
                      }
                    },
                  });
                  const stages = stageChoices(row.kind, perms) ?? [];
                  /**
                   * A firm's column. Editable: the same `<button>` and keys as Sprint 1's cells, with the kind's editor. Otherwise the
                   * read-only cell. The editor opens on the record's OWN value; an inherited value is a visible hint line.
                   */
                  const customTd = (col: CustomColumnId, header: string) => {
                    const serverRow = raw;
                    const cell = row.custom?.[col];
                    const meta = fieldMeta[col];
                    if (!meta || !can(col)) return <SheetFactTd cell={cell} label={header} className="rse-locked" quiet="rse-dash" />;
                    const own = row.customOwn?.[col] ?? null;
                    const inh = own === null ? row.customInherited?.[col] : undefined;
                    const hint = inh ? (inh.from === "lead" ? fromLeadHint(inh.cell.text) : fromMergedHint(inh.cell.text)) : undefined;
                    const open = isOpen(row.key, col);
                    const pick = (typed: string) => {
                      setOpen([]);
                      focusCell(row.key, col);
                      if (customUnchanged(meta.kind, typed, own, meta.options)) return;
                      void save(serverRow, customValue(col, typed));
                    };
                    return (
                      <td data-label={header} title={cell?.title}>
                        <button
                          type="button"
                          className={`rse-cell rse-edit${open ? " rse-on" : ""}${saving(col) ? " is-saving" : ""}${cell && cell.tone !== "value" ? " rse-dash" : ""}`}
                          aria-label={customCellLabel(header, cell?.text ?? BLANK)}
                          {...cellProps(col)}
                        >
                          {cell?.text ?? BLANK}
                          {open && (meta.kind === "choice" || meta.kind === "person") && <Icon name="chevron-down" size={14} />}
                        </button>
                        {open && meta.kind === "choice" && (
                          <ChoicePop
                            label={meta.label}
                            hint={hint}
                            options={[
                              { id: "", label: BLANK, selected: own === null },
                              ...meta.options.map((o) => ({ id: o, label: o, selected: own === o })),
                              ...(own !== null && !meta.options.includes(own) ? [{ id: own, label: noLongerAChoice(own), selected: true }] : []),
                            ]}
                            onPick={pick}
                            onCancel={() => close(row.key, col)}
                            onTab={(dir) => moveFrom(row.key, col, dir)}
                          />
                        )}
                        {open && meta.kind === "person" && (
                          <PersonPop
                            people={people}
                            current={own}
                            label={meta.label}
                            clearLabel={CUSTOM_NO_ONE}
                            hint={hint}
                            onPick={(userId) => pick(userId ?? "")}
                            onCancel={() => close(row.key, col)}
                            onTab={(dir) => moveFrom(row.key, col, dir)}
                          />
                        )}
                        {open && (meta.kind === "text" || meta.kind === "money" || meta.kind === "date") && (
                          <CustomValuePop
                            cellId={`rse-cv-${row.key.replace(/[^A-Za-z0-9_-]/g, "")}-${col.slice(3)}`}
                            kind={meta.kind}
                            label={meta.label}
                            initial={own ?? ""}
                            hint={hint}
                            onSave={pick}
                            onSaveAndMove={(typedRaw, dir) => {
                              if (!customUnchanged(meta.kind, typedRaw, own, meta.options)) void save(serverRow, customValue(col, typedRaw));
                              moveFrom(row.key, col, dir);
                            }}
                            onCancel={() => close(row.key, col)}
                          />
                        )}
                      </td>
                    );
                  };
                  const fact = (col: SheetEditColumn) => <SheetFactTd cell={row.facts?.[col as keyof NonNullable<SheetEditRow["facts"]>]} label={labelOf(col)} className="rse-locked" quiet="rse-dash" />;
                  const cells: Partial<Record<SizedColumn, React.ReactNode>> = {
                      client: (
                      <td className="pri" title={row.client}>
                        <Link href={row.openHref} className="sheet-link" scroll={false}>
                          {row.client}
                        </Link>
                        {row.documentsText && <span className="lx-note rv-sub">{row.documentsText}</span>}
                        {row.changedText && <span className="lx-note rv-changed" data-last-changed="">{row.changedText}</span>}
                      </td>
                      ),
                      mark: (
                      <td data-label={labelOf("mark")}>{row.mark ?? <span className="rse-dash">{BLANK}</span>}</td>
                      ),
                      status: (
                      <td data-label={labelOf("status")}>
                        {can("status") ? (
                          <>
                            <button type="button" className={`rse-cell rse-edit${isOpen(row.key, "status") ? " rse-on" : ""}${saving("status") ? " is-saving" : ""}`} aria-label={`Status: ${row.stageLabel ?? "none"}`} {...cellProps("status")}>
                              {row.stageLabel ?? BLANK}
                              {isOpen(row.key, "status") &&  <Icon name="chevron-down" size={14} />}
                            </button>
                            {isOpen(row.key, "status") && (
                              <ChoicePop
                                label="Status"
                                eyebrow={SHEET_MOVE_TO_STAGE}
                                footer={sheetMoveLogged(row.client)}
                                options={stages.map((s) => ({ id: s.id, label: s.name, selected: s.id === row.stageId }))}
                                onPick={(id) => {
                                  const s = stages.find((x) => x.id === id);
                                  setOpen([]);
                                  focusCell(row.key, "status");
                                  if (!s || s.id === row.stageId) return;
                                  void save(raw, { col: "status", stageId: s.id, stageLabel: s.name }, s);
                                }}
                                onCancel={() => close(row.key, "status")}
                                onTab={(dir) => moveFrom(row.key, "status", dir)}
                              />
                            )}
                          </>
                        ) : (
                          <span>{row.stageLabel ?? BLANK}</span>
                        )}
                      </td>
                      ),
                      next: (
                      <td data-label={labelOf("next")} className="rse-next-td">
                        {can("next") ? (
                          isOpen(row.key, "next") ? (
                            <NextEditor
                              row={row}
                              draft={initial?.nextDraft?.[row.key]}
                              onSave={(title, dueDate) => {
                                setOpen([]);
                                focusCell(row.key, "next");
                                if (row.nextStep && row.nextStep.title === title && row.nextStep.dueDate === dueDate) return;
                                void save(raw, { col: "next", title, dueDate });
                              }}
                              onSaveAndMove={(title, dueDate, dir) => {
                                if (!(row.nextStep && row.nextStep.title === title && row.nextStep.dueDate === dueDate)) void save(raw, { col: "next", title, dueDate });
                                moveFrom(row.key, "next", dir);
                              }}
                              onCancel={() => close(row.key, "next")}
                            />
                          ) : (
                            <button type="button" className={`rse-cell rse-edit rse-wrapcell${nt?.overdue ? " rse-overdue" : ""}${saving("next") ? " is-saving" : ""}`} {...cellProps("next")}>
                              {nt ? nt.text : BLANK}
                              {nt?.overdue && <span className="rse-sr"> {SHEET_OVERDUE}</span>}
                            </button>
                          )
                        ) : (
                          <span className={nt?.overdue ? "rse-overdue" : undefined}>
                            {nt ? nt.text : BLANK}
                            {nt?.overdue && <span className="rse-sr"> {SHEET_OVERDUE}</span>}
                          </span>
                        )}
                        {editing && (
                          <span
                            className={`rse-row-grip${initial?.activeRow === row.key ? " is-active" : ""}`}
                            role="separator"
                            aria-orientation="horizontal"
                            aria-label={SHEET_RESIZE_ROW}
                            tabIndex={-1}
                            onPointerDown={startRowDrag(row.key)}
                            onKeyDown={rowKeyDown(row.key)}
                          />
                        )}
                      </td>
                      ),
                      court: (
                      <td data-label={labelOf("court")}>
                        {can("court") ? (
                          <>
                            <button type="button" className={`rse-cell rse-edit${isOpen(row.key, "court") ? " rse-on" : ""}${saving("court") ? " is-saving" : ""}`} {...cellProps("court")}>
                              {courtName(court)}
                              {isOpen(row.key, "court") &&  <Icon name="chevron-down" size={14} />}
                            </button>
                            {isOpen(row.key, "court") && (
                              <PersonPop
                                people={people}
                                current={court}
                                onPick={(userId) => {
                                  setOpen([]);
                                  focusCell(row.key, "court");
                                  if (userId === court) return;
                                  void save(raw, { col: "court", userId });
                                }}
                                onCancel={() => close(row.key, "court")}
                                onTab={(dir) => moveFrom(row.key, "court", dir)}
                              />
                            )}
                          </>
                        ) : (
                          <span>{courtName(court)}</span>
                        )}
                      </td>
                      ),
                      waiting: (
                      <td data-label={labelOf("waiting")} className="rse-locked">
                        {row.waitingText}
                      </td>
                      ),
                      source: (
                      <td data-label={labelOf("source")}>
                        {can("source") ? (
                          <>
                            <button type="button" className={`rse-cell rse-edit${isOpen(row.key, "source") ? " rse-on" : ""}${saving("source") ? " is-saving" : ""}`} {...cellProps("source")}>
                              {row.source ?? BLANK}
                              {isOpen(row.key, "source") &&  <Icon name="chevron-down" size={14} />}
                            </button>
                            {isOpen(row.key, "source") && (
                              <ChoicePop
                                label={SHEET_SOURCE_LABEL}
                                options={[...sources.map((s) => ({ id: s, label: s, selected: s === row.source })), { id: "", label: SHEET_NO_SOURCE, selected: !row.source }]}
                                onPick={(id) => {
                                  setOpen([]);
                                  focusCell(row.key, "source");
                                  if ((id || null) === row.source) return;
                                  void save(raw, { col: "source", source: id || null });
                                }}
                                onCancel={() => close(row.key, "source")}
                                onTab={(dir) => moveFrom(row.key, "source", dir)}
                              />
                            )}
                          </>
                        ) : (
                          <span>{row.source ?? BLANK}</span>
                        )}
                      </td>
                      ),
                      contact: (
                      <td data-label={labelOf("contact")} className="rse-locked" title={row.contactTitle ?? undefined}>
                        {row.contactText}
                      </td>
                      ),
                      // The Notes cell (the newest plain note; a writer types a new one in place, saved on Enter only). The hook makes it a
                      // Tab stop for the editors' Tab (`nextEditableCell`), only where it can be typed in.
                      notes: (
                      <td data-label={labelOf("notes")} className="rse-notes-td" {...(canNoteHere ? { "data-rse-cell": `${row.key}|notes` } : {})}>
                        <NotesCell kind={row.kind} id={row.id} client={row.client} cell={row.note ?? { state: "unavailable" }} canEdit={canNoteHere} today={today} onResult={noteResult(row.client)} />
                      </td>
                      ),
                      practiceArea: fact("practiceArea"),
                      serial: fact("serial"),
                      start: fact("start"),
                      legalFee: fact("legalFee"),
                      legalFeeDue: fact("legalFeeDue"),
                      govFee: fact("govFee"),
                      govFeeDue: fact("govFeeDue"),
                      oaDue: fact("oaDue"),
                  };
                  // The cells by column, in the shared List's terms: the drawn columns, a firm's column through its own cell.
                  const byKey: Record<string, React.ReactNode> = {};
                  for (const c of drawn) byKey[c.id] = c.kind && isCustomColumnId(c.id) ? customTd(c.id, c.header) : cells[sizeKeyOf(c.id)] ?? null;
                  return { key: row.key, height: h ?? null, cells: byKey };
                });
        return (
      <SheetCard key={sec.id} className="rse-sec-card">
       <h2 id={`rse-sheet-${sec.id}`} className="lx-h3 rv-sheet-title">
         {sec.title} <span className="lx-note">{sec.rows.length}</span>
       </h2>
       <SectionNote section={sec.id} customState={noteState} adminTier={adminTier} />
       <ViewTable
         columns={listColumns}
         rows={tableRows}
         cell={(r, c) => r.cells[c.key] ?? null}
         tableClass="rse-tbl"
         fixed
         canEditCells={editing}
         minWidth={drawn.reduce((total, c) => total + (widthFor(c.id, c.width) ?? NEXT_MIN_WIDTH), 0)}
         widthOf={(lc) => widthFor(lc.key as ColumnId, lc.width)}
         emptyText={SHEET_EMPTY_SECTION}
         renderHead={(lc) => {
           const c = drawn.find((d) => d.id === lc.key);
           if (!c) return lc.label;
           const { col, typed, active } = headState(c);
           const w = widthFor(c.id, c.width);
           return (
             <>
               {lc.label}
               {layoutEdit && <ColumnMenu view="review_list" rev={layoutEdit.rev} columnKey={layoutKeyOf(c.id)} label={lc.label} pinned={c.pinned} allowAdd section={sec.id} />}
               {typed && (
                 <>
                   {" "}
                   <Icon name="pencil" size={13} />
                 </>
               )}
               {editing && (
                 <span
                   className={`rse-col-grip${active ? " is-active" : ""}`}
                   role="separator"
                   aria-orientation="vertical"
                   aria-label={sheetResizeColumn(lc.label)}
                   tabIndex={0}
                   onPointerDown={startColDrag(col)}
                   onKeyDown={colKey(col)}
                 />
               )}
               {editing && active && <span className="rse-col-tip">{Math.round(w ?? NEXT_MIN_WIDTH)} px</span>}
             </>
           );
         }}
       />
      </SheetCard>
        );
      })}
    </div>
  );
}

/** Arrow keys walk the options; Tab leaves to the next editable cell; Esc cancels. */
export function listKeys(e: ReactKeyboardEvent<HTMLElement>, onCancel: () => void, onTab: (dir: 1 | -1) => void) {
  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    onCancel();
    return;
  }
  if (e.key === "Tab") {
    e.preventDefault();
    onTab(e.shiftKey ? -1 : 1);
    return;
  }
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const opts = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=option]")];
    const at = opts.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? Math.min(opts.length - 1, at + 1) : Math.max(0, at - 1);
    opts[to]?.focus();
  }
}

export function ChoicePop({ label, eyebrow, footer, hint, options, onPick, onCancel, onTab }: { label: string; eyebrow?: string; footer?: string; /** A visible line under the list (a firm column's inherited value). */ hint?: string; options: { id: string; label: string; selected: boolean }[]; onPick: (id: string) => void; onCancel: () => void; onTab: (dir: 1 | -1) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  usePopPlacement(ref);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>("[aria-selected=true]") ?? ref.current?.querySelector<HTMLElement>("[role=option]");
    el?.focus();
  }, []);
  return (
    <div className="rse-pop" role="listbox" aria-label={label} ref={ref} onKeyDown={(e) => listKeys(e, onCancel, onTab)}>
      {eyebrow && <span className="rse-pop-eyebrow">{eyebrow}</span>}
      <div className="rse-pop-list">
        {options.map((o) => (
          <button key={o.id || "none"} type="button" role="option" aria-selected={o.selected} className={`rse-opt${o.selected ? " sel" : ""}`} onClick={() => onPick(o.id)}>
            {o.label}
          </button>
        ))}
      </div>
      {hint && <span className="rse-ed-hint">{hint}</span>}
      {footer && <p className="rse-pop-foot">{footer}</p>}
    </div>
  );
}

export function PersonPop({
  people,
  current,
  onPick,
  onCancel,
  onTab,
  label = OWNER_COLUMN,
  clearLabel = UNASSIGNED_LANE,
  hint,
}: {
  people: SheetPerson[];
  current: string | null;
  onPick: (userId: string | null) => void;
  onCancel: () => void;
  onTab: (dir: 1 | -1) => void;
  /** The list's name (the Owner column's by default; a firm column passes its label). */
  label?: string;
  /** The "nobody" choice (Unassigned by default; a firm column passes "No one"). */
  clearLabel?: string;
  hint?: string;
}) {
  const [term, setTerm] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  usePopPlacement(ref);
  const shown = matchPeople(people, term);
  const showUnassigned = !term.trim() || clearLabel.toLowerCase().includes(term.trim().toLowerCase());
  return (
    <div className="rse-pop" role="listbox" aria-label={label} ref={ref} onKeyDown={(e) => listKeys(e, onCancel, onTab)}>
      <input className="rse-in" type="text" aria-label={SHEET_FIND_PERSON} placeholder={SHEET_FIND_PERSON} value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
      <div className="rse-pop-list">
        {shown.map((p) => (
          <button key={p.userId} type="button" role="option" aria-selected={p.userId === current} className={`rse-opt${p.userId === current ? " sel" : ""}`} onClick={() => onPick(p.userId)}>
            <span className={`rse-av${p.userId === current ? "" : " soft"}`} aria-hidden>
              {personInitials(p.name)}
            </span>
            {p.short}
            {p.roleLabel ? ` · ${p.roleLabel}` : ""}
          </button>
        ))}
        {showUnassigned && (
          <button type="button" role="option" aria-selected={current === null} className={`rse-opt${current === null ? " sel" : ""}`} onClick={() => onPick(null)}>
            <span className="rse-av soft" aria-hidden>
              {BLANK}
            </span>
            {clearLabel}
          </button>
        )}
        {shown.length === 0 && !showUnassigned && <p className="rse-pop-foot">{SHEET_NO_ONE_FOUND}</p>}
      </div>
      {hint && <span className="rse-ed-hint">{hint}</span>}
    </div>
  );
}

function NextEditor({ row, draft, onSave, onSaveAndMove, onCancel }: { row: SheetEditRow; draft?: { title: string; dueDate: string | null }; onSave: (title: string, dueDate: string | null) => void; onSaveAndMove: (title: string, dueDate: string | null, dir: 1 | -1) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(draft?.title ?? row.nextStep?.title ?? "");
  const [due, setDue] = useState(draft?.dueDate ?? row.nextStep?.dueDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const id = `rse-ns-${row.key.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const taRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = "auto";
    const cs = getComputedStyle(el);
    const chrome = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    el.style.height = `${growHeight(el.scrollHeight + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth), parseFloat(cs.lineHeight) || 21, chrome)}px`;
  }, [title]);
  const clean = () => normalizeNextStepTitle(title);
  const valid = () => {
    if (!clean()) {
      setError(SHEET_ENTER_TITLE);
      return false;
    }
    return true;
  };
  return (
    <div
      className="rse-cell rse-on rse-next-ed"
      role="group"
      aria-label={SHEET_NEXT_STEP}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          if (valid()) onSave(clean(), due || null);
        } else if (e.key === "Tab") {
          const last = (e.target as HTMLElement).id === `${id}-d`;
          const first = (e.target as HTMLElement).id === `${id}-t`;
          if ((last && !e.shiftKey) || (first && e.shiftKey)) {
            e.preventDefault();
            if (valid()) onSaveAndMove(clean(), due || null, e.shiftKey ? -1 : 1);
          }
        }
      }}
    >
      <label className="rse-ed-label" htmlFor={`${id}-t`}>
        {SHEET_NEXT_STEP}
      </label>
      <textarea ref={taRef} id={`${id}-t`} className="rse-in rse-textarea rse-title-ta" rows={2} value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} aria-invalid={!!error || undefined} />
      <div className="rse-ed-due">
        <label className="rse-ed-label" htmlFor={`${id}-d`}>
          {SHEET_DUE}
        </label>
        <input id={`${id}-d`} className="rse-in rse-in-date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        <span className="rse-ed-hint">{SHEET_ENTER_ESC}</span>
      </div>
      {error && (
        <p className="rse-ed-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
