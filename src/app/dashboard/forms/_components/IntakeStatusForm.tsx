"use client";

import { useActionState } from "react";
import { SUBMISSION_STATUSES, submissionStatusLabel } from "@/lib/intake-forms/submission";
import { SavedNote } from "@/components/ui/SavedNote";
import { SAVING } from "@/lib/ui/words";
import { setIntakeStatusAction, type StatusState } from "../actions";

/** The drawer's status control. Moving a status sends nothing to the prospect. */
export function IntakeStatusForm({ id, status }: { id: string; status: string }) {
  const [state, action, pending] = useActionState<StatusState, FormData>(setIntakeStatusAction, {});
  return (
    <form action={action} className="ifm-status-form">
      <input type="hidden" name="id" value={id} />
      <label className="ifm-field ifm-grow">
        <span className="ifm-caps">Status</span>
        <select className="ifm-input" name="status" defaultValue={status} disabled={pending}>
          {SUBMISSION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {submissionStatusLabel(s)}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
        {pending ? SAVING : "Update"}
      </button>
      <SavedNote show={Boolean(state.saved) && !pending} />
      {state.error && (
        <span role="alert" className="ifm-err ifm-basis-full">
          {state.error}
        </span>
      )}
    </form>
  );
}
