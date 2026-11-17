"use client";

import Link from "next/link";
import { useActionState } from "react";
import { SAVING } from "@/lib/ui/words";
import { draftProposalFromMeetingAction, type TranscriptDraftState } from "@/app/dashboard/proposals/transcript-actions";

/**
 * The consult row's primary "Draft the proposal". It posts only the meeting's id: the
 * server reads the meeting, its transcript and its lead itself, through the same gates as
 * the pasted-transcript form. Nothing is sent; a named approver approves what it drafts.
 * Once it has run, the page refreshes and the row reads Drafted with "Open the draft".
 */
export function DraftMeetingButton({ meetingId }: { meetingId: string }) {
  const [state, action, pending] = useActionState<TranscriptDraftState, FormData>(draftProposalFromMeetingAction, {});
  return (
    <form action={action} className="pq-cta">
      <input type="hidden" name="meetingId" value={meetingId} />
      <button type="submit" className="lx-btn lx-btn-pri" disabled={pending || !!state.ok}>
        {pending ? SAVING : state.ok ? "Drafted" : "Draft the proposal"}
      </button>
      {state.error && (
        <p role="alert" className="pe-msg pe-msg-err pq-cta-msg">
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="pe-msg pe-msg-ok pq-cta-msg">
          {state.notice} {state.href && <Link href={state.href}>Open the draft</Link>}
        </p>
      )}
    </form>
  );
}
