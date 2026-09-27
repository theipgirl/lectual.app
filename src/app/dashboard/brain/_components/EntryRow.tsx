"use client";

import { useActionState } from "react";
import type { BrainEntry } from "@/lib/brain";
import { updateBrainEntryAction, deleteBrainEntryAction, type ActionState } from "../actions";

function preview(body: string, max = 160): string {
  const trimmed = body.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max).trimEnd()}…`;
}

/**
 * One brain-entry row: title, key, and a short body preview for every reader.
 * Admins (canManage) additionally get a collapsible edit form and a delete
 * button — both admin-gated server actions; @/lib/brain re-checks and RLS is
 * the real boundary if a non-admin somehow posts one of these forms.
 */
export default function EntryRow({ entry, canManage }: { entry: BrainEntry; canManage: boolean }) {
  const [editState, editAction, editPending] = useActionState<ActionState, FormData>(
    updateBrainEntryAction,
    {},
  );
  const [deleteState, deleteAction, deletePending] = useActionState<ActionState, FormData>(
    deleteBrainEntryAction,
    {},
  );

  const error = editState.error || deleteState.error;

  return (
    <li className="lx-card lx-brain-row">
      <div className="lx-brain-row-head">
        <div className="lx-brain-row-title">
          <strong>{entry.title}</strong>
          <span className="lx-brain-key">{entry.key}</span>
        </div>
        {canManage && (
          <form action={deleteAction}>
            <input type="hidden" name="entryId" value={entry.id} />
            <button type="submit" disabled={deletePending} className="lx-btn lx-btn-sec lx-btn-sm">
              {deletePending ? "…" : "Delete"}
            </button>
          </form>
        )}
      </div>

      {entry.body && <p className="lx-brain-body">{preview(entry.body)}</p>}

      {canManage && (
        <details className="lx-brain-edit">
          <summary>Edit</summary>
          <form action={editAction} className="lx-brain-form">
            <input type="hidden" name="entryId" value={entry.id} />
            <label className="lx-field">
              <span className="lx-label">Title</span>
              <input name="title" type="text" defaultValue={entry.title} required className="lx-input" />
            </label>
            <label className="lx-field">
              <span className="lx-label">Body</span>
              <textarea name="body" rows={4} defaultValue={entry.body} className="lx-input" />
            </label>
            <button type="submit" disabled={editPending} className="lx-btn lx-btn-pri lx-btn-sm" style={{ justifySelf: "start" }}>
              {editPending ? "Saving…" : "Save entry"}
            </button>
          </form>
        </details>
      )}

      {error && <p role="alert" className="lx-brain-error">{error}</p>}
    </li>
  );
}
