"use client";

import { linkLeadAction } from "@/app/dashboard/proposals/[id]/actions";
import type { LeadOptionRow } from "@/lib/proposals/lead-options";
import { ActionForm, Outcome } from "./ActionForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { LoadFailedLine } from "@/components/ui/LoadFailed";
import { SAVING } from "@/lib/ui/words";

/** Links an unlinked proposal to one of the firm's recent leads. A failed lead list says so and offers nothing to pick. */
export function LinkLeadForm({ proposalId, updatedAt, leads }: { proposalId: string; updatedAt: string; leads: LeadOptionRow[] | null }) {
  if (leads === null) return <LoadFailedLine>We couldn&apos;t load your leads, so one can&apos;t be linked right now.</LoadFailedLine>;
  if (leads.length === 0) return <EmptyState variant="line">There are no leads to link yet.</EmptyState>;
  return (
    <ActionForm action={linkLeadAction} className="pe-link-lead">
      {({ state, pending }) => (
        <>
          <input type="hidden" name="proposalId" value={proposalId} />
          <input type="hidden" name="updatedAt" value={updatedAt} />
          <Field label="Link to a lead">
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
          </Field>
          <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
            {pending ? SAVING : "Link lead"}
          </button>
          <Outcome state={state} pending={pending} savedText="Linked." />
        </>
      )}
    </ActionForm>
  );
}
