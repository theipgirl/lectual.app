"use client";

import { useActionState } from "react";
import {
  addStepAction,
  advanceEnrollmentAction,
  cancelEnrollmentAction,
  deleteStepAction,
  enrollLeadAction,
  pauseEnrollmentAction,
  resumeEnrollmentAction,
  toggleSequenceAction,
  updateSequenceDetailsAction,
} from "@/app/dashboard/campaigns/[id]/actions";
import type { ActionState } from "@/app/dashboard/campaigns/errors";
import { DRIP_STEP_TYPES, stepTypeLabel } from "@/lib/campaigns/steps";

/**
 * The campaign builder's client forms. Every one posts to a server action
 * that re-checks the automation admin/staff gate itself — nothing here is
 * the boundary, it only renders the controls (same split as
 * components/quotes/QuoteForms.tsx).
 */

function Err({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p role="status" className="lx-note" style={{ color: "var(--ok)", margin: 0 }}>
        {state.message}
      </p>
    );
  }
  return null;
}

function Hidden({ values }: { values: Record<string, string> }) {
  return (
    <>
      {Object.entries(values).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </>
  );
}

/* ── sequence details + pause/start ────────────────────────────────────── */

export function EditSequenceForm({ sequenceId, name, description }: { sequenceId: string; name: string; description: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateSequenceDetailsAction, {});
  return (
    <form action={action} className="lx-form-grid">
      <Hidden values={{ sequenceId }} />
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Name</span>
        <input className="lx-input" name="name" required maxLength={200} defaultValue={name} />
      </label>
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Description</span>
        <input className="lx-input" name="description" maxLength={500} defaultValue={description} />
      </label>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <Err state={state} />
      </div>
    </form>
  );
}

export function ToggleSequenceButton({ sequenceId, active }: { sequenceId: string; active: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(toggleSequenceAction, {});
  return (
    <form action={action} style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      <Hidden values={{ sequenceId, nextActive: String(!active) }} />
      <button type="submit" className={active ? "lx-btn lx-btn-sec" : "lx-btn lx-btn-pri"} disabled={pending}>
        {pending ? "Working…" : active ? "Pause campaign" : "Start campaign"}
      </button>
      {state.error && <Err state={state} />}
    </form>
  );
}

/* ── steps ──────────────────────────────────────────────────────────────── */

export type TemplateOption = { id: string; name: string; subject: string };

export function AddStepForm({ sequenceId, templates }: { sequenceId: string; templates: TemplateOption[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addStepAction, {});
  return (
    <form action={action} className="lx-form-grid lx-campaigns-stepform">
      <Hidden values={{ sequenceId }} />
      <label className="lx-field">
        <span className="lx-label">Step type</span>
        <select className="lx-input" name="type" defaultValue="email">
          {DRIP_STEP_TYPES.map((t) => (
            <option key={t} value={t}>
              {stepTypeLabel(t)}
            </option>
          ))}
        </select>
      </label>
      <label className="lx-field">
        <span className="lx-label">Delay before this step</span>
        <input className="lx-input" name="delayHours" type="number" min={0} step={1} defaultValue={0} />
        <span className="lx-note">Hours after the previous step (or after enrolling, for the first step)</span>
      </label>
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Email template (for an Email step)</span>
        <select className="lx-input" name="templateId" defaultValue="">
          <option value="">{templates.length === 0 ? "No templates yet — add one in Email templates" : "Choose a template"}</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} — {t.subject}
            </option>
          ))}
        </select>
      </label>
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Task title (for an Internal task step)</span>
        <input className="lx-input" name="taskTitle" maxLength={200} placeholder="Optional — defaults to a generic follow-up" />
      </label>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
          {pending ? "Adding…" : "Add step"}
        </button>
        <Err state={state} />
      </div>
    </form>
  );
}

export function DeleteStepButton({ sequenceId, stepId }: { sequenceId: string; stepId: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(deleteStepAction, {});
  return (
    <form action={action}>
      <Hidden values={{ sequenceId, stepId }} />
      <button type="submit" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={pending} title="Remove this step">
        {pending ? "Removing…" : "Remove"}
      </button>
      {state.error && <Err state={state} />}
    </form>
  );
}

/* ── enrollment ─────────────────────────────────────────────────────────── */

export type LeadOption = { id: string; label: string; hasEmail: boolean };

export function EnrollLeadForm({ sequenceId, leads }: { sequenceId: string; leads: LeadOption[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(enrollLeadAction, {});
  return (
    <form action={action} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
      <Hidden values={{ sequenceId }} />
      <label className="lx-field" style={{ minWidth: 260, flex: 1 }}>
        <span className="lx-label">Enroll a lead from Intake</span>
        <select className="lx-input" name="leadId" defaultValue="" required>
          <option value="" disabled>
            {leads.length === 0 ? "No leads to enroll" : "Choose a lead"}
          </option>
          {leads.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
              {l.hasEmail ? "" : " (no email on file)"}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending || leads.length === 0}>
        {pending ? "Enrolling…" : "Enroll"}
      </button>
      <Err state={state} />
    </form>
  );
}

export function EnrollmentActions({
  sequenceId,
  enrollmentId,
  status,
  hasMoreSteps,
  canRun,
}: {
  sequenceId: string;
  enrollmentId: string;
  status: "active" | "paused" | "completed" | "cancelled";
  hasMoreSteps: boolean;
  /** False while the campaign is paused (the action refuses too) or its steps couldn't be read. */
  canRun: boolean;
}) {
  const [advanceState, advanceAction, advancing] = useActionState<ActionState, FormData>(advanceEnrollmentAction, {});
  const [pauseState, pauseFormAction, pausing] = useActionState<ActionState, FormData>(pauseEnrollmentAction, {});
  const [resumeState, resumeFormAction, resuming] = useActionState<ActionState, FormData>(resumeEnrollmentAction, {});
  const [cancelState, cancelFormAction, cancelling] = useActionState<ActionState, FormData>(cancelEnrollmentAction, {});

  const hidden = { sequenceId, enrollmentId };
  return (
    <div style={{ display: "grid", gap: 6, justifyItems: "flex-end" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
        {status === "active" && canRun && (
          // With no steps left (the sequence was emptied or shortened under
          // it) running closes the enrollment out instead of leaving it
          // "active" forever with nothing to run.
          <form action={advanceAction}>
            <Hidden values={hidden} />
            <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={advancing}>
              {advancing ? "Running…" : hasMoreSteps ? "Run next step" : "Close out"}
            </button>
          </form>
        )}
        {status === "active" && (
          <form action={pauseFormAction}>
            <Hidden values={hidden} />
            <button type="submit" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={pausing}>
              {pausing ? "…" : "Pause"}
            </button>
          </form>
        )}
        {status === "paused" && (
          <form action={resumeFormAction}>
            <Hidden values={hidden} />
            <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={resuming}>
              {resuming ? "…" : "Resume"}
            </button>
          </form>
        )}
        {(status === "active" || status === "paused") && (
          <form action={cancelFormAction}>
            <Hidden values={hidden} />
            <button type="submit" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={cancelling}>
              {cancelling ? "…" : "Cancel"}
            </button>
          </form>
        )}
      </div>
      <Err state={advanceState} />
      <Err state={pauseState} />
      <Err state={resumeState} />
      <Err state={cancelState} />
    </div>
  );
}
