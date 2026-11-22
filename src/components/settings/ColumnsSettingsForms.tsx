"use client";

import { startTransition, useActionState } from "react";
import { createFieldAction, updateFieldAction } from "@/lib/custom-columns/actions";
import type { ActionState } from "@/lib/custom-columns/field-actions";
import { CUSTOM_KINDS, CUSTOM_KIND_WORDS, CUSTOM_SECTIONS } from "@/lib/review/sheet-columns";
import { InlineConfirm } from "@/components/ui/InlineConfirm";
import {
  COLUMNS_ADD,
  COLUMNS_ARCHIVE,
  COLUMNS_CHOICES_HINT,
  COLUMNS_CHOICES_LABEL,
  COLUMNS_EDIT_CHOICES,
  COLUMNS_KIND_LABEL,
  COLUMNS_NAME_LABEL,
  COLUMNS_RENAME,
  COLUMNS_RESTORE,
  COLUMNS_SAVE_CHOICES,
  COLUMNS_SAVE_NAME,
  COLUMNS_SECTION_LABEL,
  COLUMNS_USE_UNCOUNTED,
  CUSTOM_SECTION_WORDS,
  RECORD_CARD_SAVED,
  SAVING,
  archiveQuestion,
  choiceUse,
  columnsArchiveLabel,
  columnsChoicesFor,
  columnsMoveDown,
  columnsMoveUp,
  columnsRenameLabel,
  columnsRestoreLabel,
  COLUMNS_MOVE_DOWN,
  COLUMNS_MOVE_UP,
} from "@/lib/ui/words";

/**
 * The forms of Settings -> Columns. Each posts only what its op needs (`id`, `op`, and the label, the choices or the direction) plus,
 * for Rename and Edit choices, the `updated_at` the row was drawn with, which the action only compares. The action re-resolves the role,
 * reads the column again and answers a fixed sentence, shown in a polite live line; "Saved" only after `{ saved: true }`.
 */

const EMPTY: ActionState = {};

function Outcome({ state }: { state: ActionState }) {
  return (
    <p className="lx-note cs-outcome" aria-live="polite">
      {state.error ?? (state.saved ? RECORD_CARD_SAVED : "")}
    </p>
  );
}

const fieldKey = (id: string, what: string) => `cs-${what}-${id}`;

export function AddColumnForm() {
  const [state, action, pending] = useActionState(createFieldAction, EMPTY);
  return (
    <form action={action} className="cs-form cs-add">
      <label className="cs-field">
        <span className="lx-label">{COLUMNS_NAME_LABEL}</span>
        <input className="lx-input" name="label" type="text" required />
      </label>
      <label className="cs-field">
        <span className="lx-label">{COLUMNS_SECTION_LABEL}</span>
        <select className="lx-input" name="section" defaultValue="trademarks">
          {CUSTOM_SECTIONS.map((s) => (
            <option key={s} value={s}>
              {CUSTOM_SECTION_WORDS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="cs-field">
        <span className="lx-label">{COLUMNS_KIND_LABEL}</span>
        <select className="lx-input" name="kind" defaultValue="text">
          {CUSTOM_KINDS.map((k) => (
            <option key={k} value={k}>
              {CUSTOM_KIND_WORDS[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="cs-field cs-field-wide">
        <span className="lx-label">{COLUMNS_CHOICES_LABEL}</span>
        <textarea className="lx-input cs-textarea" name="choices" rows={3} />
        <span className="lx-note">{COLUMNS_CHOICES_HINT}</span>
      </label>
      <div className="cs-form-acts">
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? SAVING : COLUMNS_ADD}
        </button>
        <Outcome state={state} />
      </div>
    </form>
  );
}

export function RenameForm({ id, label, updatedAt }: { id: string; label: string; updatedAt: string }) {
  const [state, action, pending] = useActionState(updateFieldAction, EMPTY);
  return (
    <details className="cs-more">
      <summary className="lx-btn lx-btn-sec lx-btn-sm">{COLUMNS_RENAME}</summary>
      <form action={action} className="cs-form">
        <input type="hidden" name="op" value="rename" />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="updatedAt" value={updatedAt} />
        <label className="cs-field">
          <span className="lx-label">{columnsRenameLabel(label)}</span>
          <input className="lx-input" name="label" type="text" defaultValue={label} id={fieldKey(id, "label")} required />
        </label>
        <div className="cs-form-acts">
          <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
            {pending ? SAVING : COLUMNS_SAVE_NAME}
          </button>
          <Outcome state={state} />
        </div>
      </form>
    </details>
  );
}

export function ChoicesForm({ id, label, options, updatedAt, use }: { id: string; label: string; options: string[]; updatedAt: string; /** Use per choice; null when the count read failed. */ use: Record<string, number> | null }) {
  const [state, action, pending] = useActionState(updateFieldAction, EMPTY);
  return (
    <details className="cs-more">
      <summary className="lx-btn lx-btn-sec lx-btn-sm">{COLUMNS_EDIT_CHOICES}</summary>
      <form action={action} className="cs-form">
        <input type="hidden" name="op" value="options" />
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="updatedAt" value={updatedAt} />
        <label className="cs-field cs-field-wide">
          <span className="lx-label">{columnsChoicesFor(label)}</span>
          <textarea className="lx-input cs-textarea" name="choices" rows={Math.min(8, Math.max(3, options.length + 1))} defaultValue={options.join("\n")} />
        </label>
        {use === null ? (
          <p className="lx-note cs-use">{COLUMNS_USE_UNCOUNTED}</p>
        ) : (
          <ul className="cs-use-list">
            {options.map((o) => (
              <li key={o} className="lx-note cs-use">
                {choiceUse(o, use[o] ?? 0)}
              </li>
            ))}
          </ul>
        )}
        <div className="cs-form-acts">
          <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
            {pending ? SAVING : COLUMNS_SAVE_CHOICES}
          </button>
          <Outcome state={state} />
        </div>
      </form>
    </details>
  );
}

/** Move up / Move down in the firm's ONE column order. Posts only the id, the op and the direction. */
export function MoveColumn({ id, label, first, last }: { id: string; label: string; first: boolean; last: boolean }) {
  const [state, action, pending] = useActionState(updateFieldAction, EMPTY);
  return (
    <form action={action} className="cs-move">
      <input type="hidden" name="op" value="move" />
      <input type="hidden" name="id" value={id} />
      <button type="submit" name="dir" value="up" className="lx-btn lx-btn-sec lx-btn-sm" aria-label={columnsMoveUp(label)} disabled={first || pending}>
        {COLUMNS_MOVE_UP}
      </button>
      <button type="submit" name="dir" value="down" className="lx-btn lx-btn-sec lx-btn-sm" aria-label={columnsMoveDown(label)} disabled={last || pending}>
        {COLUMNS_MOVE_DOWN}
      </button>
      <Outcome state={state} />
    </form>
  );
}

/** Archive asks first (it takes the column off the List; its values are kept). */
export function ArchiveColumn({ id, label, initial = "idle" }: { id: string; label: string; initial?: "idle" | "asking" }) {
  const [state, action, pending] = useActionState(updateFieldAction, EMPTY);
  return (
    <div className="cs-archive" aria-label={columnsArchiveLabel(label)} role="group">
      <InlineConfirm
        label={COLUMNS_ARCHIVE}
        question={archiveQuestion(label)}
        pending={pending}
        initial={initial}
        className="lx-btn lx-btn-ghost lx-btn-sm"
        onConfirm={() => {
          const form = new FormData();
          form.set("op", "archive");
          form.set("id", id);
          startTransition(() => action(form));
        }}
      />
      <Outcome state={state} />
    </div>
  );
}

/** Restore removes nothing, so it does not ask. */
export function RestoreColumn({ id, label }: { id: string; label: string }) {
  const [state, action, pending] = useActionState(updateFieldAction, EMPTY);
  return (
    <form action={action} className="cs-move">
      <input type="hidden" name="op" value="restore" />
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" aria-label={columnsRestoreLabel(label)} disabled={pending}>
        {pending ? SAVING : COLUMNS_RESTORE}
      </button>
      <Outcome state={state} />
    </form>
  );
}
