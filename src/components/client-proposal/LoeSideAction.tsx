import type { ReactNode } from "react";
import {
  BACK_LABEL,
  CONTINUE_LABEL,
  DOWNLOAD_SIGNED_LABEL,
  PAYNOTE_AFTER_SIGNING,
  PAYNOTE_BEFORE_SIGNING,
  PAYNOTE_DOWNLOAD_ABOVE,
  PAY_LABEL,
  READ_LETTER_FIRST,
  SIGN_LABEL,
  SIGN_MESSAGES,
  SIGN_REQUIRED_NOTE,
} from "@/lib/loe/client-words";
import type { LetterPdfResult } from "@/lib/loe/pdf-result";
import { DownloadPdfButton } from "./LoeReceipt";

/**
 * The part of the totals panel that changes with the step (the totals above it never do): the button, the notes and the
 * receipt. Step 1: Continue. Step 2: Continue (until the details are given) and Back. Step 3: Sign and continue to payment
 * (until the name is typed and the box ticked) and Back. After signing: the signed line, the signed PDF and Pay my legal fee.
 *
 * No commitment sentence is drawn here: on a proposal that carries a letter, the letter and the "I have read and agree" tick
 * are the commitment (see `client-words.ts`). The signed download is offered the moment the page is in its accepted state,
 * whether it was loaded that way or the client has just signed, and the note only mentions it when the button is drawn.
 */

export type LoeSideActionProps = {
  mode: "live" | "preview" | "accepted";
  step: 1 | 2 | 3;
  accepted: boolean;
  firstName: string;
  signedLine: string | null;
  payUrl: string | null;
  opened: boolean;
  canContinue: boolean;
  detailsOk: boolean;
  signable: boolean;
  pending: boolean;
  error: string | null;
  describedBy?: string;
  /** Rendered between the button and the notes (the "describe each class" warning). */
  warning?: ReactNode;
  legalTotalText: string;
  onContinue: () => void;
  onBack: () => void;
  onSign: () => void;
  onReadLetter: () => void;
  onDownloadSigned?: () => Promise<LetterPdfResult>;
};

export function LoeSideAction(p: LoeSideActionProps) {
  if (p.accepted) {
    return (
      <>
        <div className="cp-done" role="status">
          <h3>Thank you{p.firstName ? `, ${p.firstName}` : ""}.</h3>
          {p.signedLine ? <p className="cp-signed-line">{p.signedLine}</p> : null}
          <p>
            Your acceptance is recorded.
            {p.payUrl
              ? p.opened
                ? " Your payment page opened in a new tab. If it didn’t, use the button below."
                : " Use the button below to pay your legal fee."
              : " We will send your payment link by email."}
          </p>
        </div>
        <DownloadPdfButton label={DOWNLOAD_SIGNED_LABEL} onDownload={p.onDownloadSigned} />
        {p.payUrl ? (
          <a className="cp-btn" href={p.payUrl} target="_blank" rel="noopener noreferrer">
            {PAY_LABEL}
          </a>
        ) : null}
        <p className="cp-paynote">
          {PAYNOTE_AFTER_SIGNING}
          {p.onDownloadSigned ? ` ${PAYNOTE_DOWNLOAD_ABOVE}` : ""}
        </p>
      </>
    );
  }

  const preview = p.mode === "preview";
  return (
    <>
      {p.step === 1 ? (
        <button type="button" className="cp-btn" onClick={p.onContinue} disabled={!p.canContinue} aria-describedby={p.describedBy}>
          {CONTINUE_LABEL}
        </button>
      ) : null}
      {p.step === 2 ? (
        <>
          <button type="button" className="cp-btn" onClick={p.onContinue} disabled={!p.detailsOk}>
            {CONTINUE_LABEL}
          </button>
          {p.detailsOk ? null : (
            <p className="cp-warn" role="status">
              {SIGN_MESSAGES.details_required}
            </p>
          )}
          <button type="button" className="cp-btn cp-btn-ghost" onClick={p.onBack}>
            {BACK_LABEL}
          </button>
        </>
      ) : null}
      {p.step === 3 ? (
        <>
          {preview ? (
            <button type="button" className="cp-btn" disabled>
              Preview
            </button>
          ) : (
            <button
              type="button"
              className="cp-btn"
              onClick={p.onSign}
              disabled={!p.signable || p.pending}
              aria-describedby={p.signable ? undefined : "cp-sign-need"}
            >
              {p.pending ? "Recording…" : SIGN_LABEL}
            </button>
          )}
          {preview || p.signable ? null : (
            <p className="cp-warn" id="cp-sign-need" role="status">
              {SIGN_REQUIRED_NOTE}
            </p>
          )}
          <button type="button" className="cp-btn cp-btn-ghost" onClick={p.onBack} disabled={p.pending}>
            {BACK_LABEL}
          </button>
        </>
      ) : null}
      {p.warning}
      {p.error ? (
        <p className="cp-error" role="alert">
          {p.error}
        </p>
      ) : null}
      {p.step === 1 ? (
        <p className="cp-paynote">
          <button type="button" className="cp-linkbtn" onClick={p.onReadLetter}>
            {READ_LETTER_FIRST}
          </button>
        </p>
      ) : null}
      <p className="cp-paynote">
        You&rsquo;ll pay <b className="cp-num">{p.legalTotalText}</b>{" "}
        through our secure client portal. {PAYNOTE_BEFORE_SIGNING}
      </p>
    </>
  );
}
