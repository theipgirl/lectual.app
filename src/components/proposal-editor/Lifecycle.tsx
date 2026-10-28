"use client";

import Link from "next/link";
import { useState } from "react";
import type { ProposalStatus } from "@/lib/proposals/types";
import { joinOr } from "@/lib/proposal-editor/labels";
import { createLinkAction, reviseAction, sendAction, unapproveAction, withdrawAction } from "@/app/dashboard/proposals/[id]/actions";
import Popover from "@/components/list-page/Popover";
import { NOT_EMAILED } from "@/lib/consult-proposal/manual-email";
import { BUTTON_WORDS, LINK_NOT_LIVE_YET, askToCreateLink } from "@/lib/proposal-editor/vocabulary";
import { ActionForm, Outcome } from "./ActionForm";
import { PostConsultEmail } from "./PostConsultEmail";

/**
 * The lifecycle buttons for one version. What is SHOWN follows the status; the
 * database trigger and the store enforce what is ALLOWED (only a named approver
 * reaches `approved`, a sent version is frozen). Each button is its own server
 * action, which re-checks the module and the caller's role.
 *
 * "Save and create link" does the approve and the send in one click. "Sent" in the
 * database only means the link is live: nothing here emails a client. The words
 * are in vocabulary.ts.
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
  /** `validateContent` errors at approval strictness; "Save and create link" is held back while any remain. */
  blockingErrors: number;
  approverNames: string[];
  /** The client link (the firm's own domain when configured). Only passed once the link is live (sent / accepted). */
  clientUrl: string | null;
  /** Set when this proposal's email is still pending in the approval queue (or can't be read): shown instead of "Turn on the link". */
  queueNote?: { text: string; queueId: string | null } | null;
}) {
  const hidden = <input type="hidden" name="proposalId" value={proposalId} />;
  const approvers = approverNames.length > 0 ? joinOr(approverNames) : "a named approver";

  return (
    <div className="pe-bar" role="group" aria-label="Proposal actions">
      {canWrite && status === "draft" && isApprover && (
        <ActionForm action={createLinkAction} className="pe-act">
          {({ state, pending }) => (
            <>
              {hidden}
              <button type="submit" className="lx-btn lx-btn-pri" disabled={pending || blockingErrors > 0} title={blockingErrors > 0 ? "Fix the problems listed first" : undefined}>
                {pending ? BUTTON_WORDS.creatingLink : BUTTON_WORDS.createLink}
              </button>
              <Outcome state={state} pending={pending} />
            </>
          )}
        </ActionForm>
      )}
      {canWrite && status === "draft" && !isApprover && <span className="lx-note">{askToCreateLink(approvers)}.</span>}

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
              <span className="lx-note" role="note">
                {LINK_NOT_LIVE_YET}
              </span>
              <button type="submit" className="lx-btn lx-btn-pri" disabled={pending}>
                {pending ? BUTTON_WORDS.turningOnLink : BUTTON_WORDS.turnOnLink}
              </button>
              <Outcome state={state} pending={pending} />
            </>
          )}
        </ActionForm>
      )}

      {clientUrl && (status === "sent" || status === "accepted") && <CopyLink url={clientUrl} />}

      {canWrite && status === "approved" && (
        <ActionForm action={unapproveAction} className="pe-act">
          {({ state, pending }) => (
            <>
              {hidden}
              <button type="submit" className="lx-btn lx-btn-sec" disabled={pending}>
                {BUTTON_WORDS.editAgain}
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
                {pending ? "Creating…" : BUTTON_WORDS.startNewVersion}
              </button>
              <Outcome state={state} pending={pending} />
            </>
          )}
        </ActionForm>
      )}

      {clientUrl && (status === "sent" || status === "accepted") && (
        <>
          {canWrite && <PostConsultEmail proposalId={proposalId} />}
          <span className="lx-note" role="note">
            {NOT_EMAILED}
          </span>
        </>
      )}

      {canWrite && (status === "draft" || status === "approved" || status === "sent") && (
        <MoreMenu proposalId={proposalId} status={status} />
      )}
    </div>
  );
}

/** Copies the client link, or opens it. Shows it too, so it can be selected by hand if the clipboard is blocked. */
function CopyLink({ url }: { url: string }) {
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
      <a className="lx-btn lx-btn-sec" href={url} target="_blank" rel="noopener noreferrer">
        Open
      </a>
      <input className="lx-input pe-link-url" readOnly value={url} aria-label="Client link" onFocus={(e) => e.currentTarget.select()} />
      <span className="lx-note" role="status">
        {copied === "no" ? "Couldn’t copy. Select the link and copy it." : ""}
      </span>
    </div>
  );
}

/**
 * "More": the rare, destructive action. Withdraw asks first, in the page, with an explicit Cancel;
 * the menu itself closes on Esc or a click outside (the shared Popover).
 */
function MoreMenu({ proposalId, status }: { proposalId: string; status: ProposalStatus }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="pe-more-menu">
      <Popover
        label="More actions"
        align="right"
        width={190}
        trigger={({ onClick, ref, ...aria }) => (
          <button {...aria} ref={ref} type="button" onClick={onClick} className="lx-btn lx-btn-sec">
            More
            <span aria-hidden> ▾</span>
          </button>
        )}
      >
        {(close) => (
          <button
            type="button"
            role="menuitem"
            className="lp-pop-item"
            onClick={() => {
              setConfirming(true);
              close();
            }}
          >
            <span className="lp-pop-text">{BUTTON_WORDS.withdraw}…</span>
          </button>
        )}
      </Popover>
      {confirming && (
        <ActionForm action={withdrawAction} className="pe-act pe-confirm">
          {({ state, pending }) => (
            <>
              <input type="hidden" name="proposalId" value={proposalId} />
              <p className="lx-note" role="alert" style={{ margin: 0 }}>
                {status === "sent" ? "Withdraw this version? The client’s link will stop opening it." : "Withdraw this version? It can’t be brought back."}
              </p>
              <button type="submit" className="lx-btn lx-btn-danger" disabled={pending}>
                {pending ? "Withdrawing…" : "Yes, withdraw"}
              </button>
              <button type="button" className="lx-btn lx-btn-sec" onClick={() => setConfirming(false)} disabled={pending}>
                Cancel
              </button>
              <Outcome state={state} pending={pending} />
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}
