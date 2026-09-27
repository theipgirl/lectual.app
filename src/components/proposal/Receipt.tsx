import { formatFirmDateTime } from "@/lib/quotes/labels";
import { formatCents } from "@/lib/quotes/money";
import { toAmount, toCount } from "@/lib/quotes/drift";
import type { PublicQuoteView, QuoteAcceptedSnapshot } from "@/lib/quotes/public";
import { FirmHeader } from "./FirmHeader";

/**
 * The client's copy of what they signed, rendered from `accepted_snapshot` and
 * nothing else (§5). The live lines can still change after signature; the
 * snapshot cannot, and a receipt that re-read the live rows would restate a
 * signed agreement every time the firm re-priced a package.
 *
 * A snapshot this build cannot parse renders as "your acceptance is on file"
 * WITHOUT figures — true — rather than falling back to the live lines, which
 * is the exact substitution §5 forbids.
 *
 * No form of any kind. And no promise of a notification: nothing here emails
 * anyone, so the copy says the acceptance is on file with the firm, not that
 * the firm "has been told".
 */
export function Receipt({ view }: { view: PublicQuoteView }) {
  const snapshot = view.acceptedSnapshot;
  const acceptedAt = formatFirmDateTime(snapshot?.accepted_at ?? view.acceptedAt);

  return (
    <>
      <FirmHeader firm={view.firm} />
      <section role="status" className="lx-banner lx-banner-ok" style={{ display: "grid", gap: 6 }}>
        <strong style={{ fontFamily: "var(--serif)", fontWeight: 400, fontSize: 24, color: "var(--ok)" }}>Accepted</strong>
        <span style={{ color: "var(--ink)" }}>
          {view.acceptedByName ? (
            <>
              Signed by <strong style={{ fontWeight: 500 }}>{view.acceptedByName}</strong>
              {acceptedAt ? <> on {acceptedAt}</> : null}.
            </>
          ) : (
            <>Your acceptance is recorded{acceptedAt ? <> — {acceptedAt}</> : null}.</>
          )}{" "}
          It is on file with {view.firm.name}, and nothing was charged on this page. If you don&rsquo;t hear
          back, contact {view.firm.name} directly.
        </span>
      </section>

      <section className="lx-card" style={{ padding: "26px 24px", display: "grid", gap: 14 }}>
        <span className="lx-label">Your agreement</span>
        <h1 className="lx-h2">{snapshot?.quote.title ?? view.title}</h1>
        {snapshot ? (
          <SnapshotBody snapshot={snapshot} />
        ) : (
          <p style={{ margin: 0, color: "var(--body)", fontSize: 15, lineHeight: 1.6 }}>
            Your acceptance is on file with {view.firm.name}. The signed copy isn&rsquo;t available to display here —
            contact {view.firm.name} and they can send it to you.
          </p>
        )}
      </section>
    </>
  );
}

function SnapshotBody({ snapshot }: { snapshot: QuoteAcceptedSnapshot }) {
  const accepted = snapshot.lines.filter((line) => line.selected);
  const declined = snapshot.lines.filter((line) => !line.selected);
  const currency = snapshot.currency;
  return (
    <>
      <ul className="lx-list">
        {accepted.map((line) => (
          <li key={line.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "10px 0" }}>
            <span style={{ color: "var(--ink)" }}>
              {line.label}
              {toCount(line.quantity) > 1 && <span className="lx-note"> × {toCount(line.quantity)}</span>}
              {line.charge_at === "filing" && <span className="lx-note" style={{ display: "block" }}>charged later, at filing</span>}
              {line.charge_at === "not_charged" && <span className="lx-note" style={{ display: "block" }}>no charge</span>}
            </span>
            <span className="lx-num" style={{ whiteSpace: "nowrap" }}>
              {formatCents(toAmount(line.amount_cents), currency)}
            </span>
          </li>
        ))}
      </ul>
      {/* An add-on the client turned down is part of what was agreed; dropping
          it would make it look like one that was never offered. */}
      {declined.length > 0 && (
        <p className="lx-note" style={{ margin: 0 }}>
          Not included: {declined.map((line) => line.label).join(", ")}.
        </p>
      )}
      {/* §0's split survives on the signed copy: two timed figures, the project
          cost below them and never beside them. */}
      <div style={{ display: "grid", gap: 8, padding: "14px 16px", borderRadius: 10, background: "var(--well)" }}>
        <Row label="Due at signing" value={formatCents(toAmount(snapshot.totals?.due_at_signing), currency)} strong />
        <Row label="Due later, at filing (USPTO fees)" value={formatCents(toAmount(snapshot.totals?.due_at_filing), currency)} strong />
        <Row label="Full project cost (not an amount due today)" value={formatCents(toAmount(snapshot.totals?.full_project_cost), currency)} />
      </div>
      {snapshot.quote.terms_body && (
        <div style={{ display: "grid", gap: 8, paddingTop: 14, borderTop: "1px solid var(--line-2)" }}>
          <span className="lx-label">Terms you agreed to</span>
          {/* Text with pre-wrap, never HTML: this route has no sanitiser. */}
          <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 14.5, lineHeight: 1.65, color: "var(--body)" }}>{snapshot.quote.terms_body}</p>
        </div>
      )}
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, color: strong ? "var(--ink)" : "var(--muted)" }}>
      <span style={{ fontWeight: strong ? 500 : 400 }}>{label}</span>
      <span className="lx-num" style={{ fontWeight: strong ? 700 : 400, whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}
