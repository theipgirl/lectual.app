import { formatFirmDateTime } from "@/lib/quotes/labels";
import { formatCents } from "@/lib/quotes/money";
import { toAmount } from "@/lib/quotes/drift";
import { describeSignedChoice } from "@/lib/quotes/packages";
import type { PublicQuoteView, QuoteAcceptedSnapshot } from "@/lib/quotes/public";
import type { PublicPaymentState } from "@/lib/payments/payment-state";
import { FirmHeader } from "./FirmHeader";
import { PayPanel } from "./PayPanel";
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
 * The Pay section (spec §7.4) sits under the signed record. Its state is read
 * server-side (src/lib/quotes/public-payment.ts) and only `payable` renders a
 * card form — AffiniPay Hosted Fields, so no card data reaches this app. The
 * amount line above says what is true for each state; "nothing is charged until
 * you pay below" is shown only when there is something to pay below. No
 * promise of an email anywhere.
 */
export function Receipt({ token, view, payment }: { token: string; view: PublicQuoteView; payment: PublicPaymentState }) {
  const snapshot = view.acceptedSnapshot;
  const acceptedAt = formatFirmDateTime(snapshot?.accepted_at ?? view.acceptedAt, view.firm.timeZone);

  return (
    <>
      <FirmHeader firmName={view.firm.name} note={acceptedAt ? `Signed ${acceptedAt}` : "Signed"} />
      <div className="qp-body">
        {snapshot ? (
          <SnapshotBody
            snapshot={snapshot}
            signer={view.acceptedByName}
            acceptedAt={acceptedAt}
            firmName={view.firm.name}
            payment={payment}
            payPanel={<PayPanel token={token} state={payment} firmName={view.firm.name} />}
          />
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
            <div className="qp-noprint">
              <PayPanel token={token} state={payment} firmName={view.firm.name} />
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** The sentence under "Due at signing", true for each payment state. */
function signingNote(payment: PublicPaymentState, firmName: string): string {
  switch (payment.status) {
    case "payable":
      return "Pay it by card below, to the firm's operating account. Nothing is charged until you pay below.";
    case "received":
      if (payment.outstandingCents && payment.outstandingCents > 0) return `Part of this has been received — ${firmName} will be in touch about the balance.`;
      return payment.via === "card" ? "Authorised on your card — see below." : `Recorded as paid by ${firmName}.`;
    case "confirming":
      return `A card payment is being confirmed by ${firmName} — see below.`;
    case "unavailable":
      return "Your signature is recorded. The payment status couldn't be loaded just now.";
    case "manual":
      return payment.nothingDue ? "Nothing is due at signing." : `Invoiced by ${firmName}. Nothing was charged on this page.`;
  }
}

function SnapshotBody({
  snapshot,
  signer,
  acceptedAt,
  firmName,
  payment,
  payPanel,
}: {
  snapshot: QuoteAcceptedSnapshot;
  signer: string | null;
  acceptedAt: string;
  firmName: string;
  payment: PublicPaymentState;
  /** The Pay section, placed right under the amounts it pays. */
  payPanel: React.ReactNode;
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
        <div className="qp-due-note">{signingNote(payment, firmName)}</div>
        <div className="qp-due-later">{formatCents(toAmount(snapshot.totals?.due_at_filing), currency)}</div>
        <div className="qp-due-later-label">Due at filing · not yet charged</div>
        <div className="qp-due-note">
          USPTO government fees. Not charged now — {firmName} collects them when the applications are filed.
        </div>
        <div className="qp-project">
          Full project cost {formatCents(toAmount(snapshot.totals?.full_project_cost), currency)} — not an amount due at signing
        </div>
      </div>

      <div className="qp-noprint">{payPanel}</div>

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
