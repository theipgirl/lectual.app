"use client";

import Link from "next/link";
import { useState } from "react";
import type { ProposalStatus } from "@/lib/proposals/types";
import { joinOr } from "@/lib/proposal-editor/labels";
import { approveAction, reviseAction, sendAction, unapproveAction, withdrawAction } from "@/app/dashboard/proposals/[id]/actions";
import { ActionForm, Outcome } from "./ActionForm";

/**
 * The lifecycle buttons for one version. What is SHOWN follows the status; the
 * database trigger and the store enforce what is ALLOWED (only a named approver
 * reaches `approved`, a sent version is frozen). Each button is its own server
 * action, which re-checks the module and the caller's role.
 */
export function Lifecycle({
  proposalId,
  status,
  version,
  canWrite,
  isApprover,
  blockingErrors,
  approverNames,
  clientUrl,
  queueNote = null,
}: {
  proposalId: string;
  status: ProposalStatus;
  version: number;
  canWrite: boolean;
  isApprover: boolean;
  /** `validateContent` errors at approval strictness; Approve is held back while any remain. */
  blockingErrors: number;
  approverNames: string[];
  /** `/p/<token>` on this app's origin; only passed for approved / sent versions. */
  clientUrl: string | null;
  /** Set when this proposal's email is still pending in the approval queue (or can't be read): shown instead of "Mark as sent". */
  queueNote?: { text: string; queueId: string | null } | null;
}) {
  const hidden = <input type="hidden" name="proposalId" value={proposalId} />;
  const approvers = approverNames.length > 0 ? joinOr(approverNames) : "a named approver";

  return (
    <div className="pe-bar" role="group" aria-label="Proposal actions">
      {canWrite && status === "draft" && isApprover && (
        <ActionForm action={approveAction} className="pe-act">
          {({ state, pending }) => (
            <>
              {hidden}
              <button type="submit" className="lx-btn lx-btn-pri" disabled={pending || blockingErrors > 0} title={blockingErrors > 0 ? "Fix the problems listed first" : undefined}>
                {pending ? "Approving…" : "Approve"}
              </button>
              <Outcome state={state} pending={pending} />
            </>
          )}
        </ActionForm>
      )}
      {canWrite && status === "draft" && !isApprover && (
        <span className="lx-note">Waiting for {approvers} to approve it.</span>
      )}

      {canWrite && status === "approved" && queueNote && (
        <span className="lx-note" role="note">
          {queueNote.text}{" "}
          <Link href={queueNote.queueId ? `/dashboard/queue/${queueNote.queueId}/` : "/dashboard/queue/"}>
            {queueNote.queueId ? "Open the queue item" : "Open the approval queue"}
          </Link>
          .
        </span>
      )}
      {canWrite && status === "approved" && !queueNote && (
        <ActionForm action={sendAction} className="pe-act">
          {({ state, pending }) => (
            <>
              {hidden}
              <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
                {pending ? "Marking…" : "Mark as sent"}
              </button>
              <Outcome state={state} pending={pending} />
            </>
          )}
        </ActionForm>
      )}

      {clientUrl && (status === "approved" || status === "sent") && <CopyLink url={clientUrl} live={status === "sent"} />}

      {canWrite && status === "approved" && (
        <ActionForm action={unapproveAction} className="pe-act">
          {({ state, pending }) => (
            <>
              {hidden}
              <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
                Back to draft
              </button>
              <Outcome state={state} pending={pending} />
            </>
          )}
        </ActionForm>
      )}

      {canWrite && status === "sent" && (
        <ActionForm action={reviseAction} className="pe-act">
          {({ state, pending }) => (
            <>
              {hidden}
              <button type="submit" className="lx-btn lx-btn-sec" disabled={pending} title={`Starts version ${version + 1} as a draft`}>
                {pending ? "Creating…" : `Revise (start version ${version + 1})`}
              </button>
              <Outcome state={state} pending={pending} />
            </>
          )}
        </ActionForm>
      )}

      {canWrite && (status === "draft" || status === "approved" || status === "sent") && (
        <ActionForm
          action={withdrawAction}
          className="pe-act"
          confirm={status === "sent" ? "Withdraw this version? The client’s link will stop opening it." : "Withdraw this version? It can’t be brought back."}
        >
          {({ state, pending }) => (
            <>
              {hidden}
              <button type="submit" className="lx-btn lx-btn-danger" disabled={pending}>
                Withdraw
              </button>
              <Outcome state={state} pending={pending} />
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}

/** Copies the client link. Shows it too, so it can be selected by hand if the clipboard is blocked. */
function CopyLink({ url, live }: { url: string; live: boolean }) {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("yes");
    } catch {
      setCopied("no");
    }
    setTimeout(() => setCopied(null), 2500);
  }
  return (
    <div className="pe-link">
      <button type="button" className="lx-btn lx-btn-sec" onClick={copy}>
        {copied === "yes" ? "Copied" : "Copy client link"}
      </button>
      <input className="lx-input pe-link-url" readOnly value={url} aria-label="Client link" onFocus={(e) => e.currentTarget.select()} />
      <span className="lx-note" role="status">
        {copied === "no" ? "Couldn’t copy. Select the link and copy it." : live ? "" : "The link opens once you mark it as sent."}
      </span>
    </div>
  );
}
