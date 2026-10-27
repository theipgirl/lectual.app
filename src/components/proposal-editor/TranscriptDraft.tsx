"use client";

import Link from "next/link";
import { useActionState } from "react";
import { draftProposalFromUploadAction, type TranscriptDraftState } from "@/app/dashboard/proposals/transcript-actions";
import { TranscriptFields } from "@/components/leads/TranscriptFields";

export type LeadOption = { id: string; label: string };

/**
 * "Draft from a transcript" on the proposals page: choose the lead, then paste
 * the transcript or upload a file. The agent drafts the proposal for a named
 * approver and its email for the approval queue. Nothing is sent or stored.
 */
export function TranscriptDraft({ leads, maxChars, defaultLeadId = "" }: { leads: LeadOption[]; maxChars: number; /** The lead the page was opened for (`?lead=`); only used when it is one of `leads`. */ defaultLeadId?: string }) {
  const [state, action, pending] = useActionState<TranscriptDraftState, FormData>(draftProposalFromUploadAction, {});
  const locked = pending || !!state.ok;
  return (
    <form action={action} style={{ display: "grid", gap: 8 }}>
      <label className="lx-field">
        <span className="lx-label">Lead</span>
        <select className="lx-input" name="leadId" required defaultValue={leads.some((l) => l.id === defaultLeadId) ? defaultLeadId : ""} disabled={locked}>
          <option value="" disabled>
            Choose the lead this call was with
          </option>
          {leads.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <TranscriptFields maxChars={maxChars} disabled={locked} />
      <div>
        <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={locked}>
          {pending ? "Drafting…" : state.ok ? "Drafted" : "Draft proposal + email"}
        </button>
      </div>
      {state.error && (
        <p role="alert" className="lx-note" style={{ margin: 0, color: "var(--wine)" }}>
          {state.error}
        </p>
      )}
      {state.notice && (
        <p role="status" className="lx-note" style={{ margin: 0, color: "var(--ok)" }}>
          {state.notice}{" "}
          {state.href && <Link href={state.href}>Open the proposal</Link>}
        </p>
      )}
    </form>
  );
}
