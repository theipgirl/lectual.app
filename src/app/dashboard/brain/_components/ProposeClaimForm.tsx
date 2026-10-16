"use client";

import { useActionState } from "react";
import { proposeClaimAction, type ActionState } from "../actions";

/**
 * Collapsible "Propose a claim" form — open to any staff role except viewer
 * (crm_claim_insert_propose always inserts at status='proposed' here).
 * Proposing is not approving: an admin or attorney must review it before
 * it's usable client-facing copy (UPL/ad-rules firewall).
 */
export default function ProposeClaimForm() {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(
    proposeClaimAction,
    {},
  );

  return (
    <details className="lx-card lx-disclosure">
      <summary>Propose a claim</summary>
      <form action={formAction} className="lx-brain-form">
        <label className="lx-field">
          <span className="lx-label">Claim</span>
          <textarea
            name="claim"
            rows={2}
            required
            placeholder="e.g. “We file trademark applications in as little as 48 hours.”"
            className="lx-input"
          />
        </label>

        <label className="lx-field">
          <span className="lx-label">Context (optional)</span>
          <input name="context" type="text" placeholder="Where would this be used?" className="lx-input" />
        </label>

        <button type="submit" className="lx-btn lx-btn-pri" disabled={pending} style={{ justifySelf: "start" }}>
          {pending ? "Proposing…" : "Propose claim"}
        </button>

        {state.error && <p role="alert" className="lx-brain-error">{state.error}</p>}
      </form>
    </details>
  );
}
