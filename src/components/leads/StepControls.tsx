"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  completeNextStepAction,
  setNextStepAction,
  snoozeNextStepAction,
  updateNextStepAction,
  type ReviewActionState,
} from "@/app/dashboard/review/actions";
import { SavedNote } from "@/components/ui/SavedNote";
import { SNOOZE_CHOICES, SNOOZE_LABEL } from "@/lib/review/snooze";
import { TASK_TITLE_MAX } from "@/lib/matters/task-edit";
import {
  LEAD_PAGE_CHANGE,
  LEAD_PAGE_MARK_DONE,
  LEAD_PAGE_SAVE_STEP,
  LEAD_PAGE_SNOOZE,
  LEAD_PAGE_STEP_DUE,
  LEAD_PAGE_STEP_LABEL,
  LEAD_PAGE_STEP_OWNER,
  LEAD_PAGE_STEP_WHAT,
  LEAD_STEP_SET_NEXT_STEP,
  SAVING,
  UNASSIGNED,
} from "@/lib/ui/words";
import "./lead-step.css";

export type StepMember = { userId: string; name: string };

type Act = (prev: ReviewActionState, formData: FormData) => Promise<ReviewActionState>;

/**
 * One small form for one of the existing next-step actions. Those actions revalidate the review pages, not this one, so a
 * saved result refreshes the page here. The sentence on a refusal is the action's own fixed one.
 */
function StepForm({ action, submit, className = "ls-form", buttonClass = "lx-btn lx-btn-sec lx-btn-sm", children }: { action: Act; submit: string; className?: string; buttonClass?: string; children?: ReactNode }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ReviewActionState, FormData>(action, {});
  useEffect(() => {
    if (state.saved) router.refresh();
  }, [state.saved, router]);
  return (
    <form action={formAction} className={className}>
      {children}
      <button type="submit" className={buttonClass} disabled={pending}>
        {pending ? SAVING : submit}
      </button>
      {state.error && (
        <p role="alert" className="ls-err">
          {state.error}
        </p>
      )}
      <SavedNote show={!state.error && !!state.saved} />
    </form>
  );
}

const MemberOptions = ({ members }: { members: StepMember[] }) => (
  <>
    <option value="">{UNASSIGNED}</option>
    {members.map((m) => (
      <option key={m.userId} value={m.userId}>
        {m.name}
      </option>
    ))}
  </>
);

/** "Yours to do": Mark done, Snooze and Change, through the existing next-step actions (the review panel's). */
export function YoursActions({ taskId, title, dueDate, assigneeId, members }: { taskId: string; title: string; dueDate: string | null; assigneeId: string | null; members: StepMember[] }) {
  return (
    <div className="ls-act ls-act--steps">
      <StepForm action={completeNextStepAction} submit={LEAD_PAGE_MARK_DONE} className="ls-inline" buttonClass="lx-btn lx-btn-pri ls-yes">
        <input type="hidden" name="taskId" value={taskId} />
      </StepForm>
      <details className="ls-snooze">
        <summary className="lx-btn lx-btn-sec">{LEAD_PAGE_SNOOZE}</summary>
        <div className="ls-menu" role="group" aria-label={LEAD_PAGE_SNOOZE}>
          {SNOOZE_CHOICES.map((c) => (
            <StepForm key={c} action={snoozeNextStepAction} submit={SNOOZE_LABEL[c]} className="ls-inline" buttonClass="lx-btn lx-btn-ghost lx-btn-sm">
              <input type="hidden" name="taskId" value={taskId} />
              <input type="hidden" name="when" value={c} />
            </StepForm>
          ))}
        </div>
      </details>
      <details className="ls-change">
        <summary className="lx-btn lx-btn-ghost">{LEAD_PAGE_CHANGE}</summary>
        <StepForm action={updateNextStepAction} submit={LEAD_PAGE_SAVE_STEP}>
          <input type="hidden" name="taskId" value={taskId} />
          <input className="lx-input" name="title" maxLength={TASK_TITLE_MAX} defaultValue={title} aria-label={LEAD_PAGE_STEP_LABEL} required />
          <input className="lx-input" type="date" name="dueAt" defaultValue={dueDate ?? ""} aria-label={LEAD_PAGE_STEP_DUE} />
          <select className="lx-input" name="assigneeId" defaultValue={assigneeId ?? ""} aria-label={LEAD_PAGE_STEP_OWNER}>
            <MemberOptions members={members} />
          </select>
        </StepForm>
      </details>
    </div>
  );
}

/** "Set a next step" for the cards that have nothing lined up: the existing `setNextStepAction` on this lead. */
export function SetNextStep({ leadId, members }: { leadId: string; members: StepMember[] }) {
  return (
    <details className="ls-change">
      <summary className="lx-btn lx-btn-sec">{LEAD_STEP_SET_NEXT_STEP}</summary>
      <StepForm action={setNextStepAction} submit={LEAD_PAGE_SAVE_STEP}>
        <input type="hidden" name="kind" value="lead" />
        <input type="hidden" name="id" value={leadId} />
        <input className="lx-input" name="title" maxLength={TASK_TITLE_MAX} placeholder={LEAD_PAGE_STEP_WHAT} aria-label={LEAD_PAGE_STEP_WHAT} required />
        <input className="lx-input" type="date" name="dueAt" aria-label={LEAD_PAGE_STEP_DUE} />
        <select className="lx-input" name="assigneeId" defaultValue="" aria-label={LEAD_PAGE_STEP_OWNER}>
          <MemberOptions members={members} />
        </select>
      </StepForm>
    </details>
  );
}
