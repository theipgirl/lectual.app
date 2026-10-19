"use client";

import Link from "next/link";
import { useActionState } from "react";
import { draftProposalFromTranscriptAction, type PasteProposalState } from "@/app/dashboard/leads/[id]/proposal-actions";

/** Paste a consult transcript; the agent drafts the proposal and its email. Nothing is stored but the quotes it relied on. */
export function ProposalFromTranscript({ leadId, maxChars }: { leadId: string; maxChars: number }) {
  const [state, action, pending] = useActionState<PasteProposalState, FormData>(draftProposalFromTranscriptAction, {});
  return (
    <form action={action} style={{ display: "grid", gap: 8 }}>
      <input type="hidden" name="leadId" value={leadId} />
      <label className="lx-field">
        <span className="lx-label">Consult transcript</span>
        <textarea
          className="lx-input"
          name="transcript"
          rows={8}
          maxLength={maxChars}
          required
          spellCheck={false}
          placeholder="Paste what was said on the call. Speaker names help."
          disabled={pending || state.ok}
        />
      </label>
      <p className="lx-note" style={{ margin: 0 }}>
        The agent drafts the proposal from what was recommended on the call, at the firm&apos;s standard prices, and writes the email with its link. The transcript is not saved:
        only the short quotes it relied on are kept on the proposal. Nothing is sent.
      </p>
      <div>
        <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending || state.ok}>
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
