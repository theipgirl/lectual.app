"use client";

import Link from "next/link";
import { queuePostConsultEmailAction } from "@/app/dashboard/proposals/[id]/actions";
import { MANUAL_EMAIL_LABEL, MANUAL_EMAIL_PENDING } from "@/lib/consult-proposal/manual-email";
import { ActionForm, Outcome } from "./ActionForm";

/**
 * "Create post-consult email": queues the firm's approved proposal email for this proposal in the
 * approval queue. It never sends: the queue's approver approves it, and a person sends the draft.
 * Shown to staff for a draft, saved or link-live version; the action re-checks everything.
 */
export function PostConsultEmail({ proposalId }: { proposalId: string }) {
  return (
    <ActionForm action={queuePostConsultEmailAction} className="pe-act">
      {({ state, pending }) => (
        <>
          <input type="hidden" name="proposalId" value={proposalId} />
          <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
            {pending ? MANUAL_EMAIL_PENDING : MANUAL_EMAIL_LABEL}
          </button>
          <Outcome state={state} pending={pending} />
          {!pending && state.saved && state.queueId && (
            <Link href={`/dashboard/queue/${state.queueId}/`}>Open it in the approval queue</Link>
          )}
        </>
      )}
    </ActionForm>
  );
}
