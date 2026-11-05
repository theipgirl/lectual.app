"use client";

import { useActionState, useRef } from "react";
import {
  completeNextStepAction,
  logWhatHappenedAction,
  setNextStepAction,
  type ReviewActionState,
} from "@/app/dashboard/review/actions";
import { TASK_TITLE_MAX } from "@/lib/matters/task-edit";
import { LostNurture } from "./LostNurture";
import type { CloseStage } from "@/lib/review/close-stage";
import "./review.css";

type Member = { userId: string; name: string };

function Msg({ state }: { state: ReviewActionState }) {
  if (state.error)
    return (
      <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
        {state.error}
      </p>
    );
  return state.saved ? (
    <p role="status" className="rv-saved">
      Saved
    </p>
  ) : null;
}

/** The three inline actions on a review row. Rendered only for a role that can write. */
export function ReviewRowActions({
  kind,
  id,
  nextStepId,
  members,
  defaultAssignee,
  closeStages = [],
}: {
  kind: "matter" | "lead";
  id: string;
  nextStepId: string | null;
  members: Member[];
  defaultAssignee: string | null;
  /** Lost / nurture stages the caller may move a lead to; empty hides the button. Leads only. */
  closeStages?: CloseStage[];
}) {
  const stepForm = useRef<HTMLFormElement>(null);
  const noteForm = useRef<HTMLFormElement>(null);
  const [stepState, stepAction, stepPending] = useActionState<ReviewActionState, FormData>(async (prev, fd) => {
    const res = await setNextStepAction(prev, fd);
    if (res.saved) stepForm.current?.reset();
    return res;
  }, {});
  const [noteState, noteAction, notePending] = useActionState<ReviewActionState, FormData>(async (prev, fd) => {
    const res = await logWhatHappenedAction(prev, fd);
    if (res.saved) noteForm.current?.reset();
    return res;
  }, {});
  const [doneState, doneAction, donePending] = useActionState<ReviewActionState, FormData>(completeNextStepAction, {});

  return (
    <div className="rv-actions">
      <details className="rv-act">
        <summary>Set next step</summary>
        <form ref={stepForm} action={stepAction} className="rv-form">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <input className="lx-input" name="title" maxLength={TASK_TITLE_MAX} placeholder="What happens next" aria-label="Next step" required />
          <input className="lx-input" type="date" name="dueAt" aria-label="Due date" />
          <select className="lx-input" name="assigneeId" aria-label="Assigned to" defaultValue={defaultAssignee ?? ""}>
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
          <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={stepPending}>
            {stepPending ? "…" : "Save next step"}
          </button>
          <Msg state={stepState} />
        </form>
      </details>
      <details className="rv-act">
        <summary>Log what happened</summary>
        <form ref={noteForm} action={noteAction} className="rv-form">
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <textarea className="lx-input" name="body" rows={3} placeholder="A short note for the timeline" aria-label="What happened" required />
          <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={notePending}>
            {notePending ? "…" : "Add to timeline"}
          </button>
          <Msg state={noteState} />
        </form>
      </details>
      {kind === "lead" && closeStages.length > 0 && <LostNurture id={id} stages={closeStages} />}
      {nextStepId && (
        <form action={doneAction}>
          <input type="hidden" name="taskId" value={nextStepId} />
          <button type="submit" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={donePending}>
            {donePending ? "…" : "Done"}
          </button>
          <Msg state={doneState} />
        </form>
      )}
    </div>
  );
}
