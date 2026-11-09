"use client";

import { useActionState } from "react";
import { completeNextStepAction, type ReviewActionState } from "@/app/dashboard/review/actions";
import "./review.css";

/** Marks a next step done. Lives outside every card link. */
export function DoneButton({ taskId, className = "lx-btn lx-btn-ghost lx-btn-sm" }: { taskId: string; className?: string }) {
  const [state, action, pending] = useActionState<ReviewActionState, FormData>(completeNextStepAction, {});
  return (
    <form action={action} className="rv-inline">
      <input type="hidden" name="taskId" value={taskId} />
      <button type="submit" className={className} disabled={pending}>
        {pending ? "…" : "Done"}
      </button>
      {state.error && (
        <span role="alert" className="rv-err">
          {state.error}
        </span>
      )}
    </form>
  );
}
