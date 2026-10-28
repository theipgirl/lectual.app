"use client";

import { useActionState, useState } from "react";
import {
  addStarterStepsAction,
  addStepAction,
  advanceEnrollmentAction,
  deleteStepAction,
  enrollLeadAction,
  pauseEnrollmentAction,
  resumeEnrollmentAction,
  stopEnrollmentAction,
  toggleSequenceAction,
  updateSequenceDetailsAction,
} from "@/app/dashboard/campaigns/[id]/actions";
import type { ActionState } from "@/app/dashboard/campaigns/errors";
import { STARTER_STEPS } from "@/lib/campaigns/steps";
import { ADDABLE_STEP_TYPES, START_NEEDS_STEP, START_UNREADABLE, stepTypeLabel } from "@/lib/campaigns/steps";

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

export function ToggleSequenceButton({
  sequenceId,
  active,
  stepCount,
}: {
  sequenceId: string;
  active: boolean;
  /** Null when the steps could not be read. */
  stepCount: number | null;
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(toggleSequenceAction, {});
  const blockedReason = !active && (stepCount === null ? START_UNREADABLE : stepCount === 0 ? START_NEEDS_STEP : null);
  const reasonId = `start-reason-${sequenceId}`;
  return (
    <form action={action} style={{ display: "inline-flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
      <Hidden values={{ sequenceId, nextActive: String(!active) }} />
      <button type="submit" className={active ? "lx-btn lx-btn-sec" : "lx-btn lx-btn-pri"} disabled={pending || !!blockedReason} aria-describedby={blockedReason ? reasonId : undefined}>
        {pending ? "Working…" : active ? "Pause campaign" : "Start campaign"}
      </button>
      {blockedReason && (
        <p id={reasonId} className="lx-note" style={{ margin: 0 }}>
          {blockedReason}
        </p>
      )}
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
          {ADDABLE_STEP_TYPES.map((t) => (
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
        <span className="lx-label">Enroll a lead</span>
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
  status: "active" | "paused" | "completed" | "cancelled" | "stopped";
  hasMoreSteps: boolean;
  /** False while the campaign is paused (the action refuses too) or its steps couldn't be read. */
  canRun: boolean;
}) {
  const [advanceState, advanceAction, advancing] = useActionState<ActionState, FormData>(advanceEnrollmentAction, {});
  const [pauseState, pauseFormAction, pausing] = useActionState<ActionState, FormData>(pauseEnrollmentAction, {});
  const [resumeState, resumeFormAction, resuming] = useActionState<ActionState, FormData>(resumeEnrollmentAction, {});
  const [stopState, stopFormAction, stopping] = useActionState<ActionState, FormData>(stopEnrollmentAction, {});

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
          <form action={stopFormAction}>
            <Hidden values={hidden} />
            <button
              type="submit"
              className="lx-btn lx-btn-ghost lx-btn-sm"
              disabled={stopping}
              title="Stop this campaign for this lead. It's recorded with your name, and can't be restarted."
            >
              {stopping ? "…" : "Stop"}
            </button>
          </form>
        )}
      </div>
      <Err state={advanceState} />
      <Err state={pauseState} />
      <Err state={resumeState} />
      <Err state={stopState} />
    </div>
  );
}

/* ── starter suggestion for an empty campaign ───────────────────────────── */

export function StarterSteps({ sequenceId, templates }: { sequenceId: string; templates: TemplateOption[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addStarterStepsAction, {});
  const [thankYou, setThankYou] = useState("");
  const [followUp, setFollowUp] = useState("");
  const reason =
    templates.length === 0
      ? "Add an email template first, then these steps can use it."
      : !thankYou || !followUp
        ? "Choose a template for each email step."
        : null;
  const options = (
    <>
      <option value="">Choose a template</option>
      {templates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name} — {t.subject}
        </option>
      ))}
    </>
  );
  return (
    <form action={action} className="lx-campaigns-starter">
      <Hidden values={{ sequenceId }} />
      <h3 className="lx-h3">A good way to start</h3>
      <p className="lx-note" style={{ margin: 0 }}>
        Three steps, added as drafts. Nothing is sent or enrolled, and the campaign stays paused until you start it.
      </p>
      <ol className="lx-campaigns-starter-list">
        {STARTER_STEPS.map((step) => (
          <li key={step.key}>
            {step.label}
            {step.key === "thank-you" && (
              <select className="lx-input" name="templateThankYou" value={thankYou} onChange={(e) => setThankYou(e.target.value)} aria-label="Template for the thank-you email">
                {options}
              </select>
            )}
            {step.key === "follow-up" && (
              <select className="lx-input" name="templateFollowUp" value={followUp} onChange={(e) => setFollowUp(e.target.value)} aria-label="Template for the follow-up email">
                {options}
              </select>
            )}
          </li>
        ))}
      </ol>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending || !!reason} aria-describedby={reason ? "starter-reason" : undefined}>
          {pending ? "Adding…" : "Add these steps"}
        </button>
        {reason && (
          <span id="starter-reason" className="lx-note">
            {reason}
          </span>
        )}
        <Err state={state} />
      </div>
    </form>
  );
}
