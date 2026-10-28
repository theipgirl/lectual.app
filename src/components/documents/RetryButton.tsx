"use client";

import { useActionState } from "react";
import { retryDocumentAction } from "@/app/dashboard/documents/actions";
import type { RetryState } from "@/lib/documents/retry";

/** Retry on a failed letter. The result (done, or a fixed sentence) is shown beside the button. */
export function RetryButton({ draftId }: { draftId: string }) {
  const [state, action, pending] = useActionState<RetryState, FormData>(retryDocumentAction, {});
  return (
    <form action={action} style={{ display: "inline-grid", gap: 4, justifyItems: "end" }}>
      <input type="hidden" name="draftId" value={draftId} />
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
        {pending ? "Retrying…" : "Retry"}
      </button>
      {state.error && (
        <span role="alert" className="lx-note" style={{ color: "var(--wine)" }}>
          {state.error}
        </span>
      )}
      {state.notice && (
        <span role="status" className="lx-note" style={{ color: "var(--ok)" }}>
          {state.notice}
        </span>
      )}
    </form>
  );
}
