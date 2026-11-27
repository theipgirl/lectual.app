"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
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
import { stepAssigneeOptions, stepEditFields } from "@/lib/record-card/rules";
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
    {stepAssigneeOptions(members, null).map((o) => (
      <option key={o.value || "none"} value={o.value}>
        {o.label}
      </option>
    ))}
  </>
);

/**
 * The fields of "Change", posted as hidden inputs built by `stepEditFields` (the record card's own rule): the visible inputs
 * carry no `name`. The assignee is posted only after the person picked one, so an untouched picker never unassigns or undoes a
 * reassignment saved meanwhile. `members` null = the team list couldn't be read: no picker, and no assignee is ever posted.
 */
function ChangeStepFields({ taskId, title: startTitle, dueDate, assigneeId, members }: { taskId: string; title: string; dueDate: string | null; assigneeId: string | null; members: StepMember[] | null }) {
  const [title, setTitle] = useState(startTitle);
  const [due, setDue] = useState(dueDate ?? "");
  const options = members ? stepAssigneeOptions(members, assigneeId) : [];
  const [who, setWho] = useState(assigneeId ?? "");
  const [picked, setPicked] = useState(false);
  const fields = stepEditFields({ taskId, title, dueAt: due, assignees: members ? { current: assigneeId } : null, chosen: who, picked });
  return (
    <>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input className="lx-input" maxLength={TASK_TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={LEAD_PAGE_STEP_LABEL} required />
      <input className="lx-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label={LEAD_PAGE_STEP_DUE} />
      {members && (
        <select
          className="lx-input"
          value={who}
          onChange={(e) => {
            setWho(e.target.value);
            setPicked(true);
          }}
          aria-label={LEAD_PAGE_STEP_OWNER}
        >
          {options.map((o) => (
            <option key={o.value || "none"} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </>
  );
}

/** "Yours to do": Mark done, Snooze and Change, through the existing next-step actions (the review panel's). */
/** `members` null = the team list couldn't be read: the forms draw no picker and post no assignee. */
export function YoursActions({ taskId, title, dueDate, assigneeId, members }: { taskId: string; title: string; dueDate: string | null; assigneeId: string | null; members: StepMember[] | null }) {
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
          <ChangeStepFields taskId={taskId} title={title} dueDate={dueDate} assigneeId={assigneeId} members={members} />
        </StepForm>
      </details>
    </div>
  );
}

/** "Set a next step" for the cards that have nothing lined up: the existing `setNextStepAction` on this lead. */
export function SetNextStep({ leadId, members }: { leadId: string; members: StepMember[] | null }) {
  return (
    <details className="ls-change">
      <summary className="lx-btn lx-btn-sec">{LEAD_STEP_SET_NEXT_STEP}</summary>
      <StepForm action={setNextStepAction} submit={LEAD_PAGE_SAVE_STEP}>
        <input type="hidden" name="kind" value="lead" />
        <input type="hidden" name="id" value={leadId} />
        <input className="lx-input" name="title" maxLength={TASK_TITLE_MAX} placeholder={LEAD_PAGE_STEP_WHAT} aria-label={LEAD_PAGE_STEP_WHAT} required />
        <input className="lx-input" type="date" name="dueAt" aria-label={LEAD_PAGE_STEP_DUE} />
        {members && (
          <select className="lx-input" name="assigneeId" defaultValue="" aria-label={LEAD_PAGE_STEP_OWNER}>
            <MemberOptions members={members} />
          </select>
        )}
      </StepForm>
    </details>
  );
}
