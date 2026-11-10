"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useReducer, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  closeLeadAction,
  logWhatHappenedAction,
  moveStageAction,
  assignRecordAction,
  setNextStepAction,
  setSourceAction,
  updateNextStepAction,
  type ReviewActionState,
} from "@/app/dashboard/review/actions";
import { shortDate } from "@/lib/review/format";
import { UNASSIGNED_LANE } from "@/lib/review/lanes";
import {
  EMPTY_SHEET_STATE,
  MAX_COL,
  MAX_ROW,
  MIN_COL,
  DEFAULT_COL_WIDTHS,
  NEXT_MIN_WIDTH,
  NOTE_COL_WIDTH,
  colWidth,
  sheetMinWidth,
  MIN_ROW,
  NO_SIZES,
  SHEET_SIZES_KEY,
  canNote,
  cellEditable,
  cellKey,
  clampSize,
  courtOf,
  matchPeople,
  nextEditableCell,
  notePost,
  parseSizes,
  personInitials,
  postFor,
  rowHolds,
  sheetReducer,
  shownRow,
  stageChoices,
  type CellValue,
  type EditableColumn,
  type SheetActionName,
  type SheetEditColumn,
  type SheetEditRow,
  type SheetPerms,
  type SheetSizes,
  type StageChoice,
} from "@/lib/review/sheet-edit";
import {
  SHEET_ADD_NOTE,
  SHEET_CANCEL,
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
  SHEET_NOTE_BUTTON,
  SHEET_NOTE_NOT_SAVED,
  SHEET_OVERDUE,
  SHEET_RESIZE_ROW,
  SHEET_SAVE_FAILED,
  SHEET_SOURCE_LABEL,
  SHEET_TRY_AFTER_REFRESH,
  SHEET_WHAT_HAPPENED,
  SHEET_WRITE_NOTE,
  sheetMoveLogged,
  sheetNoteFor,
  sheetNoteHint,
  sheetResizeColumn,
} from "@/lib/ui/words";
import { usePopPlacement } from "./pop-placement";
import { sheetStatusStore } from "./sheet-status-store";
import "./review-sheet-edit.css";

export type SheetPerson = { userId: string; name: string; /** What the cell shows. */ short: string; roleLabel: string };
export type SheetSection = { id: string; title: string; rows: SheetEditRow[] };
type OpenCell = { rowKey: string; col: EditableColumn | "note" };

/** Drawing-only starting state (a preview harness opens editors with it). The default is everything closed. */
export type SheetEditInitial = {
  open?: OpenCell[];
  /** The next-step editor's text, by row key. */
  nextDraft?: Record<string, { title: string; dueDate: string | null }>;
  noteDraft?: Record<string, string>;
  /** A column whose resize grip and width tip are shown, and a row whose grip is shown. */
  activeColumn?: SheetEditColumn;
  activeRow?: string;
};

const HEADS: { col: SheetEditColumn; label: string }[] = [
  { col: "client", label: "Client" },
  { col: "mark", label: "Mark" },
  { col: "status", label: "Status" },
  { col: "next", label: "Next step" },
  { col: "court", label: "Whose court" },
  { col: "waiting", label: "Waiting on" },
  { col: "source", label: "Source" },
  { col: "contact", label: "Last contact" },
];

const ACTIONS: Record<SheetActionName, (prev: ReviewActionState, form: FormData) => Promise<ReviewActionState>> = {
  moveStage: (p, f) => moveStageAction(p, f),
  closeLead: (p, f) => closeLeadAction(p, f),
  updateNextStep: (p, f) => updateNextStepAction(p, f),
  setNextStep: (p, f) => setNextStepAction(p, f),
  assignRecord: (p, f) => assignRecordAction(p, f),
  setSource: (p, f) => setSourceAction(p, f),
  logWhatHappened: (p, f) => logWhatHappenedAction(p, f),
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

export function SheetEditTable({ sections, people, perms, sources, today, initial }: { sections: SheetSection[]; people: SheetPerson[]; perms: SheetPerms; sources: string[]; today: string; initial?: SheetEditInitial }) {
  const [state, dispatch] = useReducer(sheetReducer, EMPTY_SHEET_STATE);
  const [open, setOpen] = useState<OpenCell[]>(initial?.open ?? []);
  const sizes = useSyncExternalStore(sizeStore.subscribe, sizeStore.get, sizeStore.server);
  const setSizes = sizeStore.update;
  const [dragCol, setDragCol] = useState<SheetEditColumn | null>(null);
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);
  const rootId = `rse-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const names = useMemo(() => new Map(people.map((p) => [p.userId, p.short])), [people]);
  const allRows = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const editing = !phone && allRows.some((r) => canNote(r.kind, perms) || (["status", "next", "court", "source"] as const).some((c) => cellEditable(c, r.kind, perms)));

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

  const focusCell = (rowKey: string, col: EditableColumn | "note") => {
    requestAnimationFrame(() => {
      const el = [...(document.getElementById(rootId)?.querySelectorAll<HTMLElement>("[data-rse-cell]") ?? [])].find((n) => n.dataset.rseCell === `${rowKey}|${col}`);
      el?.focus();
    });
  };
  const isOpen = (rowKey: string, col: OpenCell["col"]) => open.some((o) => o.rowKey === rowKey && o.col === col);
  const close = (rowKey: string, col: OpenCell["col"]) => {
    setOpen([]);
    focusCell(rowKey, col);
  };
  const moveFrom = (rowKey: string, col: EditableColumn, dir: 1 | -1) => {
    setOpen([]);
    const to = nextEditableCell(allRows, { rowKey, col }, perms, dir);
    if (to) focusCell(to.rowKey, to.col);
  };

  async function save(row: SheetEditRow, value: CellValue, stage?: StageChoice | null) {
    const shown = shownRow(row, state);
    const field = value.col;
    const p = postFor(shown, value, stage);
    if (!p) {
      sheetStatusStore.set({ tone: "error", client: row.client, field, message: SHEET_TRY_AFTER_REFRESH });
      return;
    }
    const cell = cellKey(row.key, field);
    const mine = nextSeq();
    dispatch({ type: "start", cell, seq: mine, value, client: row.client, field });
    const res = await post(p.action, p.fields);
    if (!res.ok) {
      dispatch({ type: "failed", cell, seq: mine, client: row.client, field, message: res.message ?? SHEET_SAVE_FAILED });
      return;
    }
    const current = latestRows.current.find((r) => r.key === row.key);
    const serverHas = !!current && rowHolds(current, value);
    dispatch({ type: "saved", cell, seq: mine, client: row.client, field, serverHas });
    // The rows on screen don't read the saved value yet: ask for fresh ones (read after the write), which then replace the
    // typed value, so it never outlives the save or hides what the server really holds.
    if (!serverHas) router.refresh();
  }

  async function saveNote(row: SheetEditRow, body: string): Promise<boolean> {
    const p = notePost(row, body);
    const res = await post(p.action, p.fields);
    if (res.ok) dispatch({ type: "note-saved", client: row.client });
    else dispatch({ type: "note-failed", client: row.client, message: `${res.message ?? SHEET_SAVE_FAILED} ${SHEET_NOTE_NOT_SAVED}` });
    return res.ok;
  }

  // Column and row sizes: pointer drag or arrow keys on the grip; stored for this viewer only.
  const startColDrag = (col: SheetEditColumn) => (e: ReactPointerEvent<HTMLSpanElement>) => {
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
  const colKey = (col: SheetEditColumn) => (e: ReactKeyboardEvent<HTMLSpanElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const th = (e.currentTarget as HTMLElement).closest("th");
    const now = sizes.cols[col] ?? th?.getBoundingClientRect().width ?? DEFAULT_COL_WIDTHS[col] ?? NEXT_MIN_WIDTH;
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

  const courtName = (id: string | null) => (id ? names.get(id) ?? "Teammate" : UNASSIGNED_LANE);
  const colCount = HEADS.length + (editing ? 1 : 0);

  return (
    <div className="rse-wrap" id={rootId} data-editing={editing ? "true" : "false"}>
      {editing && (
        <p className="rse-keys">
          <kbd className="rse-key">Enter</kbd> {SHEET_KEYS_EDIT} <kbd className="rse-key">Tab</kbd> {SHEET_KEYS_NEXT} <kbd className="rse-key">Esc</kbd> {SHEET_KEYS_CANCEL}
        </p>
      )}
      <div className="lx-card rse-card">
       <div className="rse-scroll">
        <table className="rse-tbl lx-stack" style={{ "--rse-min": `${sheetMinWidth(sizes, editing)}px` } as CSSProperties}>
          <colgroup>
            {HEADS.map((h) => {
              const cw = colWidth(sizes, h.col);
              return <col key={h.col} style={cw ? { width: cw } : undefined} />;
            })}
            {editing && <col style={{ width: NOTE_COL_WIDTH }} />}
          </colgroup>
          <thead>
            <tr>
              {HEADS.map((h) => {
                const typed = editing && (h.col === "status" || h.col === "next" || h.col === "court" || h.col === "source");
                const locked = h.col === "waiting" || h.col === "contact";
                const w = colWidth(sizes, h.col);
                const active = initial?.activeColumn === h.col || dragCol === h.col;
                return (
                  <th key={h.col} className={locked ? "rse-lock-th" : undefined} scope="col">
                    {h.label}
                    {typed && <span aria-hidden> ✎</span>}
                    {editing && (
                      <span
                        className={`rse-col-grip${active ? " is-active" : ""}`}
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={sheetResizeColumn(h.label)}
                        tabIndex={0}
                        onPointerDown={startColDrag(h.col)}
                        onKeyDown={colKey(h.col)}
                      />
                    )}
                    {editing && active && <span className="rse-col-tip">{Math.round(w ?? NEXT_MIN_WIDTH)} px</span>}
                  </th>
                );
              })}
              {editing && (
                <th scope="col" className="rse-note-th">
                  <span className="rse-sr">Note</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {sections.map((sec) => (
              <SectionRows key={sec.id} sec={sec} colCount={colCount}>
                {sec.rows.map((raw) => {
                  const row = shownRow(raw, state);
                  const h = sizes.rows[row.key];
                  const nt = nextText(row, today);
                  const court = courtOf(row);
                  const can = (c: EditableColumn) => !phone && cellEditable(c, row.kind, perms);
                  const saving = (c: EditableColumn) => !!state.saving[cellKey(row.key, c)];
                  const cellProps = (c: EditableColumn) => ({
                    "data-rse-cell": `${row.key}|${c}`,
                    "aria-haspopup": c === "next" ? ("dialog" as const) : ("listbox" as const),
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
                  return (
                    <tr key={row.key} style={h ? { height: h } : undefined} data-row={row.key}>
                      <td className="pri" title={row.client}>
                        <Link href={row.openHref} className="rse-client" scroll={false}>
                          {row.client}
                        </Link>
                      </td>
                      <td data-label="Mark">{row.mark ?? <span className="rse-dash">—</span>}</td>
                      <td data-label="Status">
                        {can("status") ? (
                          <>
                            <button type="button" className={`rse-cell rse-edit${isOpen(row.key, "status") ? " rse-on" : ""}${saving("status") ? " is-saving" : ""}`} aria-label={`Status: ${row.stageLabel ?? "none"}`} {...cellProps("status")}>
                              {row.stageLabel ?? "—"}
                              {isOpen(row.key, "status") && <span aria-hidden> ▾</span>}
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
                          <span>{row.stageLabel ?? "—"}</span>
                        )}
                      </td>
                      <td data-label="Next step" className="rse-next-td">
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
                              {nt ? nt.text : "—"}
                              {nt?.overdue && <span className="rse-sr"> {SHEET_OVERDUE}</span>}
                            </button>
                          )
                        ) : (
                          <span className={nt?.overdue ? "rse-overdue" : undefined}>
                            {nt ? nt.text : "—"}
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
                      <td data-label="Whose court">
                        {can("court") ? (
                          <>
                            <button type="button" className={`rse-cell rse-edit${isOpen(row.key, "court") ? " rse-on" : ""}${saving("court") ? " is-saving" : ""}`} {...cellProps("court")}>
                              {courtName(court)}
                              {isOpen(row.key, "court") && <span aria-hidden> ▾</span>}
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
                      <td data-label="Waiting on" className="rse-locked">
                        {row.waitingText}
                      </td>
                      <td data-label="Source">
                        {can("source") ? (
                          <>
                            <button type="button" className={`rse-cell rse-edit${isOpen(row.key, "source") ? " rse-on" : ""}${saving("source") ? " is-saving" : ""}`} {...cellProps("source")}>
                              {row.source ?? "—"}
                              {isOpen(row.key, "source") && <span aria-hidden> ▾</span>}
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
                          <span>{row.source ?? "—"}</span>
                        )}
                      </td>
                      <td data-label="Last contact" className={`rse-locked${row.contactIsDate ? " rse-mono" : ""}`} title={row.contactTitle ?? undefined}>
                        {row.contactText}
                      </td>
                      {editing && (
                        <td className="rse-note-td">
                          {canNote(row.kind, perms) && (
                            <>
                              <button
                                type="button"
                                className={`rse-btn${isOpen(row.key, "note") ? " rse-btn--on rse-on" : ""}`}
                                aria-label={sheetNoteFor(row.client)}
                                aria-expanded={isOpen(row.key, "note")}
                                data-rse-cell={`${row.key}|note`}
                                onClick={() => setOpen([{ rowKey: row.key, col: "note" }])}
                              >
                                {SHEET_NOTE_BUTTON}
                              </button>
                              {isOpen(row.key, "note") && (
                                <NotePop
                                  client={row.client}
                                  draft={initial?.noteDraft?.[row.key]}
                                  onSave={async (body) => {
                                    const ok = await saveNote(raw, body);
                                    if (ok) close(row.key, "note");
                                    return ok;
                                  }}
                                  onCancel={() => close(row.key, "note")}
                                />
                              )}
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </SectionRows>
            ))}
          </tbody>
        </table>
       </div>
      </div>
    </div>
  );
}

function SectionRows({ sec, colCount, children }: { sec: SheetSection; colCount: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="rse-sec" data-section={sec.id}>
        <th colSpan={colCount} scope="colgroup">
          {sec.title} · {sec.rows.length}
        </th>
      </tr>
      {sec.rows.length === 0 ? (
        <tr className="rse-empty">
          <td colSpan={colCount}>{SHEET_EMPTY_SECTION}</td>
        </tr>
      ) : (
        children
      )}
    </>
  );
}

/** Arrow keys walk the options; Tab leaves to the next editable cell; Esc cancels. */
function listKeys(e: ReactKeyboardEvent<HTMLElement>, onCancel: () => void, onTab: (dir: 1 | -1) => void) {
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

function ChoicePop({ label, eyebrow, footer, options, onPick, onCancel, onTab }: { label: string; eyebrow?: string; footer?: string; options: { id: string; label: string; selected: boolean }[]; onPick: (id: string) => void; onCancel: () => void; onTab: (dir: 1 | -1) => void }) {
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
      {footer && <p className="rse-pop-foot">{footer}</p>}
    </div>
  );
}

function PersonPop({ people, current, onPick, onCancel, onTab }: { people: SheetPerson[]; current: string | null; onPick: (userId: string | null) => void; onCancel: () => void; onTab: (dir: 1 | -1) => void }) {
  const [term, setTerm] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  usePopPlacement(ref);
  const shown = matchPeople(people, term);
  const showUnassigned = !term.trim() || UNASSIGNED_LANE.toLowerCase().includes(term.trim().toLowerCase());
  return (
    <div className="rse-pop" role="listbox" aria-label="Whose court" ref={ref} onKeyDown={(e) => listKeys(e, onCancel, onTab)}>
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
              —
            </span>
            {UNASSIGNED_LANE}
          </button>
        )}
        {shown.length === 0 && !showUnassigned && <p className="rse-pop-foot">{SHEET_NO_ONE_FOUND}</p>}
      </div>
    </div>
  );
}

function NextEditor({ row, draft, onSave, onSaveAndMove, onCancel }: { row: SheetEditRow; draft?: { title: string; dueDate: string | null }; onSave: (title: string, dueDate: string | null) => void; onSaveAndMove: (title: string, dueDate: string | null, dir: 1 | -1) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(draft?.title ?? row.nextStep?.title ?? "");
  const [due, setDue] = useState(draft?.dueDate ?? row.nextStep?.dueDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const id = `rse-ns-${row.key.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const valid = () => {
    if (!title.trim()) {
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
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (valid()) onSave(title.trim(), due || null);
        } else if (e.key === "Tab") {
          const last = (e.target as HTMLElement).id === `${id}-d`;
          const first = (e.target as HTMLElement).id === `${id}-t`;
          if ((last && !e.shiftKey) || (first && e.shiftKey)) {
            e.preventDefault();
            if (valid()) onSaveAndMove(title.trim(), due || null, e.shiftKey ? -1 : 1);
          }
        }
      }}
    >
      <label className="rse-ed-label" htmlFor={`${id}-t`}>
        {SHEET_NEXT_STEP}
      </label>
      <input id={`${id}-t`} className="rse-in" type="text" value={title} maxLength={200} autoFocus onChange={(e) => setTitle(e.target.value)} aria-invalid={!!error || undefined} />
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

function NotePop({ client, draft, onSave, onCancel }: { client: string; draft?: string; onSave: (body: string) => Promise<boolean>; onCancel: () => void }) {
  const [body, setBody] = useState(draft ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = `rse-note-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const ref = useRef<HTMLFormElement>(null);
  usePopPlacement(ref, "right");
  return (
    <form
      ref={ref}
      className="rse-pop rse-note-pop"
      aria-label={sheetNoteFor(client)}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!body.trim()) {
          setError(SHEET_WRITE_NOTE);
          return;
        }
        setBusy(true);
        const ok = await onSave(body.trim());
        setBusy(false);
        if (!ok) setError(null);
      }}
    >
      <label htmlFor={id} className="rse-note-label">
        {SHEET_WHAT_HAPPENED}
      </label>
      <textarea id={id} rows={3} className="rse-in rse-textarea" value={body} maxLength={4000} autoFocus onChange={(e) => setBody(e.target.value)} />
      <p className="rse-pop-foot">{sheetNoteHint(client)}</p>
      {error && (
        <p className="rse-ed-error" role="alert">
          {error}
        </p>
      )}
      <div className="rse-note-acts">
        <button type="button" className="rse-btn" onClick={onCancel}>
          {SHEET_CANCEL}
        </button>
        <button type="submit" className="rse-btn rse-btn--on" disabled={busy}>
          {SHEET_ADD_NOTE}
        </button>
      </div>
    </form>
  );
}
