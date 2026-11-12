"use client";

import { useState } from "react";
import { LETTER_HEADING, PDF_MESSAGES, READ_AGAIN_LABEL, SIGNED_VIEW_UNAVAILABLE } from "@/lib/loe/client-words";
import type { LetterPdfResult } from "@/lib/loe/pdf-result";
import { LoeLetterPanel, type LetterView } from "./LoeLetterPanel";
import { saveBase64Pdf } from "./download-pdf";

/**
 * After signing: the letter exactly as signed ("Read it again", from the stored snapshot, not rebuilt from the firm's current
 * settings). The signed line, the signed PDF and the pay button live in the totals panel (`LoeSideAction`).
 *
 * `agreement` is only ever a letter that was VERIFIED against the stored fingerprint (the server's `verifySignedCopy`, or on
 * the just-signed page the page's own hash check). When it couldn't be, it is null and the fixed sentence is shown: never
 * unverified text under a "signed" label.
 */
export function LoeSignedLetter({ agreement, title }: { agreement: LetterView | null; title: string }) {
  return (
    <section className="cp-signed-letter" aria-labelledby="cp-again-h">
      <details>
        <summary id="cp-again-h">{READ_AGAIN_LABEL}</summary>
        {agreement ? (
          <LoeLetterPanel agreement={agreement} title={title || LETTER_HEADING} id="cp-letter-signed" />
        ) : (
          <p className="cp-warn" role="status" data-signed-unavailable>
            {SIGNED_VIEW_UNAVAILABLE}
          </p>
        )}
      </details>
    </section>
  );
}

/** A button that asks the server for a PDF and saves it through a Blob link. A refusal is a fixed sentence under the button. */
export function DownloadPdfButton({ label, onDownload, disabled }: { label: string; onDownload?: () => Promise<LetterPdfResult>; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!onDownload) return null;
  return (
    <div className="cp-dl">
      <button
        type="button"
        className="cp-btn cp-btn-ghost"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await onDownload();
            if (!r.ok) setError(r.message);
            else if (!saveBase64Pdf(r.base64, r.filename)) setError(PDF_MESSAGES.unavailable);
          } catch {
            setError(PDF_MESSAGES.unavailable);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Preparing…" : label}
      </button>
      {error ? (
        <p className="cp-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
