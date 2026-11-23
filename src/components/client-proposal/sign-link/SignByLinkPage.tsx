"use client";

import { useEffect, useRef, useState } from "react";
import { NOT_A_LAW_FIRM_DISCLAIMER } from "@/lib/legal/disclaimer";
import {
  BACK_TO_PROPOSAL_LABEL,
  CONSENT_STEP_NAME,
  DOWNLOAD_SIGNED_LABEL,
  LINK_UNAVAILABLE,
  PAY_LABEL,
  SIGNATURE_NAME_LABEL,
  SIGNATURE_NEEDED,
  SIGNATURE_STEP_NAME,
  SIGNATURE_TOO_LARGE,
  SIGNED_STEP_WORD,
  SIGN_LABEL,
} from "@/lib/loe/client-words";
import type { SignLinkFirm, SignLinkView } from "@/lib/loe/email-signing/link-read";
import type { LetterPdfResult } from "@/lib/loe/pdf-result";
import { MAX_CLIENT_TEXT_CHARS } from "@/lib/proposals/client-classes";
import { brandForSlug } from "../format";
import { RPB_FONT_VARS } from "../fonts";
import { DownloadPdfButton } from "../LoeReceipt";
import { SignatureBox, type SignatureValue } from "./SignatureBox";
import "../proposal.css";

/**
 * The `?sign=` page (Sprint A items 11-16): the letter read-only FIRST, then the consent click (the attorney's consent line and
 * text, nothing to fill in before it), then the signature box and the typed full legal name, then Sign (one act: signs and
 * accepts), then the done screen with Pay. No "are you sure?" dialog: each step says what comes next. Every refusal is a fixed
 * sentence from the server.
 *
 * The GET that drew this page wrote nothing; "opened" is posted once from here, after mount (`onOpened`), and is silent.
 */

export type SignLinkPageProps =
  | { state: "unavailable"; backHref: string }
  | {
      state: "open";
      backHref: string;
      firm: SignLinkFirm;
      view: SignLinkView;
      onOpened: () => Promise<void>;
      onConsent: (consentSha256: string) => Promise<{ ok: true } | { ok: false; message: string }>;
      onSign: (typedName: string, signature: NonNullable<SignatureValue>) => Promise<{ ok: true; signedLine: string; payUrl: string | null } | { ok: false; message: string; needConsent?: true }>;
      onDownloadSigned?: () => Promise<LetterPdfResult>;
    }
  | { state: "signed"; backHref: string; firm: SignLinkFirm; signedLine: string; payUrl: string | null; onDownloadSigned?: () => Promise<LetterPdfResult> };

function Shell({ slug, name, children }: { slug: string; name: string; children: React.ReactNode }) {
  const brand = brandForSlug(slug);
  return (
    <div className={["cp-root", "cp-sl-root", brand === "rpb" ? RPB_FONT_VARS : ""].filter(Boolean).join(" ")} data-brand={brand}>
      <header className="cp-band cp-gut">
        <div className="cp-wrap cp-band-in">
          <span className="cp-firm">{name}</span>
        </div>
      </header>
      <main className="cp-main cp-gut">
        <div className="cp-wrap cp-sl-wrap">{children}</div>
      </main>
      <footer className="cp-footer cp-gut">
        <div className="cp-wrap">
          <p className="cp-d">{NOT_A_LAW_FIRM_DISCLAIMER}</p>
        </div>
      </footer>
    </div>
  );
}

function Done({ signedLine, payUrl, onDownloadSigned }: { signedLine: string; payUrl: string | null; onDownloadSigned?: () => Promise<LetterPdfResult> }) {
  return (
    <section className="cp-sl-done" aria-labelledby="cp-sl-done-h">
      <div className="cp-done" role="status">
        <h2 id="cp-sl-done-h">{SIGNED_STEP_WORD}</h2>
        {signedLine ? <p className="cp-signed-line">{signedLine}</p> : null}
      </div>
      <DownloadPdfButton label={DOWNLOAD_SIGNED_LABEL} onDownload={onDownloadSigned} />
      {payUrl ? (
        <a className="cp-btn" href={payUrl} target="_blank" rel="noopener noreferrer">
          {PAY_LABEL}
        </a>
      ) : null}
    </section>
  );
}

export function SignByLinkPage(props: SignLinkPageProps) {
  if (props.state === "unavailable") {
    return (
      <Shell slug="" name="">
        <section className="cp-sl-gone">
          <h1>{LINK_UNAVAILABLE}</h1>
          <p>
            <a className="cp-linkbtn" href={props.backHref}>
              {BACK_TO_PROPOSAL_LABEL}
            </a>
          </p>
        </section>
      </Shell>
    );
  }
  if (props.state === "signed") {
    return (
      <Shell slug={props.firm.slug} name={props.firm.displayName}>
        <Done signedLine={props.signedLine} payUrl={props.payUrl} onDownloadSigned={props.onDownloadSigned} />
      </Shell>
    );
  }
  return <OpenLink {...props} />;
}

function OpenLink(props: Extract<SignLinkPageProps, { state: "open" }>) {
  const { view, firm } = props;
  const [consented, setConsented] = useState(view.consented);
  const [name, setName] = useState("");
  const [signature, setSignature] = useState<SignatureValue>(null);
  const [tooLarge, setTooLarge] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ signedLine: string; payUrl: string | null } | null>(null);
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void props.onOpened().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount.
  }, []);

  if (done) {
    return (
      <Shell slug={firm.slug} name={firm.displayName}>
        <Done signedLine={done.signedLine} payUrl={done.payUrl} onDownloadSigned={props.onDownloadSigned} />
      </Shell>
    );
  }

  async function consent() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const r = await props.onConsent(view.consentSha256);
      if (r.ok) setConsented(true);
      else setError(r.message);
    } catch {
      setError(LINK_UNAVAILABLE);
    } finally {
      setPending(false);
    }
  }

  async function sign() {
    if (pending || !signature || name.trim().length < 2) return;
    setPending(true);
    setError(null);
    try {
      const r = await props.onSign(name, signature);
      if (r.ok) setDone({ signedLine: r.signedLine, payUrl: r.payUrl });
      else {
        if (r.needConsent) setConsented(false);
        setError(r.message);
      }
    } catch {
      setError(LINK_UNAVAILABLE);
    } finally {
      setPending(false);
    }
  }

  const canSign = !!signature && name.trim().length >= 2 && !tooLarge;

  return (
    <Shell slug={firm.slug} name={firm.displayName}>
      <section className="cp-letter cp-sl-letter" aria-label={view.title} tabIndex={0}>
        <h1 className="cp-letter-title">{view.title}</h1>
        {view.paragraphs.map((p, i) => (
          <p key={i} className="cp-letter-p">
            {p}
          </p>
        ))}
      </section>

      {!consented ? (
        <section className="cp-sign cp-sl-consent" aria-labelledby="cp-sl-consent-h">
          <h2 id="cp-sl-consent-h">{CONSENT_STEP_NAME}</h2>
          <details open>
            <summary>{view.consentLine}</summary>
            <p className="cp-sl-consent-text">{view.consentText}</p>
          </details>
          <button type="button" className="cp-btn" onClick={consent} disabled={pending}>
            {view.consentLine}
          </button>
        </section>
      ) : (
        <section className="cp-sign cp-sl-sign" aria-labelledby="cp-sl-sign-h">
          <h2 id="cp-sl-sign-h">{SIGNATURE_STEP_NAME}</h2>
          <label className="cp-field cp-field-wide">
            <span>
              {SIGNATURE_NAME_LABEL}
              <b aria-hidden="true"> *</b>
            </span>
            <input
              type="text"
              name="typed_name"
              value={name}
              maxLength={MAX_CLIENT_TEXT_CHARS}
              autoComplete="name"
              required
              aria-required={true}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <SignatureBox
            typedName={name}
            boxNote={view.boxNote}
            disabled={pending}
            onChange={(value, large) => {
              setSignature(value);
              setTooLarge(large);
            }}
          />
          {tooLarge ? (
            <p className="cp-warn" role="status">
              {SIGNATURE_TOO_LARGE}
            </p>
          ) : !signature ? (
            <p className="cp-sl-need" id="cp-sl-need">
              {SIGNATURE_NEEDED}
            </p>
          ) : null}
          <div className="cp-sl-signrow">
            <button type="button" className="cp-btn" onClick={sign} disabled={!canSign || pending} aria-describedby="cp-sl-signline">
              {pending ? "Recording…" : SIGN_LABEL}
            </button>
            <p className="cp-sl-signline" id="cp-sl-signline">
              {view.signLine}
            </p>
          </div>
        </section>
      )}
      {error ? (
        <p className="cp-error" role="alert">
          {error}
        </p>
      ) : null}
    </Shell>
  );
}
