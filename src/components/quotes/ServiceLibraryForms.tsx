"use client";

import { useActionState, useState } from "react";
import {
  archiveServiceItemAction,
  createServiceItemAction,
  restoreServiceItemAction,
  updateServiceItemAction,
} from "@/app/dashboard/settings/services/actions";
import "@/app/dashboard/quotes/quotes.css";
import type { ActionState } from "@/app/dashboard/quotes/errors";
import { CHARGE_AT_LABEL, KIND_LABEL, QUOTE_LINE_KINDS, chargeAtLabel, chargeAtOptionsFor, kindLabel } from "@/lib/quotes/labels";
import { centsToInput } from "@/lib/quotes/money";
import { formatMoney } from "@/lib/ui/format";
import { Notice } from "@/components/ui/Notice";
import { Pill, type PillTone } from "@/components/ui/Pill";
import type { ServiceItemRow } from "@/lib/quotes/types";
import { SAVING, OPTIONAL } from "@/lib/ui/words";

/**
 * The service library's forms. The library is the firm's standing price list
 * — configuration, admin-only — and a quote line COPIES an item's values, so
 * nothing here ever changes a quote that was already built.
 */

function Err({ state }: { state: ActionState }) {
  return state.error ? (
    <Notice tone="risk" role="alert">
      {state.error}
    </Notice>
  ) : null;
}

/**
 * Label, kind, default schedule, price, description. Spec §0's UI rule applies
 * at the SOURCE of the default a line copies from: a government-fee item is
 * never offered "At signing" — a signing-default USPTO item would be a loaded
 * gun sitting in the picker. The store refuses it too, and so does 0068.
 */
function ItemFields({ item, disabled }: { item?: ServiceItemRow; disabled: boolean }) {
  const [kind, setKind] = useState<string>(item?.kind ?? "legal_fee");
  const [chargeAt, setChargeAt] = useState<string>(item?.charge_at ?? "signing");
  const options = chargeAtOptionsFor(kind);
  const effectiveChargeAt = options.includes(chargeAt as never) ? chargeAt : options[0];

  function onKindChange(next: string) {
    setKind(next);
    const nextOptions = chargeAtOptionsFor(next);
    if (!nextOptions.includes(chargeAt as never)) setChargeAt(nextOptions[0]);
  }

  return (
    <>
      <input type="hidden" name="chargeAt" value={effectiveChargeAt} />
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Label</span>
        <input className="lx-input" name="label" required maxLength={200} defaultValue={item?.label ?? ""} disabled={disabled} placeholder="e.g. Trademark application — one class" />
      </label>
      <label className="lx-field">
        <span className="lx-label">Kind</span>
        <select className="lx-input" name="kind" value={kind} onChange={(e) => onKindChange(e.target.value)} disabled={disabled}>
          {QUOTE_LINE_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="lx-field">
        <span className="lx-label">Charged by default</span>
        <select className="lx-input" value={effectiveChargeAt} onChange={(e) => setChargeAt(e.target.value)} disabled={disabled}>
          {options.map((c) => (
            <option key={c} value={c}>
              {CHARGE_AT_LABEL[c]}
            </option>
          ))}
        </select>
      </label>
      <label className="lx-field">
        <span className="lx-label">{kind === "discount" ? "Discount ($)" : "Price ($)"}</span>
        <input className="lx-input lx-num" name="amount" inputMode="decimal" required defaultValue={item ? centsToInput(item.unit_amount_cents) : ""} placeholder="0.00" disabled={disabled} />
      </label>
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Description<span className="lx-optional"> {OPTIONAL}</span></span>
        <input className="lx-input" name="description" maxLength={2000} defaultValue={item?.description ?? ""} disabled={disabled} />
      </label>
    </>
  );
}

export function NewServiceItemForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createServiceItemAction, {});
  // Re-mount the fields after a successful add so the form is empty again.
  const [round, setRound] = useState(0);
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state.saved) setRound((r) => r + 1);
  }
  return (
    <form action={action} className="lx-form-grid" key={round}>
      <ItemFields disabled={pending} />
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? SAVING : "Add service"}
        </button>
        <Err state={state} />
      </div>
    </form>
  );
}

const KIND_TONE: Record<string, PillTone> = {
  legal_fee: "ox",
  government_fee: "warn",
  expense: "mute",
  discount: "risk",
};

/** One library item: summary, edit, archive/restore. */
export function ServiceItemRowEditor({ item, canEdit }: { item: ServiceItemRow; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [updateState, updateAction, updating] = useActionState<ActionState, FormData>(async (prev: ActionState, fd: FormData) => {
    const next = await updateServiceItemAction(prev, fd);
    if (!next.error) setEditing(false);
    return next;
  }, {});
  const [archiveState, archiveAction, archiving] = useActionState<ActionState, FormData>(archiveServiceItemAction, {});
  const [restoreState, restoreAction, restoring] = useActionState<ActionState, FormData>(restoreServiceItemAction, {});
  const toggling = archiving || restoring;

  return (
    <li className="qb-svc-item">
      <div className="qb-svc-head">
        <Pill tone={KIND_TONE[item.kind] ?? "mute"}>{kindLabel(item.kind)}</Pill>
        <Pill tone="mute">{chargeAtLabel(item.charge_at)}</Pill>
        {!item.active && <Pill tone="mute">Archived</Pill>}
        <span className="qb-svc-label" data-active={item.active}>{item.label}</span>
        <span className="qb-svc-price">{formatMoney(item.unit_amount_cents)}</span>
      </div>
      {item.description && <p className="lx-note">{item.description}</p>}
      {canEdit && (
        <div className="lx-row-actions">
          <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </button>
          <form action={item.active ? archiveAction : restoreAction}>
            <input type="hidden" name="id" value={item.id} />
            <button type="submit" className={`lx-btn lx-btn-sm ${item.active ? "lx-btn-danger" : "lx-btn-sec"}`} disabled={toggling}>
              {toggling ? SAVING : item.active ? "Archive" : "Restore"}
            </button>
          </form>
        </div>
      )}
      <Err state={item.active ? archiveState : restoreState} />
      {canEdit && editing && (
        <form action={updateAction} className="lx-form-grid qb-svc-edit">
          <input type="hidden" name="id" value={item.id} />
          <ItemFields item={item} disabled={updating} />
          <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
            <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={updating}>
              {updating ? SAVING : "Save"}
            </button>
            <Err state={updateState} />
          </div>
        </form>
      )}
    </li>
  );
}
