"use client";

import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { popoverClaimsKey } from "@/lib/ui/dialog-keys";
import { changeStageAction } from "@/lib/stages/actions";
import type { StageMenuModel } from "@/lib/stages/menu-model";
import {
  CANCEL,
  COLUMN_MENU_LEFT,
  COLUMN_MENU_RIGHT,
  COLUMN_MENU_SAVE,
  SAVING,
  STAGE_ADD_SUBMIT,
  STAGE_CHANGES_NOTE,
  STAGE_CHANGE_FAILED,
  STAGE_DELETE_ALSO_OPEN,
  STAGE_DELETE_CHOOSE,
  STAGE_DELETE_CONFIRM,
  STAGE_HOLDINGS_UNREADABLE,
  STAGE_LAST_OPEN,
  STAGE_MENU_ADD_LEFT,
  STAGE_MENU_ADD_RIGHT,
  STAGE_MENU_DELETE,
  STAGE_MENU_OPEN_CLOSED,
  STAGE_MENU_RENAME,
  STAGE_MENU_TYPE,
  STAGE_NAME_LABEL,
  STAGE_NO_DESTINATION,
  STAGE_NO_WON_TICK,
  STAGE_OPEN_LABEL,
  STAGE_OPEN_WORDS,
  STAGE_ROLE_DROP,
  STAGE_ROLE_WORDS,
  STAGE_TYPE_LABEL,
  STAGE_TYPE_ONLY_EMPTY,
  STAGE_TYPE_WORDS,
  STAGE_WAITS_ON_LABEL,
  STAGE_WAITS_ON_WORDS,
  STAGE_WON_WARNING,
  stageDeleteAsk,
  stageDeleteHolds,
  stageDeleteMoveTo,
  stageMenuLabel,
  stageRoleAsk,
} from "@/lib/ui/words";
import "../layout/layout-edit.css";

/**
 * The owner's menu on a STAGE column of the Leads or Matters board (spec-editable-views.md 3b). The page draws it only for an owner
 * (membership row), never in a preview; every action asks the row again and the database (lectual 0119) holds every rule. One button
 * opens a small panel: Rename, Move left / right (beside the visible neighbour), Add a stage left / right, Change type (only while the
 * stage is empty), Delete. Delete shows how many records the stage holds and sends back exactly the ids it showed, so a record that
 * moved meanwhile makes the database refuse ("Some records moved since you opened this").
 *
 * Positioned on the page (`position: fixed`), like the column menu, because a board scrolls sideways. Esc, an outside press and a
 * scroll or resize close it; focus returns to the button after Esc.
 */
type Mode = "menu" | "rename" | "add" | "type" | "delete";
const PANEL_WIDTH = 312;
const CATEGORIES = ["open", "won", "lost", "nurture"] as const;
const WAITS = ["firm", "client", "uspto", "court"] as const;

export function StageMenu({ model }: { model: StageMenuModel }) {
  const router = useRouter();
  const { stage, kind } = model;
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("menu");
  const [side, setSide] = useState<"left" | "right">("right");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [place, setPlace] = useState<CSSProperties>({});
  const [name, setName] = useState(stage.name);
  const [category, setCategory] = useState<string>("open");
  const [alsoFlip, setAlsoFlip] = useState(false);
  const [noWon, setNoWon] = useState(false);
  const wrap = useRef<HTMLSpanElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const panel = useRef<HTMLDivElement | null>(null);
  const restoreFocus = useRef(false);
  const id = useId();
  const aria = stageMenuLabel(stage.name);

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
    if (rect) setPlace({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8)) });
    setName(stage.name);
    setCategory(kind === "lead" ? (stage.category ?? "open") : stage.isOpen === false ? "closed" : "open");
    setAlsoFlip(false);
    setNoWon(false);
    setNote(null);
    setError(null);
    setMode("menu");
    setOpen(true);
  }

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

  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>("input, select, button:not(:disabled)")?.focus();
    else if (restoreFocus.current) {
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

  async function run(op: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const out = await changeStageAction(kind, op);
      if (!out.ok) return setError(out.error);
      if (out.note) setNote(out.note);
      close();
      router.refresh();
    } catch {
      setError(STAGE_CHANGE_FAILED);
    } finally {
      setPending(false);
    }
  }

  function submitAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const label = String(form.get("name") ?? "");
    if (kind === "lead") return run({ op: "add", beside: stage.id, side, name: label, category: String(form.get("category") ?? "open") });
    return run({ op: "add", beside: stage.id, side, name: label, isOpen: form.get("open") !== "closed", waitingOn: String(form.get("waitingOn") ?? "firm") });
  }

  function submitType(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (kind === "lead") return run({ op: "category", stageId: stage.id, category, confirmNoWon: noWon });
    return run({ op: "open", stageId: stage.id, isOpen: category !== "closed" });
  }

  function submitDelete(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!model.delete.available) return;
    const form = new FormData(e.currentTarget);
    const roleTo = String(form.get("roleTo") ?? "");
    return run({
      op: "delete",
      stageId: stage.id,
      // Exactly the records this dialog counted, as the page read them.
      expectedIds: model.delete.ids,
      destination: String(form.get("destination") ?? "") || null,
      roleTo: roleTo && roleTo !== "drop" ? roleTo : null,
      ...(kind === "lead" ? { confirmNoWon: noWon } : { confirmOpenChange: alsoFlip }),
    });
  }

  const item = (text: string, onSelect: () => void, disabled = false, title?: string) => (
    <button type="button" role="menuitem" className="lp-pop-item cm-item" disabled={disabled || pending} onClick={onSelect} title={title}>
      <span className="lp-pop-text">{text}</span>
    </button>
  );
  const actions = (submit: string) => (
    <div className="cm-acts">
      <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
        {pending ? SAVING : submit}
      </button>
      <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => (setMode("menu"), setError(null))}>
        {CANCEL}
      </button>
    </div>
  );

  const del = model.delete;
  const holdsCount = model.holds?.length ?? 0;
  const destinations = del.available ? [...del.destinations, ...(alsoFlip ? del.otherOpenDestinations : [])] : [];
  const nameMax = kind === "lead" ? 80 : 200;

  return (
    <span className="cm-wrap" ref={wrap}>
      <button ref={trigger} type="button" className="cm-btn" aria-label={aria} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}>
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
              <div role="menu" aria-label={aria} className="cm-items">
                {item(STAGE_MENU_RENAME, () => setMode("rename"))}
                {model.prevId && <Fragment>{item(COLUMN_MENU_LEFT, () => run({ op: "move", stageId: stage.id, beside: model.prevId, side: "left" }))}</Fragment>}
                {model.nextId && <Fragment>{item(COLUMN_MENU_RIGHT, () => run({ op: "move", stageId: stage.id, beside: model.nextId, side: "right" }))}</Fragment>}
                {item(STAGE_MENU_ADD_LEFT, () => (setSide("left"), setCategory("open"), setMode("add")))}
                {item(STAGE_MENU_ADD_RIGHT, () => (setSide("right"), setCategory("open"), setMode("add")))}
                {item(kind === "lead" ? STAGE_MENU_TYPE : STAGE_MENU_OPEN_CLOSED, () => setMode("type"), !model.canChangeType, model.canChangeType ? undefined : STAGE_TYPE_ONLY_EMPTY)}
                {item(STAGE_MENU_DELETE, () => (setAlsoFlip(false), setNoWon(false), setMode("delete")))}
              </div>
              {!model.canChangeType && <p className="lx-note cm-foot">{STAGE_TYPE_ONLY_EMPTY}</p>}
              <p className="lx-note cm-foot">{STAGE_CHANGES_NOTE}</p>
            </>
          )}
          {mode === "rename" && (
            <form className="cm-form" onSubmit={(e) => (e.preventDefault(), run({ op: "rename", stageId: stage.id, name }))}>
              <label className="cm-field">
                <span className="lx-label">{STAGE_NAME_LABEL}</span>
                <input className="lx-input" type="text" value={name} maxLength={nameMax} required onChange={(e) => setName(e.target.value)} />
              </label>
              {actions(COLUMN_MENU_SAVE)}
            </form>
          )}
          {mode === "add" && (
            <form className="cm-form" onSubmit={submitAdd}>
              <p className="cm-title">{side === "left" ? STAGE_MENU_ADD_LEFT : STAGE_MENU_ADD_RIGHT}</p>
              <label className="cm-field">
                <span className="lx-label">{STAGE_NAME_LABEL}</span>
                <input className="lx-input" name="name" type="text" required maxLength={nameMax} />
              </label>
              {kind === "lead" ? (
                <>
                  <label className="cm-field">
                    <span className="lx-label">{STAGE_TYPE_LABEL}</span>
                    <select className="lx-input" name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {STAGE_TYPE_WORDS[c]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {category === "won" && <p className="lx-note">{STAGE_WON_WARNING}</p>}
                </>
              ) : (
                <>
                  <label className="cm-field">
                    <span className="lx-label">{STAGE_OPEN_LABEL}</span>
                    <select className="lx-input" name="open" defaultValue={stage.isOpen === false ? "closed" : "open"}>
                      <option value="open">{STAGE_OPEN_WORDS.open}</option>
                      <option value="closed">{STAGE_OPEN_WORDS.closed}</option>
                    </select>
                  </label>
                  <label className="cm-field">
                    <span className="lx-label">{STAGE_WAITS_ON_LABEL}</span>
                    <select className="lx-input" name="waitingOn" defaultValue="firm">
                      {WAITS.map((w) => (
                        <option key={w} value={w}>
                          {STAGE_WAITS_ON_WORDS[w]}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              {actions(STAGE_ADD_SUBMIT)}
            </form>
          )}
          {mode === "type" && (
            <form className="cm-form" onSubmit={submitType}>
              <label className="cm-field">
                <span className="lx-label">{kind === "lead" ? STAGE_TYPE_LABEL : STAGE_OPEN_LABEL}</span>
                <select className="lx-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                  {kind === "lead"
                    ? CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {STAGE_TYPE_WORDS[c]}
                        </option>
                      ))
                    : (["open", "closed"] as const).map((c) => (
                        <option key={c} value={c}>
                          {STAGE_OPEN_WORDS[c]}
                        </option>
                      ))}
                </select>
              </label>
              {kind === "lead" && category === "won" && stage.category !== "won" && <p className="lx-note">{STAGE_WON_WARNING}</p>}
              {kind === "lead" && model.lastWon && category !== "won" && (
                <label className="cm-field cm-tick">
                  <span>
                    <input type="checkbox" checked={noWon} onChange={(e) => setNoWon(e.target.checked)} /> {STAGE_NO_WON_TICK}
                  </span>
                </label>
              )}
              {actions(COLUMN_MENU_SAVE)}
            </form>
          )}
          {mode === "delete" && (
            <form className="cm-form" onSubmit={submitDelete}>
              <p className="cm-title">{stageDeleteAsk(stage.name)}</p>
              {!del.available ? (
                <>
                  <p className="lx-note">{del.reason === "last-open" ? STAGE_LAST_OPEN : STAGE_HOLDINGS_UNREADABLE}</p>
                  <div className="cm-acts">
                    <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => setMode("menu")}>
                      {CANCEL}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="lx-note">{stageDeleteHolds(holdsCount, kind)}</p>
                  {holdsCount > 0 && kind === "matter" && del.otherOpenDestinations.length > 0 && (
                    <label className="cm-field cm-tick">
                      <span>
                        <input type="checkbox" checked={alsoFlip} onChange={(e) => setAlsoFlip(e.target.checked)} /> {STAGE_DELETE_ALSO_OPEN}
                      </span>
                    </label>
                  )}
                  {holdsCount > 0 &&
                    (destinations.length > 0 ? (
                      <label className="cm-field">
                        <span className="lx-label">{stageDeleteMoveTo(holdsCount, kind)}</span>
                        <select className="lx-input" name="destination" required defaultValue="">
                          <option value="" disabled>
                            {STAGE_DELETE_CHOOSE}
                          </option>
                          {destinations.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <p className="lx-note">{STAGE_NO_DESTINATION}</p>
                    ))}
                  {del.role && (
                    <label className="cm-field">
                      <span className="lx-label">{stageRoleAsk(STAGE_ROLE_WORDS[del.role.role] ?? del.role.role)}</span>
                      <select className="lx-input" name="roleTo" required defaultValue="">
                        <option value="" disabled>
                          {STAGE_DELETE_CHOOSE}
                        </option>
                        {del.role.targets.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                        {del.role.canDrop && <option value="drop">{STAGE_ROLE_DROP}</option>}
                      </select>
                    </label>
                  )}
                  {del.lastWon && (
                    <label className="cm-field cm-tick">
                      <span>
                        <input type="checkbox" checked={noWon} onChange={(e) => setNoWon(e.target.checked)} required /> {STAGE_NO_WON_TICK}
                      </span>
                    </label>
                  )}
                  <div className="cm-acts">
                    <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending || (holdsCount > 0 && destinations.length === 0)}>
                      {pending ? SAVING : STAGE_DELETE_CONFIRM}
                    </button>
                    <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => (setMode("menu"), setError(null))}>
                      {CANCEL}
                    </button>
                  </div>
                </>
              )}
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
