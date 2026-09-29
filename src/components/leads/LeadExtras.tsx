"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  applyTagAction,
  prepConsultAction,
  removeTagAction,
  type ActionState,
  type PrepConsultActionState,
} from "@/app/dashboard/leads/[id]/actions";
import { PREP_CONSULT_PRACTICE_AREAS } from "@/lib/prep-consult/prep-consult";

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
        ×
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

/**
 * "Prep this consult": drafts the internal heads-up and the client prep email
 * into the approval queue. Nothing is sent. agent-toolkit only (the action
 * re-checks the module itself).
 */
export function PrepConsult({ leadId, practiceArea }: { leadId: string; practiceArea: string | null }) {
  const [state, action, pending] = useActionState<PrepConsultActionState, FormData>(prepConsultAction, {});
  if (state.headsUpQueueItemId && state.clientPrepQueueItemId) {
    return (
      <p className="lx-banner lx-banner-ok" style={{ margin: 0 }}>
        Both drafts are in the approval queue:{" "}
        <Link href={`/dashboard/queue/${state.headsUpQueueItemId}/`}>heads-up</Link> ·{" "}
        <Link href={`/dashboard/queue/${state.clientPrepQueueItemId}/`}>client prep email</Link>
      </p>
    );
  }
  const preset = PREP_CONSULT_PRACTICE_AREAS.find((a) => a.toLowerCase() === (practiceArea ?? "").toLowerCase()) ?? "";
  return (
    <form action={action} style={{ display: "grid", gap: 10 }}>
      <input type="hidden" name="leadId" value={leadId} />
      <label className="lx-field">
        <span className="lx-label">Practice area</span>
        <select name="practiceArea" className="lx-input" defaultValue={preset} required>
          <option value="" disabled>
            Choose…
          </option>
          {PREP_CONSULT_PRACTICE_AREAS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label className="lx-field">
        <span className="lx-label">What the client said they need</span>
        <textarea name="inquiryDescription" className="lx-input" rows={3} required placeholder="Quote them if you can." />
      </label>
      <label className="lx-field">
        <span className="lx-label">Session date and time (optional)</span>
        <input name="sessionWhen" className="lx-input" placeholder="Thursday, Oct 2 at 2:00pm ET" />
      </label>
      <label className="lx-field">
        <span className="lx-label">Zoom link (optional)</span>
        <input name="zoomLink" className="lx-input" type="url" placeholder="https://" />
      </label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
          {pending ? "Drafting…" : "Draft consult prep"}
        </button>
        <span className="lx-note">Goes to the approval queue. Nothing is sent.</span>
      </div>
      {state.error && <p role="alert" className="lx-note" style={{ color: "var(--wine)", margin: 0 }}>{state.error}</p>}
    </form>
  );
}
