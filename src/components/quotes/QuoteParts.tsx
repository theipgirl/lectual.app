import { fullProjectCost, quoteBlockers, quoteTotals, type QuoteLineInput } from "@/lib/quotes/pricing";
import { eventLabel, formatFirmDateTime } from "@/lib/quotes/labels";
import { formatCents } from "@/lib/quotes/money";
import { describeLineDrift, toAmount, toCount } from "@/lib/quotes/drift";
import type { QuoteAcceptedSnapshot } from "@/lib/quotes/public";
import type { QuoteEventRow, QuoteLineRow } from "@/lib/quotes/types";
import { AddLineForm, QuoteLineItem, ServiceItemPicker, TermsEditor, type ServiceItemOption } from "./QuoteForms";

/**
 * The quote builder's read-mostly panels. Server components; the forms inside
 * them are the client pieces in QuoteForms.tsx.
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

/* ── totals ─────────────────────────────────────────────────────────────── */

/**
 * Spec §0's one rule: two figures, timing named, never a single combined
 * number in a position that reads as an amount due.
 *
 *   "the USPTO fees are something separate that gets charged when we do the
 *    filing, not before or during signing the engagement letter." — Taylor
 *
 * "Due at signing" and "Due at filing (USPTO)" are the two large, equal-weight
 * figures. "Full project cost" sits below them, smaller, never labelled
 * "Total". A non-zero "Not charged" bucket gets its own row — it is the firm's
 * only confirmation that a line it marked "Not charged" is being treated as
 * such, so it is never gated on anything narrower than non-zero.
 *
 * Readiness renders EVERY open issue, not just the first, so fixing one shows
 * the rest on the same render.
 */
export function TotalsPanel({ lines, currency }: { lines: QuoteLineInput[]; currency: string }) {
  const totals = quoteTotals(lines, currency);
  const blockers = quoteBlockers(lines);
  return (
    <Panel title="Totals">
      <div className="lx-kpis">
        <div className="lx-card" style={{ padding: "14px 16px", display: "grid", gap: 4, boxShadow: "none", background: "var(--paper)" }}>
          <span className="lx-label" style={{ fontSize: 11 }}>
            Due at signing
          </span>
          <span className="lx-kpi-value" style={{ fontSize: 36 }}>
            {formatCents(totals.dueAtSigning, totals.currency)}
          </span>
          <span className="lx-note">Charged when the engagement letter is signed.</span>
        </div>
        <div className="lx-card" style={{ padding: "14px 16px", display: "grid", gap: 4, boxShadow: "none", background: "var(--paper)" }}>
          <span className="lx-label" style={{ fontSize: 11 }}>
            Due at filing (USPTO)
          </span>
          <span className="lx-kpi-value" style={{ fontSize: 36 }}>
            {formatCents(totals.dueAtFiling, totals.currency)}
          </span>
          <span className="lx-note">Government filing fees — charged only when the application is filed, never at signing.</span>
        </div>
      </div>
      {totals.notCharged !== 0 && (
        <p className="lx-note" style={{ margin: 0 }}>
          <span className="lx-label" style={{ fontSize: 11 }}>
            Not charged
          </span>{" "}
          <span className="lx-num" style={{ color: "var(--ink)" }}>
            {formatCents(totals.notCharged, totals.currency)}
          </span>{" "}
          — waived, informational or absorbed lines. In neither figure above, and not in the project cost.
        </p>
      )}
      <p className="lx-note" style={{ margin: 0, paddingTop: 10, borderTop: "1px solid var(--line-2)" }}>
        <span className="lx-label" style={{ fontSize: 11 }}>
          Full project cost (signing + filing)
        </span>{" "}
        <span className="lx-num" style={{ color: "var(--ink)" }}>
          {formatCents(fullProjectCost(totals), totals.currency)}
        </span>
      </p>
      {blockers.length > 0 && (
        <div role="status" className="lx-banner lx-banner-warn">
          <strong style={{ fontWeight: 500 }}>Not ready for the client to accept yet</strong>
          <ul className="lx-flags" style={{ color: "inherit" }}>
            {blockers.map((b, i) => (
              <li key={`${b.reason}-${b.lineId ?? b.tierGroup ?? i}`}>{b.message}</li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/* ── lines ──────────────────────────────────────────────────────────────── */

/**
 * The line editor. Lines render in `sort_index` order, which IS the firm's
 * chosen order (pricing.ts's `tierGroups` does not re-sort; neither does this).
 */
export function LinesPanel(props: {
  quoteId: string;
  lines: QuoteLineRow[];
  editable: boolean;
  serviceItems: ServiceItemOption[];
  currency: string;
  /** Accepted, but `accepted_snapshot` is null or unparseable. */
  signedMissing: boolean;
}) {
  const { lines } = props;
  return (
    <Panel title="Fees" meta={`${lines.length} line${lines.length === 1 ? "" : "s"}`}>
      {props.signedMissing && (
        <p role="status" className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
          This quote was accepted, but no readable signed copy of it is stored. The lines below are the quote&rsquo;s{" "}
          <strong style={{ fontWeight: 500 }}>current</strong> rows — not the signed record, and they may have changed
          since. Ask the client for their copy before relying on them.
        </p>
      )}
      {lines.length === 0 ? (
        <p className="lx-note" style={{ margin: 0 }}>
          No lines yet. Add a service from the library, or a custom line.
        </p>
      ) : (
        <ul className="lx-list">
          {lines.map((line, i) => (
            <QuoteLineItem
              key={line.id}
              line={line}
              quoteId={props.quoteId}
              editable={props.editable}
              canMoveUp={i > 0}
              canMoveDown={i < lines.length - 1}
              currency={props.currency}
            />
          ))}
        </ul>
      )}
      {props.editable ? (
        <div style={{ display: "grid", gap: 12, paddingTop: 12, borderTop: "1px solid var(--line-2)" }}>
          <ServiceItemPicker quoteId={props.quoteId} items={props.serviceItems} />
          <AddLineForm quoteId={props.quoteId} />
        </div>
      ) : (
        <p className="lx-note" style={{ margin: 0 }}>
          This quote is no longer editable.
        </p>
      )}
    </Panel>
  );
}

/* ── the signed copy ────────────────────────────────────────────────────── */

/**
 * An ACCEPTED quote renders from `accepted_snapshot`, not the live rows.
 *
 * The live rows can still move after signature; the snapshot cannot. The firm
 * — the party who gets asked "what did they actually agree to?" — reads the
 * same frozen copy the client's receipt shows. Nothing here is recomputed from
 * the lines: the per-line amounts and the totals are the snapshot's own, so a
 * later change to this app's arithmetic cannot restate a signed agreement.
 *
 * The live rows are still compared, and a divergence is SHOWN, never quietly
 * resolved in the snapshot's favour — it means the agreement was edited after
 * it was signed.
 */
export function SignedLinesPanel({ snapshot, liveLines }: { snapshot: QuoteAcceptedSnapshot; liveLines: QuoteLineRow[] }) {
  const signedLines = Array.isArray(snapshot.lines) ? snapshot.lines : [];
  const accepted = signedLines.filter((line) => line.selected);
  const declined = signedLines.filter((line) => !line.selected);
  const drift = describeLineDrift(signedLines, liveLines);
  const currency = snapshot.currency;
  const notCharged = toAmount(snapshot.totals?.not_charged);

  return (
    <Panel title="Signed fees" meta="frozen at acceptance">
      <p className="lx-note" style={{ margin: 0 }}>
        The agreement as accepted, read from the frozen record — not from the quote&rsquo;s current rows. It is the same
        copy the client sees.
      </p>
      {drift.length > 0 && (
        <div role="status" className="lx-banner lx-banner-warn">
          <strong style={{ fontWeight: 500 }}>The quote&rsquo;s live lines no longer match what was signed.</strong> The
          signed copy below is unchanged and is what governs.
          <ul className="lx-flags" style={{ color: "inherit" }}>
            {drift.map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
          </ul>
        </div>
      )}
      {accepted.length === 0 ? (
        <p className="lx-note" style={{ margin: 0 }}>
          No lines in the signed record.
        </p>
      ) : (
        <ul className="lx-list">
          {accepted.map((line) => (
            <li key={line.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0" }}>
              <span style={{ color: "var(--ink)", fontSize: 14.5 }}>
                {line.label}
                {toCount(line.quantity) > 1 && <span className="lx-note"> × {toCount(line.quantity)}</span>}
                {line.charge_at === "filing" && <span className="lx-note" style={{ display: "block" }}>charged later, at filing</span>}
                {line.charge_at === "not_charged" && <span className="lx-note" style={{ display: "block" }}>not charged</span>}
              </span>
              <span className="lx-num">{formatCents(toAmount(line.amount_cents), currency)}</span>
            </li>
          ))}
        </ul>
      )}
      {/* An add-on the client turned down is part of what was agreed; dropping
          it would make it look like one that was never offered. */}
      {declined.length > 0 && (
        <p className="lx-note" style={{ margin: 0 }}>
          Not taken: {declined.map((line) => line.label).join(", ")}.
        </p>
      )}
      <div style={{ display: "grid", gap: 6, paddingTop: 10, borderTop: "1px solid var(--line-2)" }}>
        <TotalLine label="Due at signing" value={formatCents(toAmount(snapshot.totals?.due_at_signing), currency)} strong />
        <TotalLine label="Due at filing (USPTO)" value={formatCents(toAmount(snapshot.totals?.due_at_filing), currency)} strong />
        {notCharged !== 0 && <TotalLine label="Not charged" value={formatCents(notCharged, currency)} />}
        <TotalLine label="Full project cost (signing + filing)" value={formatCents(toAmount(snapshot.totals?.full_project_cost), currency)} />
      </div>
    </Panel>
  );
}

function TotalLine({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: strong ? 15 : 14, color: strong ? "var(--ink)" : "var(--body)" }}>
      <span>{label}</span>
      <span className="lx-num" style={{ fontWeight: strong ? 700 : 400 }}>
        {value}
      </span>
    </div>
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

/* ── activity ───────────────────────────────────────────────────────────── */

/**
 * The quote's audit trail (`crm_quote_event`), newest first. Instants are in
 * the firm's zone with the zone named — this is where a firm checks when a
 * client accepted, and the server's UTC would move an evening signature to the
 * next day.
 */
export function EventsPanel({ events, loadError }: { events: QuoteEventRow[]; loadError: boolean }) {
  return (
    <Panel title="Activity">
      {loadError ? (
        <p role="alert" className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
          The activity for this quote couldn&rsquo;t be loaded. That is not the same as there being none.
        </p>
      ) : events.length === 0 ? (
        <p className="lx-note" style={{ margin: 0 }}>
          No activity yet.
        </p>
      ) : (
        <ul className="lx-timeline">
          {events.map((event) => (
            <li key={event.id} data-tone={event.actor === "client" ? "mail" : undefined}>
              <div className="lx-timeline-head">
                <span>{eventLabel(event.type)}</span>
                <span className="lx-note lx-num" style={{ fontSize: 12.5 }}>
                  {formatFirmDateTime(event.created_at)}
                </span>
              </div>
              <p className="lx-note">{event.actor === "client" ? "Client" : event.actor === "system" ? "Lectual" : "Firm"}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
