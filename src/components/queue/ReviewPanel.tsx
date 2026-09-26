"use client";

import { useActionState, useState } from "react";
import { reviewQueueAction, type ReviewState } from "@/app/dashboard/queue/actions";

/**
 * Edit / approve / reject for one pending item. `canApprove` / `canEdit` only
 * decide what is rendered; the action re-checks the role on every submit.
 */
export function ReviewPanel(props: { id: string; initialBody: string; canApprove: boolean; canEdit: boolean }) {
  const { id, initialBody, canApprove, canEdit } = props;
  const [state, action, pending] = useActionState<ReviewState, FormData>(reviewQueueAction, {});
  const [body, setBody] = useState(initialBody);
  const dirty = body !== initialBody;

  return (
    <form action={action} className="lx-review">
      <input type="hidden" name="id" value={id} />
      <label htmlFor="body" className="lx-label">
        Draft {dirty && <span style={{ color: "var(--warn)" }}>· edited</span>}
      </label>
      <textarea
        id="body"
        name={dirty ? "body" : undefined}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        readOnly={!canEdit}
        rows={Math.min(24, Math.max(10, body.split("\n").length + 2))}
        className="lx-input lx-draft"
      />

      {canApprove && (
        <>
          <label htmlFor="note" className="lx-label">
            Note <span style={{ textTransform: "none", letterSpacing: 0 }}>(required to reject)</span>
          </label>
          <input id="note" name="note" type="text" className="lx-input" placeholder="Why — e.g. wrong fee quoted, tone off…" />
        </>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {canApprove && (
          <button type="submit" name="intent" value="approve" disabled={pending} className="lx-btn lx-btn-pri">
            {pending ? "Working…" : dirty ? "Approve with edits" : "Approve"}
          </button>
        )}
        {canEdit && (
          <button type="submit" name="intent" value="save" disabled={pending || !dirty} className="lx-btn lx-btn-sec">
            Save edit
          </button>
        )}
        {canApprove && (
          <button type="submit" name="intent" value="reject" disabled={pending} className="lx-btn lx-btn-danger">
            Reject
          </button>
        )}
      </div>

      {!canApprove && (
        <p className="lx-banner lx-banner-mute" style={{ margin: 0 }}>
          {canEdit
            ? "You can prepare and save edits to this draft, but approving or rejecting a client communication is an attorney's call."
            : "Your role is read-only for the approval queue."}
        </p>
      )}
      {state.error && (
        <p role="alert" className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
          {state.error}
        </p>
      )}
      <p className="lx-note" style={{ margin: 0 }}>
        Approving creates a draft in your mail client — you still press Send. Nothing reaches a client on its own. The original draft is kept alongside your edits.
      </p>
    </form>
  );
}
