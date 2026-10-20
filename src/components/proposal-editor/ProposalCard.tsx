import "@/app/dashboard/proposals/proposals.css";
import type { ProposalCard as Card } from "@/lib/proposals/card";
import { formatDollars } from "@/lib/proposal-editor/events";
import { formatShortFirmDate } from "@/lib/quotes/labels";

/**
 * One card for the approver: who the offer is for, the package, what was heard
 * per brand against what the package covers, the two fees, the expiry, and the
 * quotes from the call. The legal fee (at signing) and the USPTO fees (at
 * filing) are two figures of equal weight and are never added together.
 *
 * Staff-facing. Receipts the agent could not check word for word are listed
 * apart, under their own heading, so a paraphrase is never read as a quote.
 */
export function ProposalCard({ card }: { card: Card }) {
  const receipts = card.receipts;
  return (
    <section className="lx-card pe-pcard" aria-label="Proposal at a glance">
      <div className="pe-pcard-head">
        <div>
          <div className="lx-label">Proposal at a glance</div>
          <h2 className="pe-h">
            {card.client}
            {card.company ? <span className="lx-note"> · {card.company}</span> : null}
          </h2>
        </div>
        <div className="pe-pcard-meta">
          {card.package && <span className="lx-pill lx-pill-mute">{card.package}</span>}
          <span className="lx-note">
            {card.expiresOn ? `Open until ${formatShortFirmDate(`${card.expiresOn}T12:00:00Z`, "UTC")}` : "No expiry date set"}
          </span>
        </div>
      </div>

      {card.brands.length === 0 ? (
        <p className="lx-note" style={{ margin: 0 }}>No brand names on this proposal yet.</p>
      ) : (
        <ul className="pe-pcard-brands">
          {card.brands.map((b, i) => (
            <li key={`${b.name}-${i}`}>
              <div className="pe-pcard-brand">
                <b>{b.name}</b>
                <span className="lx-note">{b.marks.length > 0 ? b.marks.join(" + ") : "No marks"}</span>
              </div>
              <div>{b.coverage}</div>
              {b.classLabels.length > 0 && <div className="lx-note">{b.classLabels.join(" · ")}</div>}
            </li>
          ))}
        </ul>
      )}

      <dl className="pe-pcard-fees">
        <div>
          <dt>At signing (legal fee)</dt>
          <dd className="lx-num">{formatDollars(card.legalAtSigningCents)}</dd>
        </div>
        <div>
          <dt>At filing (USPTO fees)</dt>
          <dd className="lx-num">{formatDollars(card.usptoAtFilingCents)}</dd>
        </div>
      </dl>
      <p className="lx-note" style={{ margin: 0 }}>
        Worked out from the saved prices at the pre-ticked offer. The two fees are separate and are never added together.
      </p>

      {receipts.status === "unavailable" && (
        <p role="status" className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
          Receipts couldn&apos;t be loaded just now, so the quotes from the call aren&apos;t shown. That doesn&apos;t mean there were none.
        </p>
      )}
      {receipts.status === "ok" && (
        <div className="pe-pcard-receipts">
          <h3 className="lx-label">Heard on the call</h3>
          {receipts.verified.length > 0 ? (
            <ul>
              {receipts.verified.map((q, i) => (
                <li key={i}>“{q}”</li>
              ))}
            </ul>
          ) : (
            <p className="lx-note" style={{ margin: 0 }}>No quote could be checked against the call word for word.</p>
          )}
          {receipts.unverified.length > 0 && (
            <>
              <h3 className="lx-label">Not found word for word, check it</h3>
              <ul className="pe-pcard-unverified">
                {receipts.unverified.map((q, i) => (
                  <li key={i}>“{q}”</li>
                ))}
              </ul>
            </>
          )}
          {receipts.more > 0 && <p className="lx-note" style={{ margin: 0 }}>And {receipts.more} more {receipts.more === 1 ? "quote" : "quotes"} not shown.</p>}
          {receipts.notes && (
            <p className="lx-note" style={{ margin: 0 }}>
              Notes for the reviewer: {receipts.notes}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
