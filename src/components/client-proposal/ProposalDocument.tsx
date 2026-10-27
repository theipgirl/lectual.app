"use client";

import { useMemo, useState, type ReactNode } from "react";
import { NOT_A_LAW_FIRM_DISCLAIMER } from "@/lib/legal/disclaimer";
import {
  defaultSelection,
  lockedSelectionIds,
  normalizeSelection,
  quoteHasItems,
  quoteProposal,
} from "@/lib/proposals/pricing";
import {
  MARK_KIND_DEFAULT_DESC,
  MARK_KIND_LABEL,
  type ProposalContent,
  type ProposalQuote,
  type Selection,
} from "@/lib/proposals/types";
import { markDisplayPrices } from "./display";
import { RPB_FONT_VARS } from "./fonts";
import {
  brandForSlug,
  formatCivilDate,
  money,
  paragraphs,
  richSegments,
  safeHttpsUrl,
  type ProposalBrand,
} from "./format";
import "./proposal.css";

/**
 * The client's whole proposal view: one component for the public page
 * (`/p/[token]`) and the dashboard editor's live preview.
 *
 * Every price on screen comes from `quoteProposal` (the function the server
 * runs again at acceptance); this file formats, it does not calculate. All
 * firm and client text is rendered as text, never HTML (`format.ts#richSegments`
 * is the only markup, and it produces React elements, not strings).
 *
 * Modes:
 *  - live:     boxes work, the Accept button calls `onAccept`.
 *  - preview:  boxes work, Accept is disabled and labelled "Preview".
 *  - accepted: a receipt of what was accepted, with the "Pay my legal fee" link.
 *              A live page switches to this view itself once `onAccept` succeeds.
 */

export type ProposalAcceptResult = { ok: true; payUrl: string } | { ok: false; message: string };

export type ProposalDocumentProps = {
  content: ProposalContent;
  title: string;
  clientName: string;
  /** Civil date, "YYYY-MM-DD". */
  expiresOn: string | null;
  firm: { name: string; slug: string };
  mode: "live" | "preview" | "accepted";
  /** Starting ticks (accepted mode: what was accepted). Defaults to the firm's preselected offer. */
  initialSelection?: Selection;
  /** accepted mode: the frozen quote the client agreed to. */
  acceptedQuote?: ProposalQuote;
  /** accepted mode: where the legal fee is paid. Additive to the original prop list. */
  payUrl?: string | null;
  /** live mode: records the acceptance on the server. Receives the ticks only, never a price. */
  onAccept?: (selection: Selection) => Promise<ProposalAcceptResult>;
};

const DEFAULT_TITLE = "Trademark Proposal";

/** Shown on a card whose last mark or class is held on, so a client can't untick to $0. */
export const KEEP_ONE_HINT = "At least one class and one mark must stay selected.";

function Rich({ text }: { text: string | undefined }): ReactNode {
  return richSegments(text).map((seg, i) => (seg.bold ? <b key={i}>{seg.text}</b> : seg.text));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function ProposalDocument(props: ProposalDocumentProps) {
  const { content, title, clientName, expiresOn, firm, mode, initialSelection, acceptedQuote, payUrl, onAccept } = props;
  const brand: ProposalBrand = brandForSlug(firm.slug);

  // Ticks the visitor changed. Layered over the firm's defaults (and any given
  // starting ticks), so editing the content in the preview never loses a tick
  // the viewer made and never keeps a tick for a mark that no longer exists.
  const [overrides, setOverrides] = useState<Selection>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ payUrl: string | null; opened: boolean } | null>(null);

  const accepted = mode === "accepted" || done !== null;
  const readOnly = accepted;

  const selection = useMemo<Selection>(() => {
    const merged: Selection = { ...defaultSelection(content), ...(initialSelection ?? {}) };
    // Kept after a live acceptance (toggle() is off by then): the receipt must
    // show what the client ticked and accepted, not the firm's pre-ticked offer.
    // Only a server-rendered receipt starts from `initialSelection` alone.
    if (mode !== "accepted") Object.assign(merged, overrides);
    return normalizeSelection(content, merged);
  }, [content, initialSelection, overrides, mode]);

  const quote = useMemo<ProposalQuote>(
    () => (mode === "accepted" && acceptedQuote ? acceptedQuote : quoteProposal(content, selection)),
    [mode, acceptedQuote, content, selection],
  );
  const display = useMemo(() => markDisplayPrices(content, selection), [content, selection]);
  // Boxes the client may not untick: doing so would leave nothing to accept.
  const locked = useMemo(
    () => (readOnly ? new Set<string>() : lockedSelectionIds(content, selection)),
    [readOnly, content, selection],
  );

  const canAccept = quoteHasItems(quote);
  const pricing = content.pricing;
  const firstName = content.client?.first_name?.trim() || "";
  const who = clientName?.trim() || content.client?.full_name || "";
  const company = content.client?.company?.trim();
  const expires = formatCivilDate(expiresOn);
  const finalPayUrl = safeHttpsUrl(done ? done.payUrl : payUrl);
  const heading = !title || title === DEFAULT_TITLE ? "Your Trademark Proposal" : title;
  const recHeading = brand === "rpb" ? "Rebecca’s recommendation" : "Our recommendation";

  function toggle(id: string, on: boolean) {
    if (readOnly) return;
    if (!on && locked.has(id)) return;
    setOverrides((prev) => ({ ...prev, [id]: on }));
  }

  async function accept() {
    if (mode !== "live" || !onAccept || pending || done || !canAccept) return;
    setError(null);
    setPending(true);
    // Open the tab NOW, inside the click, or the browser's popup blocker treats
    // the later (post-await) open as unsolicited. It is pointed at the payment
    // page once the server has recorded the acceptance.
    let tab: Window | null = null;
    try {
      tab = window.open("about:blank", "_blank");
      if (tab) tab.document.body.textContent = "Opening your secure payment page…";
    } catch {
      tab = null;
    }
    try {
      const result = await onAccept(selection);
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
      setDone({ payUrl: url, opened });
    } catch {
      tab?.close();
      setError("We couldn’t record your acceptance. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const rootClass = ["cp-root", brand === "rpb" ? RPB_FONT_VARS : ""].filter(Boolean).join(" ");
  const gutter = "cp-gut";
  const greetingParas = paragraphs(content.greeting);

  return (
    <div className={rootClass} data-brand={brand} data-mode={mode}>
      <header className={`cp-band ${gutter}`}>
        <div className="cp-wrap cp-band-in">
          {brand === "rpb" ? (
            // eslint-disable-next-line @next/next/no-img-element -- a 30px brand strip; the optimizer buys nothing.
            <img className="cp-logo" src="/brand/rpb-logo-cream.png" alt="RPB Law Firm, Est 2024" width={984} height={168} />
          ) : (
            <span className="cp-firm">{firm.name}</span>
          )}
          <span className="cp-who">
            {who ? `Prepared for ${who}${company ? ` · ${company}` : ""}` : null}
          </span>
        </div>
      </header>

      <main className={`cp-main ${gutter}`}>
        <div className="cp-wrap cp-layout">
          <div className="cp-left">
            <section className="cp-intro">
              {expires ? <p className="cp-date">Available through {expires}</p> : null}
              <h1>{heading}</h1>
              {greetingParas.map((p, i) => (
                <p key={i} className="cp-hi">
                  <Rich text={p} />
                </p>
              ))}
              {content.recommendation?.trim() ? (
                <div className="cp-rec">
                  <h2>{recHeading}</h2>
                  <p>
                    <Rich text={content.recommendation} />
                  </p>
                </div>
              ) : null}
            </section>

            <section className="cp-terms" aria-label="Types of trademarks">
              {(["word", "logo"] as const).map((kind) => (
                <div className="cp-term" key={kind}>
                  <h3>{MARK_KIND_LABEL[kind]}</h3>
                  <p>{MARK_KIND_DEFAULT_DESC[kind]}</p>
                </div>
              ))}
            </section>

            <section aria-labelledby="cp-s1" className="cp-choose">
              <div className="cp-step-h">
                <span className="cp-n" aria-hidden="true">
                  1
                </span>
                <div>
                  <h2 id="cp-s1">{accepted ? "What you accepted" : "Select your trademarks"}</h2>
                  <p>
                    {accepted
                      ? "These are the marks and classes in your accepted proposal."
                      : "Please select the marks you would like to protect and the corresponding classes."}
                  </p>
                </div>
              </div>

              <div className="cp-cards">
                {content.names.map((nm) => {
                  const qn = quote.names.find((q) => q.id === nm.id);
                  const pickedMarks = nm.marks.filter((m) => selection[m.id] === true).length;
                  const pickedClasses = nm.classes.filter((c) => selection[c.id] === true).length;
                  const holdsLast = [...nm.marks, ...nm.classes].some((x) => locked.has(x.id));
                  return (
                    <article className="cp-card" key={nm.id} aria-labelledby={`cp-h-${nm.id}`}>
                      <div className="cp-card-h">
                        <div>
                          <h3 id={`cp-h-${nm.id}`}>{nm.name}</h3>
                          {nm.what ? <p className="cp-what">{nm.what}</p> : null}
                        </div>
                        <div className="cp-sub">
                          <span className="cp-k">Legal fee for {nm.name}</span>
                          <span className="cp-v cp-num">{money(qn?.legal_cents ?? 0)}</span>
                        </div>
                      </div>
                      {nm.note?.trim() ? (
                        <p className="cp-note">
                          <Rich text={nm.note} />
                        </p>
                      ) : null}

                      <div className="cp-part">
                        <h4>Marks</h4>
                        {nm.marks.map((m) => {
                          const d = display[m.id];
                          const on = selection[m.id] === true;
                          return (
                            <label className={`cp-opt${on ? "" : " cp-off"}`} key={m.id}>
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={readOnly || locked.has(m.id)}
                                aria-describedby={locked.has(m.id) ? `cp-keep-${nm.id}` : undefined}
                                onChange={(e) => toggle(m.id, e.target.checked)}
                              />
                              <span className="cp-box" aria-hidden="true" />
                              <span className="cp-t">
                                <b>{MARK_KIND_LABEL[m.kind] ?? m.kind}</b>
                                <span>{m.desc}</span>
                              </span>
                              <span className="cp-pr cp-num">
                                {d?.second ? <s>{money(d.base_cents)}</s> : null}
                                {money(d?.price_cents ?? 0)}
                                <small>
                                  {d?.second
                                    ? `${Math.round(pricing.second_mark_discount_pct)}% off as your second mark`
                                    : `${plural(d?.class_count ?? 0, "class", "classes")} included`}
                                </small>
                              </span>
                            </label>
                          );
                        })}
                      </div>

                      <div className="cp-part">
                        <h4>
                          Classes <span>(apply to each mark selected above)</span>
                        </h4>
                        {nm.classes.map((c, ci) => {
                          const on = selection[c.id] === true;
                          return (
                            <label className={`cp-opt${on ? "" : " cp-off"}`} key={c.id}>
                              <input
                                type="checkbox"
                                checked={on}
                                disabled={readOnly || locked.has(c.id)}
                                aria-describedby={locked.has(c.id) ? `cp-keep-${nm.id}` : undefined}
                                onChange={(e) => toggle(c.id, e.target.checked)}
                              />
                              <span className="cp-box" aria-hidden="true" />
                              <span className="cp-t">
                                <b>{`Class ${ci + 1} · ${c.label}`}</b>
                              </span>
                              <span className="cp-pr cp-num">
                                + {money(pricing.gov_per_class_cents)}
                                <small>filing fee per mark</small>
                              </span>
                            </label>
                          );
                        })}
                      </div>

                      {!readOnly && pickedMarks > 0 && pickedClasses === 0 ? (
                        <p className="cp-warn" role="status">
                          Please select at least one class to include {nm.name}.
                        </p>
                      ) : null}
                      {holdsLast ? (
                        <p className="cp-keep" id={`cp-keep-${nm.id}`}>
                          {KEEP_ONE_HINT}
                        </p>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="cp-inc" aria-labelledby="cp-h-inc">
              <div className="cp-inc-h">
                <h2 id="cp-h-inc">What your package includes</h2>
                <span>{pricing.package}&trade;, with each trademark you choose</span>
              </div>
              <table className="cp-ben">
                <tbody>
                  {content.includes.map((r, i) => (
                    <tr key={i} className={r.highlight ? "cp-hl" : undefined}>
                      <td>
                        {r.label}
                        {r.value ? <span className="cp-val">({r.value})</span> : null}
                        {r.note ? <span className="cp-sub-note">{r.note}</span> : null}
                      </td>
                      <td className="cp-vcell">{r.included}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {content.office_action_note?.trim() ? (
                <p className="cp-oa">
                  <Rich text={content.office_action_note} />
                </p>
              ) : null}
            </section>
          </div>

          <aside className="cp-side" id="cp-review" aria-labelledby="cp-s2">
            <div className="cp-panel">
              <div className="cp-panel-h">
                <span className="cp-n" aria-hidden="true">
                  2
                </span>
                <h2 id="cp-s2">{accepted ? "Your acceptance" : "Review and accept"}</h2>
              </div>
              <div className="cp-panel-b" aria-live="polite">
                <div className="cp-lines">
                  {quote.names.map((qn) => (
                    <div className="cp-grp" key={qn.id}>
                      <h3>{qn.name}</h3>
                      {qn.included ? (
                        qn.marks.map((m) => (
                          <div className="cp-ln" key={m.id}>
                            <span className="cp-l">
                              {MARK_KIND_LABEL[m.kind] ?? m.kind}
                              {m.second ? <small>{Math.round(pricing.second_mark_discount_pct)}% off</small> : null}
                            </span>
                            <span className="cp-r cp-num">{money(m.price_cents)}</span>
                          </div>
                        ))
                      ) : (
                        <p className="cp-empty">Not included</p>
                      )}
                    </div>
                  ))}
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
                      <b>Legal fee due now</b>
                      <span>Due now to begin</span>
                    </div>
                    <div className="cp-big cp-num">{money(quote.legal_total_cents)}</div>
                  </div>
                  <div className="cp-row">
                    <div className="cp-l">
                      <b>USPTO filing fees, due at filing</b>
                      <span>
                        {plural(quote.gov_class_count, "class", "classes")} &times; {money(pricing.gov_per_class_cents)},
                        paid before filing, not today
                      </span>
                    </div>
                    <div className="cp-mid cp-num">{money(quote.gov_total_cents)}</div>
                  </div>
                </div>

                {accepted ? (
                  <>
                    <div className="cp-done" role="status">
                      <h3>Thank you{firstName ? `, ${firstName}` : ""}.</h3>
                      <p>
                        Your acceptance is recorded.
                        {finalPayUrl
                          ? done?.opened
                            ? " Your payment page opened in a new tab. If it didn’t, use the button below."
                            : " Use the button below to pay your legal fee."
                          : " We will send your payment link by email."}
                      </p>
                    </div>
                    {finalPayUrl ? (
                      <a className="cp-btn" href={finalPayUrl} target="_blank" rel="noopener noreferrer">
                        Pay my legal fee
                      </a>
                    ) : null}
                    <p className="cp-paynote">
                      Once your payment is received, we&rsquo;ll send your engagement agreement for review and signature.
                    </p>
                  </>
                ) : (
                  <>
                    {mode === "preview" ? (
                      <button type="button" className="cp-btn" disabled>
                        Preview
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="cp-btn"
                        onClick={accept}
                        disabled={!canAccept || pending || !onAccept}
                      >
                        {pending ? "Recording…" : "Accept and pay my legal fee"}
                      </button>
                    )}
                    {error ? (
                      <p className="cp-error" role="alert">
                        {error}
                      </p>
                    ) : null}
                    <p className="cp-paynote">
                      You&rsquo;ll pay <b className="cp-num">{money(quote.legal_total_cents)}</b>{" "}
                      through our secure client
                      portal. Once it&rsquo;s received, we&rsquo;ll send your engagement agreement for review and signature.
                    </p>
                  </>
                )}

                {expires ? (
                  <p className="cp-exp">
                    Available through <b>{expires}</b>
                  </p>
                ) : null}
                <p className="cp-how">
                  Each trademark is a {pricing.package} package: {money(pricing.base_cents)} for{" "}
                  {plural(pricing.included_classes, "class", "classes")}, adjusted by {money(pricing.per_class_cents)} for each
                  class added or not needed. The second mark for the same name is {Math.round(pricing.second_mark_discount_pct)}%
                  off.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {accepted ? null : (
        <div className="cp-bar">
          <div className="cp-bar-in">
            <span>
              Legal fee due now <b className="cp-num">{money(quote.legal_total_cents)}</b>
            </span>
            <a href="#cp-review">Review and accept</a>
          </div>
        </div>
      )}

      <footer className={`cp-footer ${gutter}`}>
        <div className="cp-wrap">
          {brand === "rpb" ? (
            <>
              <p className="cp-c">RPB Law, PLLC &middot; (305) 712-6960 &middot; info@rpblawfirm.com &middot; www.rpblawfirm.com</p>
              <p className="cp-d">
                Attorney advertising. Prepared for discussion purposes; does not constitute legal advice or create an
                attorney-client relationship.
              </p>
            </>
          ) : (
            <p className="cp-c">{firm.name}</p>
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
