"use client";

import { useActionState } from "react";
import { completeNextStepAction, type ReviewActionState } from "@/app/dashboard/review/actions";
import { SAVING } from "@/lib/ui/words";
import "./review.css";

/** Marks a next step done. Lives outside every card link. */
export function DoneButton({ taskId, className = "lx-link" }: { taskId: string; className?: string }) {
  const [state, action, pending] = useActionState<ReviewActionState, FormData>(completeNextStepAction, {});
  return (
    <form action={action} className="rv-inline">
      <input type="hidden" name="taskId" value={taskId} />
      <button type="submit" className={className} disabled={pending}>
        {pending ? SAVING : "Done"}
      </button>
      {state.error && (
        <span role="alert" className="rv-err">
          {state.error}
        </span>
      )}
    </form>
  );
}
