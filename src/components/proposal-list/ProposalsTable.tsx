import Link from "next/link";
import { formatCents } from "@/lib/quotes/money";
import type { ProposalRowView } from "@/lib/proposals/list-rows";
import { PaidCell } from "./PaidCell";
import { OpensLine } from "./OpensLine";

/**
 * The proposals table, to the Quotes & proposals design: PROPOSAL, CLIENT, STATUS, ACCEPTED, PAID, AT SIGNING,
 * AT FILING, EXPIRES, LAST ACTIVITY. The two money columns are two figures: the legal fee due at
 * signing and the USPTO fees due at filing. Nothing here adds them, and nothing is called a total.
 *
 * Accepted and Paid are on every row (Sprint 29): "Accepted Oct 21" or "Not yet", and the Paid cell (`PaidCell`).
 * Marking paid is by hand, a stopgap until the firm's LawPay connection takes payment on the proposal. Under 760px
 * each row becomes a stack and those two cells sit directly under the client's name (proposals.css).
 *
 * Spec 7: under Accepted, whether the client has opened the link ("Opened Oct 29, 3:12 PM · 4 times").
 */
export function ProposalsTable({ rows, footerLeft, footerRight }: { rows: ProposalRowView[]; footerLeft: string; footerRight: string }) {
  return (
    <div className="lx-card pq-table-card">
      <div className="pq-table-scroll">
        <table className="lx-tbl pq-tbl lx-stack">
          <thead>
            <tr>
              <th className="pq-th-proposal">Proposal</th>
              <th className="pq-th-client">Client</th>
              <th className="pq-th-status">Status</th>
              <th className="pq-th-accepted">Accepted</th>
              <th className="pq-th-paid">Paid</th>
              <th className="pq-money pq-th-money">At signing</th>
              <th className="pq-money pq-th-money">At filing</th>
              <th className="pq-th-expires">Expires</th>
              <th className="pq-th-activity">Last activity</th>
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
                </td>
                <td className="wrap pq-client pq-c-client" title={r.client}>{r.client}</td>
                <td className="pq-c-status">
                  <span className={`lx-pill lx-pill-${r.statusTone}`}>{r.statusLabel}</span>
                  {r.statusSub && <div className="pq-mono pq-sub">{r.statusSub}</div>}
                  {r.expires && r.expires !== "—" && <div className="pq-mono pq-sub pq-exp-inline">{/^(Signed|Expired) /.test(r.expires) ? r.expires : <>Expires{" "}{r.expires}</>}</div>}
                </td>
                <td className="pq-c-accepted" data-label="Accepted" data-accepted={r.accepted === "Not yet" ? "no" : "yes"}>
                  {r.accepted}
                  {r.opens ? <OpensLine opens={r.opens} /> : null}
                </td>
                <td className="wrap pq-c-paid" data-label="Paid">
                  <PaidCell proposalId={r.id} cell={r.paidCell} />
                </td>
                <td className="pq-money pq-c-signing" data-label="At signing">{formatCents(r.atSigningCents)}</td>
                <td className="pq-money pq-filing pq-c-filing" data-label="At filing">{r.atFilingCents === null ? "—" : formatCents(r.atFilingCents)}</td>
                <td className="pq-mono pq-expires pq-c-expires" data-label="Expires">{r.expires}</td>
                <td className="wrap pq-activity pq-c-activity" data-label="Last activity">
                  <span className="pq-clamp" title={r.activity}>{r.activity}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pq-foot">
        <span>{footerLeft}</span>
        <span>{footerRight}</span>
      </div>
    </div>
  );
}
