"use client";

import { markPaidAction } from "@/app/dashboard/proposals/[id]/paid-actions";
import { ActionForm, Outcome } from "@/components/proposal-editor/ActionForm";
import type { PaidMarker } from "@/lib/proposals/paid-view";

/**
 * The Paid / Not paid / Couldn't read marker under an accepted row's status, and Mark paid for
 * the roles that may. The marker is the same `PaidState` the proposal page reads; while the
 * read failed there is no button, so a stale click can't mark a version twice.
 */
export function PaidCell({ proposalId, marker, canMarkPaid }: { proposalId: string; marker: PaidMarker; canMarkPaid: boolean }) {
  return (
    <div className="pq-paid">
      <span className={`lx-pill lx-pill-${marker.tone}`} data-paid={marker.state}>
        {marker.label}
      </span>
      {canMarkPaid && (
        <ActionForm action={markPaidAction} className="pq-paid-form">
          {({ state, pending }) => (
            <>
              <input type="hidden" name="proposalId" value={proposalId} />
              <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
                {pending ? "Marking…" : "Mark paid"}
              </button>
              <Outcome state={state} pending={pending} />
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}
