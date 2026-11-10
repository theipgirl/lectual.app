import Link from "next/link";
import { formatCents } from "@/lib/quotes/money";
import { MARK_PAID_NOTE, type ProposalRowView } from "@/lib/proposals/list-rows";
import { PaidCell } from "./PaidCell";
import { OpensLine } from "./OpensLine";

/**
 * The proposals table, five columns (Nov 10): PROPOSAL (headline, sub-line and the last activity as a third quiet line), CLIENT,
 * STATUS (the pill on one line, the blocked reason once, the expiry or signed date), CLIENT RESPONSE (Accepted, Opened, then the
 * Paid state with its Mark paid or Undo button) and FEES. The two fees are two figures: the legal fee due at signing and the
 * USPTO fees due at filing. Nothing here adds them, and nothing is called a total. A flat-fee (general) row has no filing line.
 *
 * Marking paid is by hand, a stopgap until the firm's LawPay connection takes payment on the proposal. Its sentence is said once,
 * in the footer, and is the button's title. Under 760px each row becomes a stack (proposals.css).
 *
 * Spec 7: under Accepted, whether the client has opened the link ("Opened Oct 29, 3:12 PM · 4 times").
 */
export function ProposalsTable({ rows, footerLeft, footerRight }: { rows: ProposalRowView[]; footerLeft: string; footerRight: string }) {
  const anyMarkPaid = rows.some((r) => r.paidCell.kind === "not_paid" && r.paidCell.canMark);
  return (
    <div className="lx-card pq-table-card">
      <div className="pq-table-scroll">
        <table className="lx-tbl pq-tbl lx-stack">
          <thead>
            <tr>
              <th className="pq-th-proposal">Proposal</th>
              <th className="pq-th-client">Client</th>
              <th className="pq-th-status">Status</th>
              <th className="pq-th-response">Client response</th>
              <th className="pq-th-fees">Fees</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-status={r.key}>
                <td className="wrap pq-c-proposal">
                  <Link href={`/dashboard/proposals/${r.id}/`} className="lx-rowlink pq-headline" title={r.headline}>
                    {r.headline}
                  </Link>
                  <div className="pq-mono pq-sub pq-subline" title={r.subline}>{r.subline}</div>
                  <div className="pq-mono pq-activity-line" title={r.activityLine}>{r.activityLine}</div>
                </td>
                <td className="wrap pq-client pq-c-client" data-label="Client" title={r.client}>{r.client}</td>
                <td className="wrap pq-c-status" data-label="Status">
                  <span className={`lx-pill lx-pill-${r.statusTone} pq-pill`}>{r.statusLabel}</span>
                  {r.statusSub && <div className="pq-mono pq-sub pq-status-sub" title={r.statusSub}>{r.statusSub}</div>}
                  {r.expires && r.expires !== "—" && <div className="pq-mono pq-sub pq-exp-inline">{/^(Signed|Expired) /.test(r.expires) ? r.expires : <>Expires{" "}{r.expires}</>}</div>}
                </td>
                <td className="wrap pq-c-response" data-label="Client response">
                  <div className="pq-accepted" data-accepted={r.accepted === "Not yet" ? "no" : "yes"}>{r.accepted}</div>
                  {r.opens && r.opens.text !== "—" ? <OpensLine opens={r.opens} /> : null}
                  {r.paidCell.kind !== "none" && (
                    <div className="pq-c-paid">
                      <PaidCell proposalId={r.id} cell={r.paidCell} />
                    </div>
                  )}
                </td>
                <td className="pq-c-fees" data-label="Fees">
                  <div className="pq-fee pq-fee-signing"><span className="pq-fee-n">{formatCents(r.atSigningCents)}</span>{" "}<span className="pq-fee-l">at signing</span></div>
                  {r.atFilingCents !== null && (
                    <div className="pq-fee pq-fee-filing"><span className="pq-fee-n">{formatCents(r.atFilingCents)}</span>{" "}<span className="pq-fee-l">at filing</span></div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pq-foot">
        <span>{footerLeft}</span>
        <span className="pq-foot-right">
          <span>{footerRight}</span>
          {anyMarkPaid && <span className="pq-foot-note">{MARK_PAID_NOTE}</span>}
        </span>
      </div>
    </div>
  );
}
