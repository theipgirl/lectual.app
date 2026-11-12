"use client";

import { useMemo, useState, type ReactNode } from "react";
import { NOT_A_LAW_FIRM_DISCLAIMER } from "@/lib/legal/disclaimer";
import { generalValueOverFee, quoteProposal } from "@/lib/proposals/pricing";
import { generalCommitmentSentence } from "@/lib/proposals/commitment";
import type { ProposalQuote } from "@/lib/proposals/types";
import type { ProposalDocumentProps } from "./ProposalDocument";
import { RPB_FONT_VARS } from "./fonts";
import { ATTORNEY_FOOTER_LETTER_LINE, DOWNLOAD_REVIEW_LABEL, LETTER_HEADING, LETTER_INTRO, READ_LETTER_FIRST, SIGN_MESSAGES } from "@/lib/loe/client-words";
import type { SigningInput } from "@/lib/loe/signing";
import { LoeDetailsForm } from "./LoeDetailsForm";
import { LoeLetterPanel } from "./LoeLetterPanel";
import { DownloadPdfButton, LoeSignedLetter } from "./LoeReceipt";
import { LoeSideAction } from "./LoeSideAction";
import { LoeSignPanel } from "./LoeSignPanel";
import { LoeStepBar } from "./LoeStepBar";
import { useLoeFlow } from "./loe-flow";
import { brandForSlug, formatCivilDate, money, paragraphs, richSegments, safeHttpsUrl, type ProposalBrand } from "./format";
import "./proposal.css";

/**
 * Spec 9: the client's page for a general (flat-fee) proposal: a contract or other matter. The firm's header, the
 * greeting, the matter, its summary, "What we'll do" (hours when the firm gave them), "Not included", the terms note,
 * the value of the work beside the fee, and Accept. Nothing to tick: Accept sends an empty selection and the server
 * prices the stored content again. No USPTO fee, no classes, no package table.
 *
 * Every figure comes from `quoteProposal` (the function the server runs at acceptance); this file formats only.
 * All firm text is rendered as React text. Same modes, footer and assets as the trademark page.
 */
export function GeneralProposalDocument(props: ProposalDocumentProps) {
  const { content, title, clientName, expiresOn, firm, mode, acceptedQuote, payUrl, onAccept, letter, onDownloadReview, onDownloadSigned } = props;
  const brand: ProposalBrand = brandForSlug(firm.slug);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ payUrl: string | null; opened: boolean; signedLine?: string | null; letterDate?: string | null; letterVerified?: boolean } | null>(() =>
    props.initialDone
      ? {
          payUrl: props.initialDone.payUrl,
          opened: props.initialDone.opened ?? false,
          signedLine: props.initialDone.signedLine ?? null,
          letterDate: props.initialDone.letterDate ?? null,
          letterVerified: props.initialDone.letterVerified === true,
        }
      : null,
  );
  const [previewOpen, setPreviewOpen] = useState(false);

  const accepted = mode === "accepted" || done !== null;
  const quote = useMemo<ProposalQuote>(
    () => (mode === "accepted" && acceptedQuote ? acceptedQuote : quoteProposal(content, {})),
    [mode, acceptedQuote, content],
  );
  const g = content.general;
  const items = quote.general?.items ?? [];
  const valueOverFee = generalValueOverFee(quote);
  const excludes = (g?.excludes ?? []).filter((l) => typeof l === "string" && l.trim());
  const firstName = content.client?.first_name?.trim() || "";
  const who = clientName?.trim() || content.client?.full_name || "";
  const company = content.client?.company?.trim();
  const expires = formatCivilDate(expiresOn);
  const finalPayUrl = safeHttpsUrl(done ? done.payUrl : payUrl);
  const heading = title?.trim() && title.trim() !== "Proposal" ? title.trim() : "Your Proposal";
  const canAccept = quote.legal_total_cents > 0 || (quote.general?.fee_cents ?? 0) > 0;
  // Engagement letter (flat-fee kind): the same steps as the trademark page; without `loe` none of it runs.
  const loeBlock = typeof content.loe?.body === "string" && content.loe.body.length > 0 ? { title: content.loe.title || LETTER_HEADING, body: content.loe.body } : null;
  const loeFlow = useLoeFlow({
    loe: loeBlock,
    clientName: clientName ?? "",
    company: content.client?.company ?? "",
    letter: letter ?? null,
    shown: content,
    quote,
    initialStep: props.initialLoe?.step,
    initialDetails: props.initialLoe?.details,
    initialTypedName: props.initialLoe?.typedName,
    initialAgree: props.initialLoe?.agree,
    // Once signed, the letter on the page carries the date the server stamped, not the date the page was opened with.
    signedDateText: done?.letterDate ?? null,
  });
  const loeOn = loeFlow.enabled;
  const stepOne = !loeOn || accepted || loeFlow.step === 1;
  // The letter shown as SIGNED: the server's verified copy on a receipt; on the just-signed page the page's own letter, and only
  // when its text hashed to the sha256 the server stored (`letterVerified`). Otherwise nothing is shown under that label.
  const signedView = letter?.signed ?? (done?.letterVerified ? loeFlow.agreement : null);

  async function accept() {
    if (mode !== "live" || !onAccept || pending || done || !canAccept) return;
    if (loeOn && !loeFlow.signable) return;
    setError(null);
    setPending(true);
    // Opened inside the click so the popup blocker allows it; pointed at the payment page once the server has recorded the acceptance.
    let tab: Window | null = null;
    try {
      tab = window.open("about:blank", "_blank");
      if (tab) tab.document.body.textContent = "Opening your secure payment page…";
    } catch {
      tab = null;
    }
    try {
      // The fingerprint is hashed now (async), after the tab is open, over what is on screen (the date aside: the server stamps its own).
      const signing: SigningInput | null = loeOn ? await loeFlow.signingPayload() : null;
      if (loeOn && !signing) {
        tab?.close();
        setError(SIGN_MESSAGES.generic);
        return;
      }
      // Nothing to tick on a flat-fee proposal: an empty selection and nothing written by the client.
      const result = signing ? await onAccept({}, { entries: {}, added: {} }, signing) : await onAccept({}, { entries: {}, added: {} });
      if (!result.ok) {
        tab?.close();
        setError(result.message);
        return;
      }
      const url = safeHttpsUrl(result.payUrl);
      let opened = false;
      if (url && tab && !tab.closed) {
        try {
          tab.opener = null;
          tab.location.href = url;
          opened = true;
        } catch {
          opened = false;
        }
      }
      if (!opened) tab?.close();
      // Before anything is shown as "signed": does this page's letter, with the server's date, hash to what the server stored?
      const letterVerified = loeOn ? await loeFlow.signedTextVerified(result.letterDate, result.textSha256) : false;
      setDone({ payUrl: url, opened, signedLine: result.signedLine ?? null, letterDate: result.letterDate ?? null, letterVerified });
    } catch {
      tab?.close();
      setError("We couldn’t record your acceptance. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const rootClass = ["cp-root", brand === "rpb" ? RPB_FONT_VARS : ""].filter(Boolean).join(" ");
  const gutter = "cp-gut";

  return (
    <div className={rootClass} data-brand={brand} data-mode={mode} data-kind="general">
      <header className={`cp-band ${gutter}`}>
        <div className="cp-wrap cp-band-in">
          {brand === "rpb" ? (
            // eslint-disable-next-line @next/next/no-img-element -- a 30px brand strip; the optimizer buys nothing.
            <img className="cp-logo" src="/brand/rpb-logo-cream.png" alt="RPB Law Firm, Est 2024" width={984} height={168} />
          ) : (
            <span className="cp-firm">{firm.name}</span>
          )}
          <span className="cp-who">{who ? `Prepared for ${who}${company ? ` · ${company}` : ""}` : null}</span>
        </div>
      </header>

      <main className={`cp-main ${gutter}`}>
        {loeOn ? (
          <div className="cp-wrap cp-steps-wrap">
            <LoeStepBar current={accepted ? 4 : loeFlow.step} onGo={(n) => loeFlow.setStep(n)} locked={accepted || pending} />
          </div>
        ) : null}
        <div className="cp-wrap cp-layout">
          <div className="cp-left">
            {loeOn && !accepted && loeFlow.step === 2 ? <LoeDetailsForm details={loeFlow.details} onChange={loeFlow.setDetail} /> : null}
            {loeOn && !accepted && loeFlow.step === 3 ? (
              <section className="cp-choose cp-letter-step" aria-labelledby="cp-letter-h">
                <div className="cp-step-h">
                  <span className="cp-n" aria-hidden="true">
                    3
                  </span>
                  <div>
                    <h2 id="cp-letter-h">{LETTER_HEADING}</h2>
                    <p>{LETTER_INTRO}</p>
                  </div>
                </div>
                {loeFlow.agreement ? (
                  <LoeLetterPanel agreement={loeFlow.agreement} title={loeBlock?.title ?? LETTER_HEADING} id="cp-letter" />
                ) : (
                  <p className="cp-warn" role="status">
                    {SIGN_MESSAGES.letter_unavailable}
                  </p>
                )}
                <DownloadPdfButton
                  label={DOWNLOAD_REVIEW_LABEL}
                  onDownload={onDownloadReview ? () => onDownloadReview({}, { entries: {}, added: {} }, loeFlow.cleaned) : undefined}
                />
                <LoeSignPanel typedName={loeFlow.typedName} onName={loeFlow.setTypedName} agree={loeFlow.agree} onAgree={loeFlow.setAgree} />
              </section>
            ) : null}
            {stepOne ? (
            <>
            <section className="cp-intro">
              {expires ? <p className="cp-date">Available through {expires}</p> : null}
              <h1>{heading}</h1>
              {paragraphs(content.greeting).map((p, i) => (
                <p key={i} className="cp-hi">
                  <Rich text={p} />
                </p>
              ))}
            </section>

            <section className="cp-choose" aria-labelledby="cp-matter">
              <div className="cp-step-h">
                <span className="cp-n" aria-hidden="true">
                  1
                </span>
                <div>
                  <h2 id="cp-matter">{g?.matter_title || "Your matter"}</h2>
                </div>
              </div>
              {g?.summary?.trim()
                ? paragraphs(g.summary).map((p, i) => (
                    <p key={i} className="cp-hi">
                      {p}
                    </p>
                  ))
                : null}

              <div className="cp-card">
                <h3>What we&rsquo;ll do</h3>
                <ul className="cp-work">
                  {items.map((it, i) => (
                    <li key={i}>
                      <span>{it.label}</span>
                      {typeof it.hours === "number" ? <small className="cp-num"> {hoursText(it.hours)}</small> : null}
                    </li>
                  ))}
                </ul>
              </div>

              {excludes.length > 0 ? (
                <div className="cp-card">
                  <h3>Not included</h3>
                  <ul className="cp-work">
                    {excludes.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {g?.terms_note?.trim() ? <p className="cp-hi">{g.terms_note}</p> : null}
            </section>
            {loeOn && !accepted ? (
              <section className="cp-letter-preview" aria-label={READ_LETTER_FIRST}>
                <details
                  id="cp-letter-preview"
                  open={previewOpen}
                  onToggle={(e) => setPreviewOpen((e.currentTarget as HTMLDetailsElement).open)}
                >
                  <summary>{READ_LETTER_FIRST}</summary>
                  <p className="cp-note">You will fill in your details on the next step. Until then, brackets mark what is still to come.</p>
                  {loeFlow.preview ? <LoeLetterPanel agreement={loeFlow.preview} title={loeBlock?.title ?? LETTER_HEADING} id="cp-letter-first" /> : null}
                </details>
              </section>
            ) : null}
            </>
            ) : null}
            {loeOn && accepted ? <LoeSignedLetter agreement={signedView} title={loeBlock?.title ?? LETTER_HEADING} /> : null}
          </div>

          <aside className="cp-side" id="cp-review" aria-labelledby="cp-s2">
            <div className="cp-panel">
              <div className="cp-panel-h">
                {/* The "2" belongs to the two-part page. A proposal with a letter has its own four numbered steps above, so the panel has no number. */}
                {loeOn ? null : (
                  <span className="cp-n" aria-hidden="true">
                    2
                  </span>
                )}
                <h2 id="cp-s2">{accepted ? "Your acceptance" : "Review and accept"}</h2>
              </div>
              <div className="cp-panel-b" aria-live="polite">
                <div className="cp-lines">
                  {valueOverFee ? (
                    <div className="cp-grp">
                      <div className="cp-ln">
                        <span className="cp-l">Value</span>
                        <span className="cp-r cp-num">{money(valueOverFee.value_cents)}</span>
                      </div>
                      <div className="cp-ln">
                        <span className="cp-l">Your fee</span>
                        <span className="cp-r cp-num">{money(valueOverFee.fee_cents)}</span>
                      </div>
                    </div>
                  ) : null}
                  {quote.adjustments.some((a) => a.discount_cents > 0) ? (
                    <div className="cp-grp">
                      <h3>Credits</h3>
                      {quote.adjustments
                        .filter((a) => a.discount_cents > 0)
                        .map((a) => (
                          <div className="cp-ln" key={a.id}>
                            <span className="cp-l">
                              {a.label}
                              {a.kind === "percent" ? <small>{a.value}% off</small> : null}
                            </span>
                            <span className="cp-r cp-num">{money(-a.discount_cents)}</span>
                          </div>
                        ))}
                    </div>
                  ) : null}
                </div>

                <div className="cp-tot">
                  <div className="cp-row">
                    <div className="cp-l">
                      <b>Flat fee due now</b>
                      <span>Due now to begin</span>
                    </div>
                    <div className="cp-big cp-num">{money(quote.legal_total_cents)}</div>
                  </div>
                </div>

                {loeOn ? (
                  <LoeSideAction
                    mode={mode}
                    step={loeFlow.step}
                    accepted={accepted}
                    firstName={firstName}
                    signedLine={done?.signedLine ?? props.signedLine ?? letter?.signed?.signedLine ?? null}
                    payUrl={finalPayUrl}
                    opened={done?.opened ?? false}
                    canContinue={canAccept && mode !== "accepted"}
                    detailsOk={loeFlow.detailsOk}
                    signable={loeFlow.signable}
                    pending={pending}
                    error={error}
                    legalTotalText={money(quote.legal_total_cents)}
                    onContinue={() => {
                      loeFlow.setStep(loeFlow.step === 1 ? 2 : 3);
                      requestAnimationFrame(() => document.getElementById("cp-steps")?.scrollIntoView({ block: "start" }));
                    }}
                    onBack={() => loeFlow.setStep(loeFlow.step === 3 ? 2 : 1)}
                    onSign={accept}
                    onReadLetter={() => {
                      setPreviewOpen(true);
                      requestAnimationFrame(() => document.getElementById("cp-letter-preview")?.scrollIntoView({ block: "start" }));
                    }}
                    onDownloadSigned={onDownloadSigned}
                  />
                ) : accepted ? (
                  <>
                    <div className="cp-done" role="status">
                      <h3>Thank you{firstName ? `, ${firstName}` : ""}.</h3>
                      <p>
                        Your acceptance is recorded.
                        {finalPayUrl
                          ? done?.opened
                            ? " Your payment page opened in a new tab. If it didn’t, use the button below."
                            : " Use the button below to pay your fee."
                          : " We will send your payment link by email."}
                      </p>
                    </div>
                    {finalPayUrl ? (
                      <a className="cp-btn" href={finalPayUrl} target="_blank" rel="noopener noreferrer">
                        Pay my fee
                      </a>
                    ) : null}
                    <p className="cp-paynote">
                      Once your payment is received, we&rsquo;ll send your engagement agreement for review and signature.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="cp-commit">{generalCommitmentSentence(firm.displayName ?? firm.name)}</p>
                    {mode === "preview" ? (
                      <button type="button" className="cp-btn" disabled>
                        Preview
                      </button>
                    ) : (
                      <button type="button" className="cp-btn" onClick={accept} disabled={!canAccept || pending || !onAccept}>
                        {pending ? "Recording…" : "Accept and pay my fee"}
                      </button>
                    )}
                    {error ? (
                      <p className="cp-error" role="alert">
                        {error}
                      </p>
                    ) : null}
                    <p className="cp-paynote">
                      You&rsquo;ll pay <b className="cp-num">{money(quote.legal_total_cents)}</b>{" "}
                      through our secure client portal. Once it&rsquo;s received, we&rsquo;ll send your engagement agreement for review and
                      signature.
                    </p>
                  </>
                )}

                {expires ? (
                  <p className="cp-exp">
                    Available through <b>{expires}</b>
                  </p>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      </main>

      {accepted && !loeOn ? null : (
        <div className="cp-bar">
          <div className="cp-bar-in">
            <span>
              Flat fee due now <b className="cp-num">{money(quote.legal_total_cents)}</b>
            </span>
            <a href="#cp-review">{accepted ? "Your receipt" : "Review and accept"}</a>
          </div>
        </div>
      )}

      <footer className={`cp-footer ${gutter}`}>
        <div className="cp-wrap">
          {brand === "rpb" ? (
            <>
              <p className="cp-c">RPB Law, PLLC &middot; (305) 712-6960 &middot; info@rpblawfirm.com &middot; www.rpblawfirm.com</p>
              {/* The firm's own footer line, the same on every proposal. A proposal with a letter shows the attorney's replacement only once one is set (it is not: see client-words.ts). */}
              {loeOn && ATTORNEY_FOOTER_LETTER_LINE ? (
                <p className="cp-d">{ATTORNEY_FOOTER_LETTER_LINE}</p>
              ) : (
                <p className="cp-d">
                  Attorney advertising. Prepared for discussion purposes; does not constitute legal advice or create an
                  attorney-client relationship.
                </p>
              )}
            </>
          ) : (
            <p className="cp-c">{[firm.name, firm.contactLine].filter(Boolean).join(" · ")}</p>
          )}
          <p className="cp-d">
            {NOT_A_LAW_FIRM_DISCLAIMER} Lectual provides the software this proposal is presented in; the proposal itself is
            from the firm that sent it.
          </p>
        </div>
      </footer>
    </div>
  );
}

function hoursText(h: number): string {
  return `${h} ${h === 1 ? "hr" : "hrs"}`;
}

function Rich({ text }: { text: string | undefined }): ReactNode {
  return richSegments(text).map((seg, i) => (seg.bold ? <b key={i}>{seg.text}</b> : seg.text));
}
