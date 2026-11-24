"use client";

import { useActionState } from "react";
import {
  applyTagAction,
  removeTagAction,
  type ActionState,
} from "@/app/dashboard/leads/[id]/actions";
import { Icon } from "@/components/ui/Icon";

type TagRef = { id: string; label: string; color: string | null };

function RemoveTag({ leadId, tag }: { leadId: string; tag: TagRef }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(removeTagAction, {});
  return (
    <form action={action} className="lx-tag" title={state.error}>
      <input type="hidden" name="leadId" value={leadId} />
      <input type="hidden" name="tagId" value={tag.id} />
      {tag.color && <span className="lx-tag-dot" style={{ background: tag.color }} aria-hidden="true" />}
      {tag.label}
      <button type="submit" aria-label={`Remove ${tag.label}`} disabled={pending}>
        <Icon name="close" size={14} />
      </button>
    </form>
  );
}

/** Applied tags, and a picker for the firm's catalog. Staff roles only; RLS re-checks. */
export function LeadTags({ leadId, applied, catalog, canWrite }: { leadId: string; applied: TagRef[]; catalog: TagRef[]; canWrite: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(applyTagAction, {});
  const available = catalog.filter((t) => !applied.some((a) => a.id === t.id));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {applied.length === 0 && <span className="lx-note">No tags.</span>}
        {applied.map((t) =>
          canWrite ? (
            <RemoveTag key={t.id} leadId={leadId} tag={t} />
          ) : (
            <span key={t.id} className="lx-tag">
              {t.label}
            </span>
          ),
        )}
      </div>
      {canWrite && available.length > 0 && (
        <form action={action} className="lx-inline-form">
          <input type="hidden" name="leadId" value={leadId} />
          <select name="tagId" className="lx-input" defaultValue="" aria-label="Add a tag" disabled={pending} onChange={(e) => e.currentTarget.form?.requestSubmit()}>
            <option value="" disabled>
              Add a tag…
            </option>
            {available.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
          {state.error && <span role="alert" className="lx-note" style={{ color: "var(--wine)" }}>{state.error}</span>}
        </form>
      )}
    </div>
  );
}
