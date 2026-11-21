"use client";

import "./handed.css";
import { useActionState } from "react";
import { retryPassAction, type MakeDraftState } from "@/app/dashboard/queue/actions";
import { Notice } from "@/components/ui/Notice";
import { RETRY_PASS_INTRO, SAVING, passToDrafterButton } from "@/lib/ui/words";

/** "Pass to <drafter>" (S3) for the approver of an email whose pass didn't go through. The form posts the item id only. */
export function RetryPassCard({ id, drafterName }: { id: string; drafterName: string }) {
  const [state, action, pending] = useActionState<MakeDraftState, FormData>(retryPassAction, {});
  return (
    <section className="lx-card lx-handed" data-retry-pass aria-label={passToDrafterButton(drafterName)}>
      <p className="lx-handed-by">{RETRY_PASS_INTRO}</p>
      <form action={action} className="lx-sendback">
        <input type="hidden" name="id" value={id} />
        {state.error && (
          <Notice tone="risk" role="alert">
            {state.error}
          </Notice>
        )}
        {state.message && (
          <Notice tone="ok" role="status">
            {state.message}
          </Notice>
        )}
        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending || !!state.message}>
          {pending ? SAVING : passToDrafterButton(drafterName)}
        </button>
      </form>
    </section>
  );
}
