"use client";

import { useActionState } from "react";
import { retryDocumentAction } from "@/app/dashboard/documents/actions";
import { Notice, SavedNote } from "@/components/ui";
import { SAVING } from "@/lib/ui/words";
import "./documents.css";
import type { RetryState } from "@/lib/documents/retry";

/** Retry on a failed letter. The result (done, or a fixed sentence) is shown beside the button. */
export function RetryButton({ draftId }: { draftId: string }) {
  const [state, action, pending] = useActionState<RetryState, FormData>(retryDocumentAction, {});
  return (
    <form action={action} className="doc-retry">
      <input type="hidden" name="draftId" value={draftId} />
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
        {pending ? SAVING : "Retry"}
      </button>
      {state.error && (
        <Notice tone="risk" role="alert">
          {state.error}
        </Notice>
      )}
      <SavedNote show={!!state.notice}>{state.notice}</SavedNote>
    </form>
  );
}
