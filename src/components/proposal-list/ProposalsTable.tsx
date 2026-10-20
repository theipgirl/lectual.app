import Link from "next/link";
import { formatCents } from "@/lib/quotes/money";
import type { ProposalRowView } from "@/lib/proposals/list-rows";

/**
 * The proposals table, to the Quotes & proposals design: PROPOSAL, CLIENT, STATUS, AT SIGNING,
 * AT FILING, EXPIRES, LAST ACTIVITY. The two money columns are two figures: the legal fee due at
 * signing and the USPTO fees due at filing. Nothing here adds them, and nothing is called a total.
 */
export function ProposalsTable({ rows, footerLeft, footerRight }: { rows: ProposalRowView[]; footerLeft: string; footerRight: string }) {
  return (
    <div className="lx-card pq-table-card">
      <div className="pq-table-scroll">
        <table className="lx-tbl pq-tbl">
          <thead>
            <tr>
              <th>Proposal</th>
              <th>Client</th>
              <th>Status</th>
              <th className="pq-money">At signing</th>
              <th className="pq-money">At filing</th>
              <th>Expires</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-status={r.key}>
                <td className="wrap">
                  <Link href={`/dashboard/proposals/${r.id}/`} className="lx-rowlink">
                    {r.headline}
                  </Link>
                  <div className="pq-mono pq-sub">{r.subline}</div>
                </td>
                <td className="wrap pq-client">{r.client}</td>
                <td>
                  <span className={`lx-pill lx-pill-${r.statusTone}`}>{r.statusLabel}</span>
                  {r.statusSub && <div className="pq-mono pq-sub">{r.statusSub}</div>}
                </td>
                <td className="pq-money">{formatCents(r.atSigningCents)}</td>
                <td className="pq-money pq-filing">{formatCents(r.atFilingCents)}</td>
                <td className="pq-mono pq-expires">{r.expires}</td>
                <td className="wrap pq-activity">{r.activity}</td>
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
