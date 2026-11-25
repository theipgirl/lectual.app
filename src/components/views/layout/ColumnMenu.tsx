"use client";

import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "@/components/ui/Icon";
import { popoverClaimsKey } from "@/lib/ui/dialog-keys";
import { CUSTOM_KINDS, CUSTOM_KIND_WORDS, CUSTOM_SECTIONS, type CustomSection } from "@/lib/review/sheet-columns";
import { menuItems } from "@/lib/views/layout/menu-items";
import type { ViewKey } from "@/lib/views/layout/types";
import {
  CANCEL,
  COLUMNS_ADD,
  COLUMNS_CHOICES_HINT,
  COLUMNS_CHOICES_LABEL,
  COLUMNS_KIND_LABEL,
  COLUMNS_KIND_MONEY_HINT,
  COLUMNS_RENAME,
  COLUMNS_SECTION_LABEL,
  COLUMN_ADD_SUBMIT,
  COLUMN_ARCHIVE_ASK,
  COLUMN_ARCHIVE_CONFIRM,
  COLUMN_CHOICES_SAVE,
  COLUMN_CHANGES_NOTE,
  COLUMN_MENU_ADD_LEFT,
  COLUMN_MENU_ADD_RIGHT,
  COLUMN_MENU_ARCHIVE,
  COLUMN_MENU_EDIT_CHOICES,
  COLUMN_MENU_HIDE,
  COLUMN_MENU_LEFT,
  COLUMN_MENU_RIGHT,
  COLUMN_MENU_SAVE,
  COLUMN_NEW_NAME_LABEL,
  CUSTOM_SECTION_WORDS,
  SAVING,
  columnMenuLabel,
  laneMenuLabel,
} from "@/lib/ui/words";
import { useLayoutChange } from "./useLayoutChange";
import "./layout-edit.css";

/**
 * The owner's menu on a column's header (a List column or a person's Board lane). The page draws it ONLY for an owner (the membership
 * row, re-asked by every action); nobody else has a menu. One button opens a small panel: Rename, Hide, Move left, Move right and (a List
 * column) Add a column to the left or right. A change is the firm's view for everyone.
 *
 * The panel is positioned on the page (`position: fixed`, set from the button when it opens), not inside the table, because the List
 * scrolls sideways inside its card and would cut an absolutely placed panel off. It closes on Esc (focus back to the button), on a click
 * outside, and when the page scrolls or resizes. The server decides every refusal and answers a fixed sentence, shown here.
 */
export type ColumnMenuProps = {
  view: ViewKey;
  /** The rev the page drew the layout at (null: no saved layout yet). */
  rev: number | null;
  /** The column's fixed key (a List column's layout key, or a lane's). */
  columnKey: string;
  /** What the header says now (the firm's label or the built-in name). */
  label: string;
  /** The link to the record: always first and always shown, so it has no Hide or Move. */
  pinned?: boolean;
  /** A List column can have a new column added beside it; a lane cannot. */
  allowAdd?: boolean;
  /** The List section the header is in: where a new column starts out (Trademarks, Contracts). */
  section?: CustomSection;
  kind?: "column" | "lane";
  /** The visible columns either side (null: none, or the pinned one). Move left and right go BESIDE these, so the move is seen. */
  prevKey?: string | null;
  nextKey?: string | null;
  /** A firm's own column (`cf:` key): its kind and choices. Rename renames the field itself; Edit choices and Archive are offered. */
  firm?: { kind: string; options: readonly string[] } | null;
};

type Mode = "menu" | "rename" | "add" | "choices" | "archive";
const PANEL_WIDTH = 288;

export function ColumnMenu({ view, rev, columnKey, label, pinned = false, allowAdd = false, section = "trademarks", kind = "column", prevKey = null, nextKey = null, firm = null }: ColumnMenuProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  const [side, setSide] = useState<"left" | "right">("right");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  const [name, setName] = useState(label);
  const [newKind, setNewKind] = useState<string>("text");
  const [choices, setChoices] = useState("");
  const wrap = useRef<HTMLSpanElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const restoreFocus = useRef(false);
  const id = useId();
  const moneyHintId = `${id}-money`;
  const change = useLayoutChange(view, rev);
  const aria = kind === "lane" ? laneMenuLabel(label) : columnMenuLabel(label);

  // `close` touches no ref: it is called from the items drawn in render. Focus goes back to the button when the panel was dismissed by
  // Esc or by a click inside it (the panel's own onClick raises the flag, as the shared Popover does), not by a click elsewhere.
  const close = () => {
    setOpen(false);
    setMode("menu");
    setError(null);
  };

  function toggle() {
    if (open) {
      restoreFocus.current = true;
      return close();
    }
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) {
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8));
      setPlace({ top: rect.bottom + 4, left });
    }
    setName(label);
    setChoices(firm?.options.join("\n") ?? "");
    setNote(null);
    setError(null);
    setMode("menu");
    setOpen(true);
  }

  // Esc, an outside press and a scroll or resize all close it; Esc claims the key so a dialog around it doesn't close too.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!popoverClaimsKey(e, true)) return;
      e.preventDefault();
      e.stopPropagation();
      restoreFocus.current = true;
      setOpen(false);
      setMode("menu");
    };
    // Scrolling INSIDE the panel (a long form) and the phone keyboard resizing the window (the width stays) must not close it.
    const width = window.innerWidth;
    const onScroll = (e: Event) => {
      if (panel.current && e.target instanceof Node && panel.current.contains(e.target)) return;
      setOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth !== width) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  // Focus: into the panel when it opens or changes mode, back to the button when it was dismissed.
  useEffect(() => {
    if (open) {
      panel.current?.querySelector<HTMLElement>("input, select, button:not(:disabled)")?.focus();
    } else if (restoreFocus.current) {
      trigger.current?.focus();
      restoreFocus.current = false;
    }
  }, [open, mode]);

  function arrows(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (mode !== "menu" || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const to = e.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    e.preventDefault();
    items[to].focus();
  }

  async function simple(op: Parameters<typeof change.run>[0]) {
    setError(null);
    const out = await change.run(op);
    if (out.ok) close();
    else setError(out.error);
  }

  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!firm) return simple({ op: "rename", key: columnKey, label: name });
    // A firm's own column: the FIELD is renamed (the record card and the name rules read it), and any view label is cleared.
    setError(null);
    const out = await change.firm({ op: "rename", key: columnKey, label: name });
    if (!out.ok) return setError(out.error);
    if (out.note) setNote(out.note);
    close();
  }

  async function firmAction(op: "options" | "archive") {
    setError(null);
    const out = await change.firm({ op, key: columnKey, ...(op === "options" ? { choices } : {}) });
    if (!out.ok) return setError(out.error);
    close();
  }

  async function submitAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    const out = await change.add({
      relativeTo: columnKey,
      side,
      label: String(form.get("label") ?? ""),
      section: String(form.get("section") ?? section),
      kind: String(form.get("kind") ?? "text"),
      choices: String(form.get("choices") ?? ""),
    });
    if (!out.ok) return setError(out.error);
    if (out.note) setNote(out.note);
    close();
  }

  const item = (text: string, onSelect: () => void, disabled = false) => (
    <button type="button" role="menuitem" className="lp-pop-item cm-item" disabled={disabled || change.pending} onClick={onSelect}>
      <span className="lp-pop-text">{text}</span>
    </button>
  );

  return (
    <span className="cm-wrap" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="cm-btn"
        aria-label={aria}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={toggle}
      >
        <Icon name="chevron-down" size={13} />
      </button>
      {note && (
        <span className="cm-note lx-note" role="status">
          {note}
        </span>
      )}
      {open && (
        <div id={id} ref={panel} className="cm-panel" aria-label={aria} style={{ ...place, width: PANEL_WIDTH }} onKeyDown={arrows} onClick={() => { restoreFocus.current = true; }}>
          {mode === "menu" && (
            <>
              {/* Only the items are the menu: the note and the error below are outside it. */}
              <div role="menu" aria-label={aria} className="cm-items">
                {menuItems({ pinned, allowAdd, hasPrev: prevKey !== null, hasNext: nextKey !== null, firm }).map((id) => {
                  switch (id) {
                    case "rename":
                      return <Fragment key={id}>{item(COLUMNS_RENAME, () => setMode("rename"))}</Fragment>;
                    case "hide":
                      return <Fragment key={id}>{item(COLUMN_MENU_HIDE, () => simple({ op: "hide", key: columnKey }))}</Fragment>;
                    case "left":
                      return <Fragment key={id}>{item(COLUMN_MENU_LEFT, () => simple({ op: "moveBeside", key: columnKey, relativeTo: prevKey ?? "", side: "left" }))}</Fragment>;
                    case "right":
                      return <Fragment key={id}>{item(COLUMN_MENU_RIGHT, () => simple({ op: "moveBeside", key: columnKey, relativeTo: nextKey ?? "", side: "right" }))}</Fragment>;
                    case "add-left":
                      return <Fragment key={id}>{item(COLUMN_MENU_ADD_LEFT, () => (setSide("left"), setMode("add")))}</Fragment>;
                    case "add-right":
                      return <Fragment key={id}>{item(COLUMN_MENU_ADD_RIGHT, () => (setSide("right"), setMode("add")))}</Fragment>;
                    case "choices":
                      return <Fragment key={id}>{item(COLUMN_MENU_EDIT_CHOICES, () => setMode("choices"))}</Fragment>;
                    case "archive":
                      return <Fragment key={id}>{item(COLUMN_MENU_ARCHIVE, () => setMode("archive"))}</Fragment>;
                  }
                })}
              </div>
              <p className="lx-note cm-foot">{COLUMN_CHANGES_NOTE}</p>
            </>
          )}
          {mode === "choices" && (
            <form className="cm-form" onSubmit={(e) => (e.preventDefault(), firmAction("options"))}>
              <label className="cm-field">
                <span className="lx-label">{COLUMNS_CHOICES_LABEL}</span>
                <textarea className="lx-input cm-textarea" value={choices} rows={5} onChange={(e) => setChoices(e.target.value)} />
              </label>
              <div className="cm-acts">
                <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={change.pending}>
                  {change.pending ? SAVING : COLUMN_CHOICES_SAVE}
                </button>
                <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => (setMode("menu"), setError(null))}>
                  {CANCEL}
                </button>
              </div>
            </form>
          )}
          {mode === "archive" && (
            <div className="cm-form">
              <p className="cm-title">{COLUMN_ARCHIVE_ASK}</p>
              <div className="cm-acts">
                <button type="button" className="lx-btn lx-btn-pri lx-btn-sm" disabled={change.pending} onClick={() => firmAction("archive")}>
                  {change.pending ? SAVING : COLUMN_ARCHIVE_CONFIRM}
                </button>
                <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => (setMode("menu"), setError(null))}>
                  {CANCEL}
                </button>
              </div>
            </div>
          )}
          {mode === "rename" && (
            <form className="cm-form" onSubmit={saveName}>
              <label className="cm-field">
                <span className="lx-label">{COLUMN_NEW_NAME_LABEL}</span>
                <input className="lx-input" name="label" type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
              </label>
              <div className="cm-acts">
                <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={change.pending}>
                  {change.pending ? SAVING : COLUMN_MENU_SAVE}
                </button>
                <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => (setMode("menu"), setError(null))}>
                  {CANCEL}
                </button>
              </div>
            </form>
          )}
          {mode === "add" && (
            <form className="cm-form" onSubmit={submitAdd}>
              <p className="cm-title">{COLUMNS_ADD}</p>
              <label className="cm-field">
                <span className="lx-label">{COLUMN_NEW_NAME_LABEL}</span>
                <input className="lx-input" name="label" type="text" required maxLength={60} />
              </label>
              <label className="cm-field">
                <span className="lx-label">{COLUMNS_KIND_LABEL}</span>
                <select className="lx-input" name="kind" value={newKind} onChange={(e) => setNewKind(e.target.value)} aria-describedby={moneyHintId}>
                  {CUSTOM_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {CUSTOM_KIND_WORDS[k]}
                    </option>
                  ))}
                </select>
              </label>
              {/* Outside the label (so it isn't part of the select's name), tied to the select by aria-describedby. */}
              <p id={moneyHintId} className="lx-note">
                {COLUMNS_KIND_MONEY_HINT}
              </p>
              <label className="cm-field">
                <span className="lx-label">{COLUMNS_SECTION_LABEL}</span>
                <select className="lx-input" name="section" defaultValue={section}>
                  {CUSTOM_SECTIONS.filter((s) => s === "both" || s === section).map((s) => (
                    <option key={s} value={s}>
                      {CUSTOM_SECTION_WORDS[s]}
                    </option>
                  ))}
                </select>
              </label>
              {newKind === "choice" && (
                <label className="cm-field">
                  <span className="lx-label">{COLUMNS_CHOICES_LABEL}</span>
                  <textarea className="lx-input cm-textarea" name="choices" rows={3} />
                  <span className="lx-note">{COLUMNS_CHOICES_HINT}</span>
                </label>
              )}
              <div className="cm-acts">
                <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={change.pending}>
                  {change.pending ? SAVING : COLUMN_ADD_SUBMIT}
                </button>
                <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => (setMode("menu"), setError(null))}>
                  {CANCEL}
                </button>
              </div>
            </form>
          )}
          <p className="cm-error lx-note" role="alert" aria-live="assertive">
            {error ?? ""}
          </p>
        </div>
      )}
    </span>
  );
}
