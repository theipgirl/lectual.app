"use client";

import { linkLeadAction } from "@/app/dashboard/proposals/[id]/actions";
import type { LeadOptionRow } from "@/lib/proposals/lead-options";
import { ActionForm, Outcome } from "./ActionForm";

/** Links an unlinked proposal to one of the firm's recent leads. A failed lead list says so and offers nothing to pick. */
export function LinkLeadForm({ proposalId, updatedAt, leads }: { proposalId: string; updatedAt: string; leads: LeadOptionRow[] | null }) {
  if (leads === null) return <span className="lx-note">We couldn&apos;t load your leads, so one can&apos;t be linked right now.</span>;
  if (leads.length === 0) return <span className="lx-note">There are no leads to link yet.</span>;
  return (
    <ActionForm action={linkLeadAction} className="pe-link-lead">
      {({ state, pending }) => (
        <>
          <input type="hidden" name="proposalId" value={proposalId} />
          <input type="hidden" name="updatedAt" value={updatedAt} />
          <label className="pe-check" style={{ whiteSpace: "normal" }}>
            <span className="lx-label">Link to a lead</span>
            <select className="lx-input" name="leadId" defaultValue="" required>
              <option value="" disabled>
                Choose a lead
              </option>
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
            {pending ? "Linking…" : "Link lead"}
          </button>
          <Outcome state={state} pending={pending} savedText="Linked." />
        </>
      )}
    </ActionForm>
  );
}
