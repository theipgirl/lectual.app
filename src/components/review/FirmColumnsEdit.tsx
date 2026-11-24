"use client";

import { useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { setCustomValueAction } from "@/lib/custom-columns/actions";
import { customUnchanged, editorForm } from "@/lib/custom-columns/input";
import { typedCell, type CustomMember, type FirmColumnItem } from "@/lib/custom-columns/rules";
import { customColumnId } from "@/lib/review/sheet-columns";
import { EMPTY_SHEET_STATE, cellKey, keptNote, sheetReducer, type CellValue } from "@/lib/review/sheet-edit";
import type { FactCell } from "@/lib/review/sheet-cells";
import {
  BLANK,
  CUSTOM_FROM_LEAD,
  CUSTOM_FROM_MERGED,
  CUSTOM_NO_ONE,
  CUSTOM_VALUE_SAVE_FAILED,
  RECORD_CARD_SAVED,
  RECORD_CARD_SAVING,
  customCellLabel,
  fromLeadHint,
  fromMergedHint,
  noLongerAChoice,
} from "@/lib/ui/words";
import { Icon } from "@/components/ui/Icon";
import { CustomValueField } from "./CustomValueInput";
import { ChoicePop, PersonPop, type SheetPerson } from "./SheetEditTable";
import "./review-sheet-edit.css";

/**
 * "Firm columns" on the opened card, for a staff role (the page passes `edit` on each item only for a role in
 * CUSTOM_VALUE_WRITE_ROLES; a viewer never reaches this component). One `<form>` per column, posting the field, the RECORD kind and id
 * (the record the card shows: a merged lead's keeper, the matter for a matter showing its lead's value) and the value to
 * `setCustomValueAction`, which re-checks everything. The same rules as the owner Sheet: the editor opens on the record's OWN value
 * with a visible line for an inherited one, an unchanged editor posts nothing, "Saved" only after the server says so, and a refusal
 * puts the own value back with the action's sentence.
 */

let seqCounter = 0;
const nextSeq = () => (seqCounter += 1);

type OpenPicker = { open: string | null };

export function FirmColumnsEdit({ items, members, recordKey, today }: { items: FirmColumnItem[]; members: CustomMember[] | null; recordKey: string; today: string }) {
  const [state, dispatch] = useReducer(sheetReducer, EMPTY_SHEET_STATE);
  const [pick, setPick] = useState<OpenPicker>({ open: null });
  const router = useRouter();
  // Fresh props are the truth: keep only what is still saving.
  useEffect(() => {
    dispatch({ type: "refreshed" });
  }, [items]);
  const people: SheetPerson[] = (members ?? []).map((m) => ({ userId: m.userId, name: m.name, short: m.name, roleLabel: "" }));

  /** null: unchanged, nothing posted; true: saved; false: refused (the own value goes back). */
  async function submit(item: FirmColumnItem, form: HTMLFormElement, typed: string): Promise<boolean | null> {
    const edit = item.edit!;
    if (customUnchanged(edit.kind, typed, edit.own, edit.options)) return null;
    const col = customColumnId(edit.fieldId);
    const cell = cellKey(recordKey, col);
    const norm = editorForm(edit.kind, typed, edit.kind === "choice" ? [...edit.options, typed] : edit.options);
    const raw = norm === undefined ? typed : (norm ?? "");
    const inherited = edit.inherited ? { [col]: { from: edit.inherited.from, cell: { text: edit.inherited.text, tone: "value" as const, title: edit.inherited.from === "lead" ? CUSTOM_FROM_LEAD : CUSTOM_FROM_MERGED } } } : {};
    const value: CellValue = { col, raw, shown: typedCell({ kind: edit.kind, options: edit.options }, typed, members, today) };
    const note = keptNote({ customOwn: { [col]: edit.own }, customInherited: inherited }, value);
    const mine = nextSeq();
    dispatch({ type: "start", cell, seq: mine, value, client: "", field: col, label: item.label });
    const fd = new FormData(form);
    fd.set("value", raw);
    let ok = false;
    let message: string = CUSTOM_VALUE_SAVE_FAILED;
    try {
      const res = await setCustomValueAction({}, fd);
      ok = !!res.saved;
      if (!ok && res.error) message = res.error;
    } catch {
      ok = false;
    }
    if (!ok) {
      dispatch({ type: "failed", cell, seq: mine, client: "", field: col, message, label: item.label });
      return false;
    }
    dispatch({ type: "saved", cell, seq: mine, client: "", field: col, label: item.label, note });
    router.refresh();
    return true;
  }

  const status = state.status;
  const statusText = !status ? "" : status.tone === "saving" ? RECORD_CARD_SAVING : status.tone === "saved" ? (status.note ?? RECORD_CARD_SAVED) : (status.message ?? CUSTOM_VALUE_SAVE_FAILED);

  return (
    <div className="rv-fc-edit">
      <dl className="rv-cardx-facts">
        {items.map((item, i) => {
          const key = `${i}:${item.label}`;
          if (!item.edit) {
            return (
              <div key={key}>
                <dt className="lx-label">{item.label}</dt>
                <dd>
                  <ReadCell cell={item.cell} />
                </dd>
              </div>
            );
          }
          const edit = item.edit;
          const col = customColumnId(edit.fieldId);
          const override = state.overrides[cellKey(recordKey, col)];
          const shown: FactCell = override && "raw" in override ? (override.raw.trim() === "" ? (edit.inherited ? { text: edit.inherited.text, tone: "value", title: edit.inherited.from === "lead" ? CUSTOM_FROM_LEAD : CUSTOM_FROM_MERGED } : { text: BLANK, tone: "none" }) : (override.shown ?? item.cell)) : item.cell;
          const hint = edit.own === null && edit.inherited ? (edit.inherited.from === "lead" ? fromLeadHint(edit.inherited.text) : fromMergedHint(edit.inherited.text)) : undefined;
          const inputId = `rv-fc-${recordKey.replace(/[^A-Za-z0-9_-]/g, "")}-${edit.fieldId}`;
          return (
            <div key={`${key}:${edit.own ?? ""}`}>
              <dt className="lx-label">
                {edit.kind === "text" || edit.kind === "money" || edit.kind === "date" ? <label htmlFor={inputId}>{item.label}</label> : item.label}
              </dt>
              <dd className="rv-fc-cell">
                <ItemForm item={item} inputId={inputId} hint={hint} shown={shown} people={people} open={pick.open === col} setOpen={(o) => setPick({ open: o ? col : null })} onSubmit={submit} />
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="lx-note rv-fc-status" role="status" aria-live="polite">
        {statusText}
      </p>
    </div>
  );
}

function ReadCell({ cell }: { cell: FactCell }) {
  return cell.tone === "value" ? (
    <span title={cell.title}>{cell.text}</span>
  ) : (
    <span className="lx-note" title={cell.title}>
      {cell.text}
    </span>
  );
}

function ItemForm({
  item,
  inputId,
  hint,
  shown,
  people,
  open,
  setOpen,
  onSubmit,
}: {
  item: FirmColumnItem;
  inputId: string;
  hint?: string;
  shown: FactCell;
  people: SheetPerson[];
  open: boolean;
  setOpen: (open: boolean) => void;
  onSubmit: (item: FirmColumnItem, form: HTMLFormElement, typed: string) => Promise<boolean | null>;
}) {
  const edit = item.edit!;
  const [typed, setTyped] = useState(edit.own ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hidden = (
    <>
      <input type="hidden" name="fieldId" value={edit.fieldId} />
      <input type="hidden" name="kind" value={edit.recordKind} />
      <input type="hidden" name="id" value={edit.recordId} />
    </>
  );
  const submitTyped = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    void onSubmit(item, form, typed).then((ok) => {
      // A refusal puts the own value back in the box; a save stays until the refreshed props replace it.
      if (ok === false) setTyped(edit.own ?? "");
    });
  };
  if (edit.kind === "text" || edit.kind === "money" || edit.kind === "date") {
    return (
      <form ref={formRef} onSubmit={submitTyped} data-firm-column={edit.fieldId}>
        {hidden}
        <CustomValueField id={inputId} kind={edit.kind} label={item.label} name="value" value={typed} onChange={setTyped} hint={hint} inputClassName="lx-input" />
      </form>
    );
  }
  const choose = (raw: string) => {
    setOpen(false);
    buttonRef.current?.focus();
    if (formRef.current) void onSubmit(item, formRef.current, raw);
  };
  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };
  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} data-firm-column={edit.fieldId}>
      {hidden}
      <input type="hidden" name="value" value={edit.own ?? ""} />
      <button
        ref={buttonRef}
        type="button"
        className="lx-btn lx-btn-sec lx-btn-sm rv-fc-pick"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={customCellLabel(item.label, shown.text)}
        title={shown.title}
        onClick={() => setOpen(!open)}
      >
        {shown.text}
        <Icon name="chevron-down" size={14} />
      </button>
      {hint && <span className="rse-ed-hint">{hint}</span>}
      {open && edit.kind === "choice" && (
        <ChoicePop
          label={item.label}
          options={[
            { id: "", label: BLANK, selected: edit.own === null },
            ...edit.options.map((o) => ({ id: o, label: o, selected: edit.own === o })),
            ...(edit.own !== null && !edit.options.includes(edit.own) ? [{ id: edit.own, label: noLongerAChoice(edit.own), selected: true }] : []),
          ]}
          onPick={choose}
          onCancel={close}
          onTab={close}
        />
      )}
      {open && edit.kind === "person" && <PersonPop people={people} current={edit.own} label={item.label} clearLabel={CUSTOM_NO_ONE} onPick={(userId) => choose(userId ?? "")} onCancel={close} onTab={close} />}
    </form>
  );
}
