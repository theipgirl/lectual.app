import { TermsEditor } from "./QuoteForms";

/**
 * The engagement-terms panel under the quote builder. A server component; the
 * editor inside it is the client piece in QuoteForms.tsx. (The fees, totals and
 * activity that used to be panels here are QuoteBuilder.tsx now.)
 */

function Panel({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h2 className="lx-h2" style={{ fontSize: 23 }}>
          {title}
        </h2>
        {meta && <span className="lx-note">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

/* ── terms ──────────────────────────────────────────────────────────────── */

/** Which read-only fact is true of a non-editable quote's terms. */
export type TermsReadOnlyView =
  /** Accepted, and the frozen record parsed — this is the wording as signed. */
  | { kind: "signed"; signedTermsBody: string | null }
  /** Accepted, but `accepted_snapshot` is null or unparseable. */
  | { kind: "signed-missing" }
  /** Declined / withdrawn / expired: no longer editable, never signed. */
  | { kind: "closed"; status: string };

/**
 * The engagement terms, beside the fees they price — one signature on the
 * client page covers both, so anything that edits one and not the other is
 * editing half a document.
 *
 * Read-only is THREE different facts, and each says only what is true of the
 * text under it: the signed wording (with any later drift of the live column
 * reported), an accepted quote with no readable snapshot (the live wording,
 * labelled as such), or a closed quote that was never signed.
 */
export function TermsPanel(props: {
  quoteId: string;
  termsBody: string | null;
  readOnly: TermsReadOnlyView | null;
  isLive: boolean;
  defaultClientName: string;
}) {
  const { readOnly } = props;
  return (
    <Panel title={readOnly?.kind === "signed" ? "Engagement terms as signed" : "Engagement terms"}>
      {!readOnly ? (
        <TermsEditor quoteId={props.quoteId} termsBody={props.termsBody} isLive={props.isLive} defaultClientName={props.defaultClientName} />
      ) : readOnly.kind === "signed" ? (
        <>
          <p className="lx-note" style={{ margin: 0 }}>
            The terms <strong style={{ fontWeight: 500 }}>as signed</strong>, from the frozen record of the acceptance.
            They can no longer be changed.
          </p>
          {/* Byte for byte, exactly as the agreement fingerprint compares them —
              a whitespace-only edit to a fee agreement is still an edit. */}
          {(readOnly.signedTermsBody ?? "") !== (props.termsBody ?? "") && (
            <p role="status" className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
              The quote&rsquo;s live terms no longer match what was signed — someone edited them after acceptance. The
              signed wording below is what governs.
            </p>
          )}
          <TermsText body={readOnly.signedTermsBody} empty="The signed record carries no engagement terms." />
        </>
      ) : readOnly.kind === "signed-missing" ? (
        <>
          <p role="status" className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
            This quote was accepted, but no readable signed copy of its terms is stored. The text below is the
            quote&rsquo;s <strong style={{ fontWeight: 500 }}>current</strong> wording — not the signed record.
          </p>
          <TermsText body={props.termsBody} empty="No engagement terms are stored on this quote." />
        </>
      ) : (
        <>
          <p className="lx-note" style={{ margin: 0 }}>
            This quote is {readOnly.status}, so its terms can no longer be changed. Nothing was signed — this is the
            wording that was on offer.
          </p>
          <TermsText body={props.termsBody} empty="No engagement terms were stored on this quote." />
        </>
      )}
    </Panel>
  );
}

function TermsText({ body, empty }: { body: string | null; empty: string }) {
  if (!body) {
    return (
      <p className="lx-note" style={{ margin: 0 }}>
        {empty}
      </p>
    );
  }
  return <p style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "var(--mono)", fontSize: 14, lineHeight: 1.6, color: "var(--body)" }}>{body}</p>;
}
