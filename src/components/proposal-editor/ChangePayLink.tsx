"use client";

import { changePayLinkAction } from "@/app/dashboard/proposals/[id]/actions";
import { PAY_LINK_LABEL } from "@/lib/proposal-editor/pay-link";
import { ActionForm, Outcome } from "./ActionForm";

/**
 * "Change pay link" for a version whose link is live (lectual 0100). The page shows it only for a
 * `sent` version and a proposal-writing role; the action re-checks the module and the role, and the
 * database refuses every other status. Only the pay link changes: the offer the client sees does not.
 */
export function ChangePayLink({ proposalId, updatedAt, payUrl }: { proposalId: string; updatedAt: string; payUrl: string }) {
  return (
    <section className="lx-card pe-card" aria-label={PAY_LINK_LABEL}>
      <header className="pe-card-head">
        <h2 className="pe-h">{PAY_LINK_LABEL}</h2>
        <p className="lx-note pe-hint">
          Where &ldquo;Accept&rdquo; sends the client to pay. The link stays live and nothing else in the proposal changes. Nothing is emailed.
        </p>
      </header>
      <ActionForm action={changePayLinkAction}>
        {({ state, pending }) => (
          <fieldset className="pe-fieldset" disabled={pending}>
            <input type="hidden" name="proposalId" value={proposalId} />
            <input type="hidden" name="updatedAt" value={updatedAt} />
            <label className="lx-field">
              <span className="lx-label">Pay link</span>
              <input
                className="lx-input"
                name="payUrl"
                type="url"
                required
                maxLength={2000}
                defaultValue={payUrl}
                placeholder="Enter custom pay link"
              />
            </label>
            <div className="pe-bar">
              <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
              <Outcome state={state} pending={pending} />
            </div>
          </fieldset>
        )}
      </ActionForm>
    </section>
  );
}
