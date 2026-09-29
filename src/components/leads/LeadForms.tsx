"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { createLeadAction, type CreateLeadState } from "@/app/dashboard/leads/actions";
import {
  addNoteAction,
  assignLeadAction,
  editLeadAction,
  moveStageAction,
  reviewProposalAction,
  type ActionState,
  type EditLeadState,
} from "@/app/dashboard/leads/[id]/actions";
import type { Proposal } from "@/lib/agents/proposals";
import { FIELD_LABEL } from "@/lib/agents/proposals";

function Err({ state }: { state: ActionState }) {
  return state.error ? (
    <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
      {state.error}
    </p>
  ) : null;
}

function Field(props: { name: string; label: string; defaultValue?: string | null; error?: string; type?: string; required?: boolean }) {
  return (
    <label className="lx-field">
      <span className="lx-label">{props.label}</span>
      <input
        className="lx-input"
        name={props.name}
        type={props.type ?? "text"}
        defaultValue={props.defaultValue ?? ""}
        required={props.required}
        aria-invalid={props.error ? true : undefined}
      />
      {props.error && <span className="lx-note" style={{ color: "var(--wine)" }}>{props.error}</span>}
    </label>
  );
}

export function NewLeadForm({ stages }: { stages: { id: string; name: string }[] }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<CreateLeadState, FormData>(async (prev, fd) => {
    const res = await createLeadAction(prev, fd);
    if (res.ok && res.leadId) router.push(`/dashboard/leads/${res.leadId}/`);
    return res;
  }, {});
  const v = state.values ?? {};
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="lx-form-grid">
      <Field name="firstName" label="First name" defaultValue={v.firstName} error={fe.firstName} required />
      <Field name="lastName" label="Last name" defaultValue={v.lastName} error={fe.lastName} />
      <Field name="email" label="Email" type="email" defaultValue={v.email} error={fe.email} required />
      <Field name="phone" label="Phone" defaultValue={v.phone} error={fe.phone} />
      <Field name="businessName" label="Business" defaultValue={v.businessName} error={fe.businessName} />
      <Field name="website" label="Website" defaultValue={v.website} error={fe.website} />
      <label className="lx-field">
        <span className="lx-label">Stage</span>
        <select name="currentStageId" className="lx-input" defaultValue={v.currentStageId ?? ""}>
          <option value="">First stage</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? "Adding…" : "Add lead"}
        </button>
        <Err state={state} />
      </div>
    </form>
  );
}

export function StageSelect({ leadId, stageId, stages }: { leadId: string; stageId: string; stages: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(moveStageAction, {});
  return (
    <form action={action} className="lx-inline-form">
      <input type="hidden" name="leadId" value={leadId} />
      <select name="stageId" className="lx-input" defaultValue={stageId} aria-label="Stage" onChange={(e) => e.currentTarget.form?.requestSubmit()} disabled={pending}>
        {stages.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <Err state={state} />
    </form>
  );
}

export function AssignSelect({ leadId, assignedTo, members }: { leadId: string; assignedTo: string | null; members: { userId: string; name: string }[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(assignLeadAction, {});
  return (
    <form action={action} className="lx-inline-form">
      <input type="hidden" name="leadId" value={leadId} />
      <select name="userId" className="lx-input" defaultValue={assignedTo ?? ""} aria-label="Owner" onChange={(e) => e.currentTarget.form?.requestSubmit()} disabled={pending}>
        <option value="" disabled>
          Unassigned
        </option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>
            {m.name}
          </option>
        ))}
      </select>
      <Err state={state} />
    </form>
  );
}

export function EditLeadForm(props: {
  leadId: string;
  values: { firstName: string; lastName: string; email: string; phone: string | null; businessName: string | null; website: string | null };
}) {
  const [state, action, pending] = useActionState<EditLeadState, FormData>(editLeadAction, {});
  const fe = state.fieldErrors ?? {};
  const v = props.values;
  return (
    <form action={action} className="lx-form-grid">
      <input type="hidden" name="leadId" value={props.leadId} />
      <Field name="firstName" label="First name" defaultValue={v.firstName} error={fe.firstName} />
      <Field name="lastName" label="Last name" defaultValue={v.lastName} error={fe.lastName} />
      <Field name="email" label="Email" type="email" defaultValue={v.email} error={fe.email} />
      <Field name="phone" label="Phone" defaultValue={v.phone} error={fe.phone} />
      <Field name="businessName" label="Business" defaultValue={v.businessName} error={fe.businessName} />
      <Field name="website" label="Website" defaultValue={v.website} error={fe.website} />
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
          {pending ? "Saving…" : "Save details"}
        </button>
        {state.saved && <span className="lx-note" style={{ color: "var(--ok)" }}>Saved.</span>}
        <Err state={state} />
      </div>
    </form>
  );
}

export function NoteComposer({ leadId }: { leadId: string }) {
  const [kind, setKind] = useState("note");
  const [state, action, pending] = useActionState<ActionState, FormData>(async (prev, fd) => {
    const res = await addNoteAction(prev, fd);
    if (!res.error) (document.getElementById("lx-note-body") as HTMLTextAreaElement | null)?.form?.reset();
    return res;
  }, {});
  return (
    <form action={action} style={{ display: "grid", gap: 8 }}>
      <input type="hidden" name="leadId" value={leadId} />
      <div className="lx-segs" role="radiogroup" aria-label="Entry type">
        {[
          ["note", "Note"],
          ["call_logged", "Call"],
          ["email_sent", "Email sent"],
        ].map(([k, label]) => (
          <label key={k} className={kind === k ? "on" : undefined}>
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="lx-sr" />
            {label}
          </label>
        ))}
      </div>
      {kind === "email_sent" && <input className="lx-input" name="subject" placeholder="Subject" />}
      <textarea id="lx-note-body" className="lx-input" name="body" rows={3} placeholder="What happened? Use @name to tag a teammate." />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
          {pending ? "Saving…" : "Add to timeline"}
        </button>
        <span className="lx-note">Records something that happened. Nothing is sent.</span>
      </div>
      <Err state={state} />
    </form>
  );
}

export function ProposalCard({ leadId, proposal, current, canWrite }: { leadId: string; proposal: Proposal; current: Record<string, string | null>; canWrite: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(reviewProposalAction, {});
  return (
    <form action={action} className="lx-proposal">
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="activityId" value={proposal.activityId} />
      {proposal.summary && <p style={{ margin: 0, color: "var(--body)" }}>{proposal.summary}</p>}
      {proposal.proposed.map((c) => (
        <label key={c.field} className="lx-proposal-row">
          <input type="checkbox" name="field" value={c.field} defaultChecked={!current[c.field]} disabled={!canWrite} />
          <span>
            <b>{FIELD_LABEL[c.field]}</b>: {c.value}
            {current[c.field] && <span className="lx-note"> (currently “{current[c.field]}”)</span>}
            <span className="lx-note" style={{ display: "block" }}>
              “{c.evidence}”
            </span>
          </span>
        </label>
      ))}
      {proposal.legalQuestion && (
        <p className="lx-banner lx-banner-mute" style={{ margin: 0 }}>
          <b>Legal question for the attorney:</b> {proposal.legalQuestion}
        </p>
      )}
      {canWrite && (
        <div style={{ display: "flex", gap: 8 }}>
          {proposal.proposed.length > 0 && (
            <button type="submit" name="decision" value="apply" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
              Apply ticked
            </button>
          )}
          <button type="submit" name="decision" value="dismiss" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={pending}>
            Dismiss
          </button>
        </div>
      )}
      <Err state={state} />
    </form>
  );
}
