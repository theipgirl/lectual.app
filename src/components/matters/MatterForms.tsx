"use client";

import { useActionState, useState } from "react";
import {
  assignMatterOwnerAction,
  closeDeadlineAction,
  completeTaskAction,
  confirmDeadlineAction,
  createDeadlineAction,
  createMatterAction,
  createTaskAction,
  extendDeadlineAction,
  updateMatterIpFieldsAction,
  updateMatterNotesAction,
  updateMatterStageAction,
  updateMatterStatusAction,
  type ActionState,
} from "@/app/dashboard/matters/[id]/actions";
// Pure leaf modules only: the @/lib/matters barrel pulls in the server client.
import { MATTER_TYPE_OPTIONS } from "@/lib/matters/matter-types";
import { matterStatusLabel, MATTER_STATUSES } from "@/lib/matters/status";
import { FILING_BASES, FILING_BASIS_LABEL, type FilingBasis } from "@/lib/matters/ip-fields";
import {
  CALCULATED_DEADLINE_NOTICE,
  DEADLINE_KINDS,
  deadlineKindLabel,
  suggestDeadline,
  type DeadlineKind,
} from "@/lib/matters/deadline-rules";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

function Err({ state }: { state: ActionState }) {
  return state.error ? (
    <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
      {state.error}
    </p>
  ) : null;
}

function Field(props: { name: string; label: string; defaultValue?: string | null; type?: string; placeholder?: string; wide?: boolean }) {
  return (
    <label className="lx-field" style={props.wide ? { gridColumn: "1 / -1" } : undefined}>
      <span className="lx-label">{props.label}</span>
      <input className="lx-input" name={props.name} type={props.type ?? "text"} defaultValue={props.defaultValue ?? ""} placeholder={props.placeholder} />
    </label>
  );
}

/** A select that saves the moment it changes. */
function AutoSelect(props: {
  action: Action;
  hidden: Record<string, string>;
  name: string;
  label: string;
  value: string;
  options: { value: string; label: string; disabled?: boolean }[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(props.action, {});
  return (
    <form action={action} className="lx-inline-form">
      {Object.entries(props.hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <select name={props.name} className="lx-input" defaultValue={props.value} aria-label={props.label} onChange={(e) => e.currentTarget.form?.requestSubmit()} disabled={pending}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <Err state={state} />
    </form>
  );
}

export function StageSelect({ matterId, stageId, stages }: { matterId: string; stageId: string | null; stages: { id: string; code: string; label: string }[] }) {
  return (
    <AutoSelect
      action={updateMatterStageAction}
      hidden={{ matterId }}
      name="stageId"
      label="Docket stage"
      value={stageId ?? ""}
      options={[{ value: "", label: "No stage yet", disabled: true }, ...stages.map((s) => ({ value: s.id, label: `${s.code}. ${s.label}` }))]}
    />
  );
}

export function StatusSelect({ matterId, status }: { matterId: string; status: string }) {
  const known = (MATTER_STATUSES as readonly string[]).includes(status);
  return (
    <AutoSelect
      action={updateMatterStatusAction}
      hidden={{ matterId }}
      name="status"
      label="Status"
      value={status}
      options={[...(known ? [] : [{ value: status, label: matterStatusLabel(status), disabled: true }]), ...MATTER_STATUSES.map((s) => ({ value: s, label: matterStatusLabel(s) }))]}
    />
  );
}

export function OwnerSelect({ matterId, assignedTo, members }: { matterId: string; assignedTo: string | null; members: { userId: string; name: string }[] }) {
  return (
    <AutoSelect
      action={assignMatterOwnerAction}
      hidden={{ matterId }}
      name="userId"
      label="Owner"
      value={assignedTo ?? ""}
      options={[{ value: "", label: "Unassigned" }, ...members.map((m) => ({ value: m.userId, label: m.name }))]}
    />
  );
}

export function NewMatterForm({ leads, canCreateLitigation }: { leads: { id: string; label: string }[]; canCreateLitigation: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createMatterAction, {});
  const [type, setType] = useState("TM");
  const types = MATTER_TYPE_OPTIONS.filter((o) => o.value !== "LIT" || canCreateLitigation);
  return (
    <form action={action} className="lx-form-grid">
      <label className="lx-field">
        <span className="lx-label">Type</span>
        <select name="type" className="lx-input" value={type} onChange={(e) => setType(e.target.value)}>
          {types.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="lx-field">
        <span className="lx-label">Client (lead)</span>
        <select name="leadId" className="lx-input" defaultValue="">
          <option value="">{leads.length ? "Not linked" : "No leads to link yet"}</option>
          {leads.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <Field name="markText" label={type === "TM" ? "Mark" : "Work or mark"} />
      <Field name="title" label="Title" placeholder="Optional" />
      <Field name="matterNumber" label={type === "LIT" ? "Court case number" : "Matter number"} placeholder={type === "LIT" ? "26-CC-011354" : "Assigned for you if blank"} />
      <Field name="packageName" label="Package" placeholder="Optional" />
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? "Opening…" : "Open matter"}
        </button>
        <Err state={state} />
      </div>
    </form>
  );
}

export type FilingValues = {
  markText: string | null;
  serialNumber: string | null;
  registrationNumber: string | null;
  filingBasis: FilingBasis | null;
  filingDate: string | null;
  registrationDate: string | null;
  internationalClasses: string;
  goodsServices: string | null;
  examiningAttorney: string | null;
  usptoStatus: string | null;
  usptoStatusAsOf: string | null;
};

export function FilingForm({ matterId, values: v }: { matterId: string; values: FilingValues }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateMatterIpFieldsAction, {});
  return (
    <form action={action} className="lx-form-grid">
      <input type="hidden" name="matterId" value={matterId} />
      <Field name="markText" label="Mark" defaultValue={v.markText} />
      <label className="lx-field">
        <span className="lx-label">Filing basis</span>
        <select name="filingBasis" className="lx-input" defaultValue={v.filingBasis ?? ""}>
          <option value="">Not set</option>
          {FILING_BASES.map((b) => (
            <option key={b} value={b}>
              {FILING_BASIS_LABEL[b]}
            </option>
          ))}
        </select>
      </label>
      <Field name="serialNumber" label="Serial no." defaultValue={v.serialNumber} />
      <Field name="filingDate" label="Filed" type="date" defaultValue={v.filingDate} />
      <Field name="registrationNumber" label="Registration no." defaultValue={v.registrationNumber} />
      <Field name="registrationDate" label="Registered" type="date" defaultValue={v.registrationDate} />
      <Field name="internationalClasses" label="Classes" defaultValue={v.internationalClasses} placeholder="9, 25, 35" />
      <Field name="examiningAttorney" label="Examining attorney" defaultValue={v.examiningAttorney} />
      <Field name="usptoStatus" label="USPTO status" defaultValue={v.usptoStatus} />
      <Field name="usptoStatusAsOf" label="Status read on" type="date" defaultValue={v.usptoStatusAsOf} />
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Goods and services</span>
        <textarea className="lx-input" name="goodsServices" rows={3} defaultValue={v.goodsServices ?? ""} />
      </label>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
          {pending ? "Saving…" : "Save filing details"}
        </button>
        {state.saved && !pending && <span className="lx-note" style={{ color: "var(--ok)" }}>Saved.</span>}
        <Err state={state} />
      </div>
    </form>
  );
}

export function NotesForm({ matterId, notes }: { matterId: string; notes: string | null }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateMatterNotesAction, {});
  return (
    <form action={action} style={{ display: "grid", gap: 8 }}>
      <input type="hidden" name="matterId" value={matterId} />
      <textarea className="lx-input" name="notes" rows={5} defaultValue={notes ?? ""} aria-label="Staff notes" placeholder="Internal. Never shown to the client." />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
          {pending ? "Saving…" : "Save notes"}
        </button>
        {state.saved && !pending && <span className="lx-note" style={{ color: "var(--ok)" }}>Saved.</span>}
        <Err state={state} />
      </div>
    </form>
  );
}

/**
 * Dockets a deadline. With an anchor date the form suggests a due date from
 * the reference interval, and says plainly that it is a reminder to confirm,
 * not a legal determination. The typed date always wins.
 */
export function DeadlineComposer({ matterId, filingBasis }: { matterId: string; filingBasis: FilingBasis | null }) {
  const [kind, setKind] = useState<DeadlineKind>("office_action_response");
  const [anchor, setAnchor] = useState("");
  const [due, setDue] = useState("");
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const res = await createDeadlineAction(prev, fd);
    if (!res.error) {
      setAnchor("");
      setDue("");
    }
    return res;
  }, {});
  const suggestion = anchor ? suggestDeadline(kind, anchor, filingBasis) : null;
  const source = suggestion && due === suggestion.dueDate ? "calculated" : "manual";

  return (
    <form action={action} className="lx-form-grid">
      <input type="hidden" name="matterId" value={matterId} />
      <input type="hidden" name="source" value={source} />
      {source === "calculated" && suggestion && <input type="hidden" name="calculationBasis" value={suggestion.basis} />}
      <label className="lx-field">
        <span className="lx-label">What&apos;s due</span>
        <select name="kind" className="lx-input" value={kind} onChange={(e) => setKind(e.target.value as DeadlineKind)}>
          {DEADLINE_KINDS.map((k) => (
            <option key={k} value={k}>
              {deadlineKindLabel(k)}
            </option>
          ))}
        </select>
      </label>
      <label className="lx-field">
        <span className="lx-label">Counted from (optional)</span>
        <input className="lx-input" type="date" name="anchorDate" value={anchor} onChange={(e) => setAnchor(e.target.value)} />
      </label>
      <label className="lx-field">
        <span className="lx-label">Due</span>
        <input className="lx-input" type="date" name="dueDate" value={due} onChange={(e) => setDue(e.target.value)} required />
      </label>
      <Field name="notes" label="Note" placeholder="Optional" />
      {suggestion && (
        <p className="lx-banner lx-banner-mute" style={{ gridColumn: "1 / -1", margin: 0 }}>
          Suggested: <b>{suggestion.dueDate}</b> ({suggestion.basis}).{" "}
          {due !== suggestion.dueDate && (
            <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setDue(suggestion.dueDate)}>
              Use it
            </button>
          )}
          <span className="lx-note" style={{ display: "block", marginTop: 4 }}>
            {CALCULATED_DEADLINE_NOTICE}
          </span>
        </p>
      )}
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
          {pending ? "Docketing…" : "Docket deadline"}
        </button>
        <span className="lx-note">Saved unconfirmed until an attorney confirms it.</span>
        <Err state={state} />
      </div>
    </form>
  );
}

/** One button in its own form, so each gets its own pending and error state. */
function RowButton({ action, hidden, label, tone = "ghost" }: { action: Action; hidden: Record<string, string>; label: string; tone?: "ghost" | "sec" }) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form action={formAction} className="lx-inline-form">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <button type="submit" className={`lx-btn lx-btn-${tone} lx-btn-sm`} disabled={pending} title={state.error}>
        {pending ? "…" : label}
      </button>
      <Err state={state} />
    </form>
  );
}

export function DeadlineActions(props: { matterId: string; deadlineId: string; confirmed: boolean; canConfirm: boolean; extendable: boolean }) {
  const [extending, setExtending] = useState(false);
  const [state, extend, pending] = useActionState<ActionState, FormData>(extendDeadlineAction, {});
  const ids = { matterId: props.matterId, deadlineId: props.deadlineId };
  return (
    <div className="lx-row-actions">
      {!props.confirmed && props.canConfirm && <RowButton action={confirmDeadlineAction} hidden={ids} label="Confirm date" tone="sec" />}
      <RowButton action={closeDeadlineAction} hidden={{ ...ids, status: "satisfied" }} label="Done" />
      <RowButton action={closeDeadlineAction} hidden={{ ...ids, status: "waived" }} label="Waived" />
      {props.extendable &&
        (extending ? (
          <form action={extend} className="lx-inline-form">
            <input type="hidden" name="matterId" value={props.matterId} />
            <input type="hidden" name="deadlineId" value={props.deadlineId} />
            <input className="lx-input" type="date" name="dueDate" required aria-label="New due date" />
            <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
              {pending ? "…" : "Extend"}
            </button>
            <Err state={state} />
          </form>
        ) : (
          <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setExtending(true)}>
            Extend…
          </button>
        ))}
    </div>
  );
}

export function TaskComposer({ matterId }: { matterId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const res = await createTaskAction(prev, fd);
    if (!res.error) (document.getElementById("lx-task-title") as HTMLInputElement | null)?.form?.reset();
    return res;
  }, {});
  return (
    <form action={action} style={{ display: "grid", gap: 8 }}>
      <input type="hidden" name="matterId" value={matterId} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input id="lx-task-title" className="lx-input" name="title" placeholder="Add a task" aria-label="Task" style={{ flex: 1, minWidth: 160 }} />
        <input className="lx-input" type="date" name="dueAt" aria-label="Due" style={{ width: "auto" }} />
        <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
          {pending ? "…" : "Add"}
        </button>
      </div>
      <Err state={state} />
    </form>
  );
}

export function TaskDone({ matterId, taskId }: { matterId: string; taskId: string }) {
  return <RowButton action={completeTaskAction} hidden={{ matterId, taskId }} label="Done" />;
}
