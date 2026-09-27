import { formatFirmDateTime } from "@/lib/quotes/labels";
import { formatCents } from "@/lib/quotes/money";
import { toAmount } from "@/lib/quotes/drift";
import { describeSignedChoice } from "@/lib/quotes/packages";
import type { PublicQuoteView, QuoteAcceptedSnapshot } from "@/lib/quotes/public";
import { FirmHeader } from "./FirmHeader";
import { PrintButton } from "./PrintButton";

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
 * The design's "Download signed copy (PDF)" is a print-optimised page (q.css's
 * print stylesheet) and a button that opens the browser's print dialog, where
 * "Save as PDF" is one of the destinations. It is labelled as exactly that —
 * no PDF is generated here, and this app adds no dependency to make one.
 *
 * No form of any kind, no payment step and no promise of an email: the copy
 * says the acceptance is on file with the firm, which is what happened.
 */
export function Receipt({ view }: { view: PublicQuoteView }) {
  const snapshot = view.acceptedSnapshot;
  const acceptedAt = formatFirmDateTime(snapshot?.accepted_at ?? view.acceptedAt);

  return (
    <>
      <FirmHeader firmName={view.firm.name} note={acceptedAt ? `Signed ${acceptedAt}` : "Signed"} />
      <div className="qp-body">
        {snapshot ? (
          <SnapshotBody snapshot={snapshot} signer={view.acceptedByName} acceptedAt={acceptedAt} firmName={view.firm.name} />
        ) : (
          <>
            <div>
              <span className="qp-accepted-pill">Accepted</span>
              <h1 className="qp-title" style={{ marginTop: 11 }}>
                {view.title}
              </h1>
            </div>
            <p className="qp-intro" style={{ marginTop: 0 }}>
              Your acceptance{acceptedAt ? ` of ${acceptedAt}` : ""} is on file with {view.firm.name}. The signed copy
              isn&rsquo;t available to display here — contact {view.firm.name} and they can send it to you.
            </p>
          </>
        )}
      </div>
    </>
  );
}

function SnapshotBody({
  snapshot,
  signer,
  acceptedAt,
  firmName,
}: {
  snapshot: QuoteAcceptedSnapshot;
  signer: string | null;
  acceptedAt: string;
  firmName: string;
}) {
  const currency = snapshot.currency;
  const choice = describeSignedChoice(snapshot.lines);
  const name = signer ?? snapshot.signature?.name ?? "";
  return (
    <>
      <div>
        <span className="qp-accepted-pill">Accepted</span>
        <h1 className="qp-title" style={{ marginTop: 11 }}>
          {choice.packageName ? `${choice.packageName} — ${snapshot.quote.title}` : snapshot.quote.title}
        </h1>
        <p className="qp-intro" style={{ color: "var(--muted)", fontSize: 13.5 }}>
          A frozen snapshot of what you agreed to. Later edits by the firm can&rsquo;t change it.
        </p>
      </div>

      <div className="qp-section">
        <div className="qp-due-now">{formatCents(toAmount(snapshot.totals?.due_at_signing), currency)}</div>
        <div className="qp-due-label">Due at signing{acceptedAt ? ` · signed ${acceptedAt}` : ""}</div>
        <div className="qp-due-note">Invoiced by {firmName}. Nothing was charged on this page.</div>
        <div className="qp-due-later">{formatCents(toAmount(snapshot.totals?.due_at_filing), currency)}</div>
        <div className="qp-due-later-label">Due at filing · not yet charged</div>
        <div className="qp-due-note">USPTO government fees, collected when the applications are filed.</div>
        <div className="qp-project">
          Full project cost {formatCents(toAmount(snapshot.totals?.full_project_cost), currency)} — not an amount due at signing
        </div>
      </div>

      <div className="qp-section">
        <div className="qp-kicker">What you agreed to</div>
        <div className="qp-lines">
          {choice.agreed.map((line) => (
            <div key={line.id} className="qp-line">
              <span className="qp-line-label">
                {line.label}
                {line.quantity > 1 ? ` × ${line.quantity}` : ""}
                {line.bucket === "filing" ? " (at filing)" : line.bucket === "not_charged" ? " (not charged)" : ""}
                {line.isAddOn ? " · add-on" : ""}
              </span>
              <span className="qp-line-amount">{formatCents(line.amountCents, currency)}</span>
            </div>
          ))}
        </div>
        {/* What was offered and not taken is part of the record too: dropping it
            would make it look as though it was never on the table. */}
        {(choice.otherPackages.length > 0 || choice.declinedAddOns.length > 0) && (
          <p className="qp-small" style={{ marginTop: 10 }}>
            Also offered, not taken: {[...choice.otherPackages, ...choice.declinedAddOns].join(", ")}.
          </p>
        )}
      </div>

      {snapshot.quote.terms_body && (
        <div className="qp-terms">
          <div className="qp-kicker">Terms you agreed to</div>
          {/* Text with pre-wrap, never HTML: this route has no sanitiser. */}
          <p className="qp-terms-body">{snapshot.quote.terms_body}</p>
        </div>
      )}

      <div className="qp-section">
        <div className="qp-kicker">Signed by</div>
        <div className="qp-signature">{name}</div>
        {acceptedAt && <p className="qp-small">{acceptedAt}</p>}
      </div>

      <div className="qp-noprint" style={{ display: "grid", gap: 8 }}>
        <PrintButton />
        <p className="qp-hint">Opens your browser&rsquo;s print dialog — choose &ldquo;Save as PDF&rdquo; to keep a file.</p>
      </div>
    </>
  );
}
