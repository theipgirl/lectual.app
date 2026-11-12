"use client";

import { useState } from "react";
import { downloadSignedLetterStaffAction } from "@/app/dashboard/proposals/[id]/signed-letter-actions";
import { retryUploadAction } from "@/app/dashboard/proposals/[id]/paid-actions";
import { saveBase64Pdf } from "@/components/client-proposal/download-pdf";
import type { SignedCardView } from "@/lib/loe/signed-card";
import { SIGNED_CARD_HEADING, SIGNED_DOWNLOAD, SIGNED_DOWNLOADING, SIGNED_FILING_HEADING, SIGNED_FINGERPRINT_LABEL, SIGNED_FROM_STORED_TEXT, SIGNED_TRY_AGAIN } from "@/lib/ui/words";
import { ActionForm, Outcome } from "./ActionForm";

/**
 * The staff proposal page's "Engagement letter" card for an ACCEPTED version that carries a letter. It draws what `buildSignedCard`
 * decided: the signer, when it was signed in the firm's zone (named), the fingerprint, a Download (a server action that re-checks module and
 * role), and the state of filing the signed PDF in Lawmatics with Try again (the existing retry action). A role that may not read signature
 * records gets one line (who signed and when, from the accepted proposal) and nothing else. A read that failed or came back empty says it
 * couldn't be loaded. No card at all when the version has no letter (the page doesn't mount it).
 */
export function EngagementLetterCard({ proposalId, view }: { proposalId: string; view: SignedCardView }) {
  return (
    <section className="lx-card pe-signed" aria-label={SIGNED_CARD_HEADING} data-signed-card={view.kind}>
      <header className="pe-card-head">
        <h2 className="pe-h">{SIGNED_CARD_HEADING}</h2>
      </header>
      {view.kind === "signed" ? <SignedBody proposalId={proposalId} view={view} /> : (
        <p className="lx-note" role="status">
          {view.text}
        </p>
      )}
    </section>
  );
}

function SignedBody({ proposalId, view }: { proposalId: string; view: Extract<SignedCardView, { kind: "signed" }> }) {
  return (
    <>
      <dl className="pe-signed-dl">
        <dt>Signed by</dt>
        <dd>{view.signer}</dd>
        {view.onBehalfOf ? (
          <>
            <dt>On behalf of</dt>
            <dd>{view.onBehalfOf}</dd>
          </>
        ) : null}
        {view.title ? (
          <>
            <dt>Title</dt>
            <dd>{view.title}</dd>
          </>
        ) : null}
        <dt>When</dt>
        <dd>{view.signedLine}</dd>
        <dt>{SIGNED_FINGERPRINT_LABEL}</dt>
        <dd className="pe-signed-print">{view.fingerprint}</dd>
      </dl>
      {view.canDownload ? <DownloadButton proposalId={proposalId} fromStoredText={view.fromStoredText} /> : null}
      <div className="pe-signed-filing" data-filing={view.filing.state}>
        <span className="lx-label">{SIGNED_FILING_HEADING}</span>
        <span className="pe-signed-actions">
          <span className={`lx-pill lx-pill-${view.filing.tone}`}>{filingPill(view.filing.state)}</span>
          <span className="pe-step-text">{view.filing.text}</span>
        </span>
        {view.filing.retry ? (
          <ActionForm action={retryUploadAction} className="pe-signed-actions">
            {({ state, pending }) => (
              <>
                <input type="hidden" name="proposalId" value={proposalId} />
                <input type="hidden" name="step" value="signed_loe_upload" />
                <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
                  {pending ? "Trying…" : SIGNED_TRY_AGAIN}
                </button>
                <Outcome state={state} pending={pending} />
              </>
            )}
          </ActionForm>
        ) : null}
      </div>
    </>
  );
}

function filingPill(state: Extract<SignedCardView, { kind: "signed" }>["filing"]["state"]): string {
  switch (state) {
    case "done":
      return "Filed";
    case "failed":
      return "Not filed";
    case "blocked":
      return "Needs a look";
    case "skipped":
      return "Skipped";
    case "unreadable":
      return "Unknown";
    default:
      return "Not yet";
  }
}

function DownloadButton({ proposalId, fromStoredText }: { proposalId: string; fromStoredText: boolean }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Known from the page (the snapshot no longer rebuilds to the signed text), or reported by the download itself.
  const [stored, setStored] = useState(fromStoredText);
  async function run() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await downloadSignedLetterStaffAction(proposalId);
      if (!result.ok) setMessage(result.message);
      else {
        if (result.fromStoredText) setStored(true);
        if (!saveBase64Pdf(result.base64, result.filename)) setMessage("Couldn't save the file. Try again.");
      }
    } catch {
      setMessage("Couldn't build the signed letter. Try again shortly.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="pe-signed-actions">
      <button type="button" className="lx-btn lx-btn-pri lx-btn-sm" onClick={run} disabled={busy}>
        {busy ? SIGNED_DOWNLOADING : SIGNED_DOWNLOAD}
      </button>
      {message ? (
        <span className="lx-note" role="alert">
          {message}
        </span>
      ) : null}
      {stored ? (
        <span className="lx-note" role="status" data-stored-text>
          {SIGNED_FROM_STORED_TEXT}
        </span>
      ) : null}
    </div>
  );
}
