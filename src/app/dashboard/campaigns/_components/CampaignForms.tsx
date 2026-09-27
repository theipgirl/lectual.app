"use client";

import { useActionState } from "react";
import { createSequenceAction } from "@/app/dashboard/campaigns/actions";
import type { ActionState } from "@/app/dashboard/campaigns/errors";

function Err({ state }: { state: ActionState }) {
  return state.error ? (
    <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>
      {state.error}
    </p>
  ) : null;
}

/** "New campaign". On success the action redirects to the sequence's own page, so there is no success state here. */
export function NewSequenceForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createSequenceAction, {});
  return (
    <form action={action} className="lx-form-grid">
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Name</span>
        <input className="lx-input" name="name" required maxLength={200} placeholder="e.g. PNC nurture — didn't book a strategy session" />
      </label>
      <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
        <span className="lx-label">Description</span>
        <input className="lx-input" name="description" maxLength={500} placeholder="Optional — who this is for and why" />
      </label>
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? "Creating…" : "Create campaign"}
        </button>
        <Err state={state} />
      </div>
    </form>
  );
}
