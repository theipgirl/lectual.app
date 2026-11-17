import Link from "next/link";
import { SheetCard, SheetScroll, SheetTable } from "@/components/ui/SheetTable";
import { Pill } from "@/components/ui/Pill";
import { MARK_PAID_NOTE, type ProposalRowView } from "@/lib/proposals/list-rows";
import { formatMoney } from "@/lib/ui/format";
import { PaidCell } from "./PaidCell";
import { OpensLine } from "./OpensLine";

/**
 * The proposals table, five columns (Nov 10): PROPOSAL (headline, sub-line and the last activity as a third quiet line), CLIENT,
 * STATUS (the pill on one line, the blocked reason once, the expiry or signed date), CLIENT RESPONSE (Accepted, Opened, then the
 * Paid state with its Mark paid or Undo button) and FEES. The two fees are two figures: the legal fee due at signing and the
 * USPTO fees due at filing. Nothing here adds them, and nothing is called a total. A flat-fee (general) row has no filing line.
 *
 * Drawn on the shared sheet table kit: a fixed layout that always fits its card (so the header stays visible while the page
 * scrolls), and under 640px each row is a card whose cells carry their `data-label`.
 *
 * Marking paid is by hand, a stopgap until the firm's LawPay connection takes payment on the proposal. Its sentence is said once,
 * in the footer, and is the button's title.
 *
 * Spec 7: under Accepted, whether the client has opened the link ("Opened Oct 29, 3:12 PM · 4 times").
 */
export function ProposalsTable({ rows, footerLeft, footerRight }: { rows: ProposalRowView[]; footerLeft: string; footerRight: string }) {
  const anyMarkPaid = rows.some((r) => r.paidCell.kind === "not_paid" && r.paidCell.canMark);
  return (
    <SheetCard className="pq-table-card">
      <SheetScroll scroll={false}>
        <SheetTable fixed className="pq-tbl">
          <colgroup>
            <col className="pq-col-proposal" />
            <col className="pq-col-client" />
            <col className="pq-col-status" />
            <col className="pq-col-response" />
            <col className="pq-col-fees" />
          </colgroup>
          <thead>
            <tr>
              <th className="pq-th-proposal">Proposal</th>
              <th className="pq-th-client">Client</th>
              <th className="pq-th-status">Status</th>
              <th className="pq-th-response">Client response</th>
              <th className="pq-th-fees num">Fees</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} data-status={r.key}>
                <td className="wrap pri pq-c-proposal">
                  <Link href={`/dashboard/proposals/${r.id}/`} className="lx-rowlink pq-headline" title={r.headline}>
                    {r.headline}
                  </Link>
                  <div className="pq-meta pq-sub pq-subline" title={r.subline}>{r.subline}</div>
                  <div className="pq-meta pq-activity-line" title={r.activityLine}>{r.activityLine}</div>
                </td>
                <td className="wrap pq-client pq-c-client" data-label="Client" title={r.client}>{r.client}</td>
                <td className="wrap pq-c-status" data-label="Status">
                  <div className="pq-cell">
                  <Pill tone={r.statusTone}>{r.statusLabel}</Pill>
                  {r.statusSub && <div className="pq-meta pq-sub pq-status-sub" title={r.statusSub}>{r.statusSub}</div>}
                  {r.expires && r.expires !== "—" && <div className="pq-meta pq-sub pq-exp-inline">{/^(Signed|Expired) /.test(r.expires) ? r.expires : <>Expires{" "}{r.expires}</>}</div>}
                  </div>
                </td>
                <td className="wrap pq-c-response" data-label="Client response">
                  <div className="pq-cell">
                  <div className="pq-accepted" data-accepted={r.accepted === "Not yet" ? "no" : "yes"}>{r.accepted}</div>
                  {r.opens && r.opens.text !== "—" ? <OpensLine opens={r.opens} /> : null}
                  {r.paidCell.kind !== "none" && (
                    <div className="pq-c-paid">
                      <PaidCell proposalId={r.id} cell={r.paidCell} />
                    </div>
                  )}
                  </div>
                </td>
                <td className="num pq-c-fees" data-label="Fees">
                  <div className="pq-cell">
                  <div className="pq-fee pq-fee-signing"><span className="pq-fee-n">{formatMoney(r.atSigningCents)}</span>{" "}<span className="pq-fee-l">at signing</span></div>
                  {r.atFilingCents !== null && (
                    <div className="pq-fee pq-fee-filing"><span className="pq-fee-n">{formatMoney(r.atFilingCents)}</span>{" "}<span className="pq-fee-l">at filing</span></div>
                  )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </SheetTable>
      </SheetScroll>
      <div className="pq-foot">
        <span>{footerLeft}</span>
        <span className="pq-foot-right">
          <span>{footerRight}</span>
          {anyMarkPaid && <span className="pq-foot-note">{MARK_PAID_NOTE}</span>}
        </span>
      </div>
    </SheetCard>
  );
}
