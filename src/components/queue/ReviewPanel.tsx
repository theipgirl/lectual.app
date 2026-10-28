"use client";

import { useActionState, useState } from "react";
import "./review.css";
import { reviewQueueAction, type ReviewState } from "@/app/dashboard/queue/actions";
import { Markdown } from "@/components/markdown/Markdown";
// The pure module only: this component ships to the browser.
import { auditDraft, removeInternalNotes, type AuditContext } from "@/lib/queue/hygiene";

/**
 * Edit / approve / reject for one pending item. `canApprove` / `canEdit` only
 * decide what is rendered; the action re-checks the role on every submit.
 *
 * The draft is drawn ONCE. By default it is the rendered view with an Edit button; Edit swaps the view for the
 * editor (never both), and "Done editing" or Cancel swap back. Done keeps what was typed (the view then shows the
 * edit, marked "edited", and Approve / Save edit post it); Cancel puts back what the editor opened with.
 */
export function ReviewPanel(props: {
  id: string;
  initialBody: string;
  canApprove: boolean;
  canEdit: boolean;
  /** Set when the client signed / paid / became a client since this was
   * queued (or that couldn't be checked): Approve stays disabled until the
   * approver ticks this. The action refuses without it too. */
  confirmStale?: string | null;
  /** What the checks below need (type, the firm's sign-off, member names). Absent = no checks drawn. */
  audit?: AuditContext;
}) {
  const { id, initialBody, canApprove, canEdit, confirmStale, audit } = props;
  const [state, action, pending] = useActionState<ReviewState, FormData>(reviewQueueAction, {});
  const [body, setBody] = useState(initialBody);
  const [editing, setEditing] = useState(false);
  // What the editor opened with, so Cancel can put it back.
  const [openedWith, setOpenedWith] = useState(initialBody);
  const [staleConfirmed, setStaleConfirmed] = useState(false);
  const dirty = body !== initialBody;
  const approveBlocked = !!confirmStale && !staleConfirmed;
  const issues = audit ? auditDraft(body, audit) : [];
  const blocking = issues.some((i) => i.level === "error");
  const cleaned = audit ? removeInternalNotes(body, audit.type) : null;

  return (
    <form action={action} className="lx-review">
      <input type="hidden" name="id" value={id} />
      {issues.length > 0 && (
        <div
          role="alert"
          aria-label="Checks on this draft"
          className={`lx-banner ${blocking ? "lx-banner-risk" : "lx-banner-warn"}`}
          style={{ display: "grid", gap: 8, margin: 0 }}
        >
          <strong style={{ fontSize: 16 }}>{blocking ? "Fix this before approving" : "Check this draft"}</strong>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
            {issues.map((issue) => (
              <li key={issue.code}>{issue.message}</li>
            ))}
          </ul>
          {canEdit && cleaned && cleaned.moved.length > 0 && (
            <div>
              <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => setBody(cleaned.body)}>
                Remove internal notes
              </button>
            </div>
          )}
        </div>
      )}
      {editing && canEdit ? (
        <div className="lx-view-draft" data-draft-mode="edit">
          <div className="lx-view-draft-head">
            <label htmlFor="body" className="lx-label">
              Draft {dirty && <span style={{ color: "var(--warn)" }}>· edited</span>}
            </label>
            <span style={{ display: "flex", gap: 8 }}>
              <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => setEditing(false)}>
                Done editing
              </button>
              <button
                type="button"
                className="lx-btn lx-btn-ghost lx-btn-sm"
                onClick={() => {
                  setBody(openedWith);
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            </span>
          </div>
          <textarea
            id="body"
            name={dirty ? "body" : undefined}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={Math.min(24, Math.max(10, body.split("\n").length + 2))}
            className="lx-input lx-draft"
          />
        </div>
      ) : (
        <section aria-labelledby="draft-view-label" className="lx-view-draft lx-voice" data-draft-mode="view">
          <div className="lx-view-draft-head">
            <div id="draft-view-label" className="lx-label">
              Draft {dirty && <span style={{ color: "var(--warn)" }}>· edited</span>}
            </div>
            {canEdit && (
              <button
                type="button"
                className="lx-btn lx-btn-sec lx-btn-sm"
                onClick={() => {
                  setOpenedWith(body);
                  setEditing(true);
                }}
              >
                Edit
              </button>
            )}
          </div>
          {body.trim() ? <Markdown text={body} /> : <p className="lx-note" style={{ margin: 0 }}>Nothing to show yet.</p>}
          <p className="lx-note" style={{ margin: 0 }}>
            How this text reads. An email may show formatting marks as plain characters.
          </p>
          {/* An edit made in the editor is posted from here, so Approve and Save edit carry it whichever view is showing. */}
          {dirty && <input type="hidden" name="body" value={body} />}
        </section>
      )}

      {canApprove && (
        <>
          <label htmlFor="note" className="lx-label">
            Note <span style={{ textTransform: "none", letterSpacing: 0 }}>(required to reject)</span>
          </label>
          <input id="note" name="note" type="text" className="lx-input" placeholder="Why — e.g. wrong fee quoted, tone off…" />
        </>
      )}

      {canApprove && confirmStale && (
        <label className="lx-banner lx-banner-risk" style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: 0, cursor: "pointer" }}>
          <input
            type="checkbox"
            name="confirm_stale"
            value="yes"
            checked={staleConfirmed}
            onChange={(e) => setStaleConfirmed(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>{confirmStale}</span>
        </label>
      )}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {canApprove && (
          <button
            type="submit"
            name="intent"
            value="approve"
            disabled={pending || approveBlocked}
            title={approveBlocked ? "Tick the box above first — this client's status changed since the draft was queued." : undefined}
            className="lx-btn lx-btn-pri"
          >
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
