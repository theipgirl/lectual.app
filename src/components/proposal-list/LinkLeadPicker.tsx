"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CANCEL, SAVING } from "@/lib/ui/words";
import { linkMeetingAction, type ActionState } from "@/app/dashboard/meetings/actions";

/**
 * "Link to a lead": a small picker on a consult row that has no lead. It posts to the same
 * `linkMeetingAction` the Meetings page uses (role check, composite foreign keys and the lead's
 * last touch are all there), then refreshes the page so the row moves on to its next step. The
 * meeting's own matter is sent back as it was, so linking a lead never drops it.
 *
 * `leads` is null when the lead list could not be read: that is its own alert, never "no leads".
 */
export function LinkLeadPicker({
  meetingId,
  matterId,
  leads,
}: {
  meetingId: string;
  matterId?: string | null;
  leads: { id: string; label: string }[] | null;
}) {
  const router = useRouter();
  const ref = useRef<HTMLDetailsElement>(null);
  const [state, action, pending] = useActionState<ActionState, FormData>(linkMeetingAction, {});
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state.ok, router]);

  return (
    <details
      ref={ref}
      className="pq-link-pick"
      onKeyDown={(e) => {
        if (e.key === "Escape" && ref.current) ref.current.open = false;
      }}
    >
      <summary className="lx-btn lx-btn-sec">Link to a lead</summary>
      {leads === null ? (
        <p role="alert" className="pe-msg pe-msg-err pq-pick-note">
          Can&apos;t show your leads right now. Refresh to try again.
        </p>
      ) : leads.length === 0 ? (
        <p className="lx-note pq-pick-note">
          You have no leads yet. Add one in Intake first.
        </p>
      ) : (
        <form action={action} className="pq-link-form">
          <input type="hidden" name="meetingId" value={meetingId} />
          {matterId && <input type="hidden" name="matterId" value={matterId} />}
          <select name="leadId" className="lx-input" aria-label="Lead" defaultValue="" required>
            <option value="" disabled>
              Choose a lead
            </option>
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          <button type="submit" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending}>
            {pending ? SAVING : "Link"}
          </button>
          <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => ref.current && (ref.current.open = false)}>
            {CANCEL}
          </button>
          {state.error && (
            <p role="alert" className="pe-msg pe-msg-err pq-link-err">
              {state.error}
            </p>
          )}
        </form>
      )}
    </details>
  );
}
