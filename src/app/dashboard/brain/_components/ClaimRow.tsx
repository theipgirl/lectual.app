"use client";

import { useActionState } from "react";
import type { ClaimEntry } from "@/lib/brain";
import { CLAIM_STATUS_LABEL, pillToneForClaimStatus } from "../enums";
import { reviewClaimAction, type ActionState } from "../actions";

/**
 * One claim-library row. Every reader sees the claim text, its status, and
 * any context/reviewer notes. When canReview (admin or attorney — mirrors
 * crm_claim_update_review) and the claim is still 'proposed', an Approve /
 * Mark forbidden pair (with an optional note) is wired to reviewClaim.
 * reviewClaim re-checks the role itself; this is a UI affordance only.
 */
export default function ClaimRow({ claim, canReview }: { claim: ClaimEntry; canReview: boolean }) {
  const [approveState, approveAction, approvePending] = useActionState<ActionState, FormData>(
    reviewClaimAction,
    {},
  );
  const [forbidState, forbidAction, forbidPending] = useActionState<ActionState, FormData>(
    reviewClaimAction,
    {},
  );

  const error = approveState.error || forbidState.error;
  const showReview = canReview && claim.status === "proposed";

  return (
    <li className="lx-card lx-brain-row">
      <div className="lx-brain-row-head">
        <span className={`lx-pill lx-pill-${pillToneForClaimStatus(claim.status)}`}>
          {CLAIM_STATUS_LABEL[claim.status]}
        </span>
        {claim.source && <span className="lx-brain-key">via {claim.source}</span>}
      </div>

      <p className="lx-brain-body">{claim.claim}</p>

      {claim.context && <p className="lx-brain-context">{claim.context}</p>}

      {claim.status !== "proposed" && claim.notes && (
        <p className="lx-brain-note">Reviewer note: {claim.notes}</p>
      )}

      {showReview && (
        <div className="lx-brain-review">
          <form action={approveAction}>
            <input type="hidden" name="claimId" value={claim.id} />
            <input type="hidden" name="status" value="approved" />
            <label className="lx-field">
              <span className="lx-label">Note (optional)</span>
              <input name="notes" type="text" className="lx-input" />
            </label>
            <button type="submit" disabled={approvePending} className="lx-btn lx-btn-sec lx-btn-sm">
              {approvePending ? "…" : "Approve"}
            </button>
          </form>

          <form action={forbidAction}>
            <input type="hidden" name="claimId" value={claim.id} />
            <input type="hidden" name="status" value="forbidden" />
            <label className="lx-field">
              <span className="lx-label">Note (optional)</span>
              <input name="notes" type="text" className="lx-input" />
            </label>
            <button type="submit" disabled={forbidPending} className="lx-btn lx-btn-sec lx-btn-sm">
              {forbidPending ? "…" : "Mark forbidden"}
            </button>
          </form>
        </div>
      )}

      {error && <p role="alert" className="lx-brain-error">{error}</p>}
    </li>
  );
}
