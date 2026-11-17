"use client";

import { Notice } from "@/components/ui/Notice";
import { useActionState, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { SAVING } from "@/lib/ui/words";
import { createSequenceAction } from "@/app/dashboard/campaigns/actions";
import type { ActionState } from "@/app/dashboard/campaigns/errors";

function Err({ state }: { state: ActionState }) {
  return state.error ? (
    <Notice tone="risk" role="alert">
      {state.error}
    </Notice>
  ) : null;
}

/** "New campaign". On success the action redirects to the sequence's own page, so there is no success state here. */
export function NewSequenceForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createSequenceAction, {});
  return (
    <form action={action} className="lx-form-grid">
      <label className="lx-field lx-campaigns-wide">
        <span className="lx-label">Name</span>
        <input className="lx-input" name="name" required maxLength={200} placeholder="e.g. New lead nurture — didn't book a strategy session" />
      </label>
      <label className="lx-field lx-campaigns-wide">
        <span className="lx-label">Description</span>
        <input className="lx-input" name="description" maxLength={500} placeholder="Optional — who this is for and why" />
      </label>
      <div className="lx-campaigns-wide lx-campaigns-actions">
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
          {pending ? SAVING : "Create campaign"}
        </button>
        <Err state={state} />
      </div>
    </form>
  );
}

/** The page header's "New campaign" button: opens the same form in a dialog. */
export function NewCampaignButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="lx-btn lx-btn-pri" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        New campaign
      </button>
      {open && (
        <Dialog title="New campaign" onClose={() => setOpen(false)}>
          <NewSequenceForm />
        </Dialog>
      )}
    </>
  );
}
