"use client";

import { markPaidAction, undoPaidAction } from "@/app/dashboard/proposals/[id]/paid-actions";
import { ActionForm, Outcome } from "@/components/proposal-editor/ActionForm";
import { MARK_PAID_NOTE, type PaidCellView } from "@/lib/proposals/list-rows";

/**
 * The Paid column of a row: "-" for a row that is not accepted, "Paid Oct 21 · Undo", "Not paid · Mark paid" (with a note
 * on how to confirm), or "Paid status couldn't be read" with no button (never "Not paid" for a failed read).
 *
 * Mark paid and Undo are the proposal page's own actions (`markPaidAction`, `undoPaidAction`, each gated on its own to the
 * roles in PROPOSAL_PAID_ROLES); a role outside them sees the text and no button. This is a stopgap: paid is marked by
 * hand until the firm's LawPay connection takes payment on the proposal, and then the paid state comes from that payment.
 */
export function PaidCell({ proposalId, cell }: { proposalId: string; cell: PaidCellView }) {
  if (cell.kind === "none") return <span className="pq-paid-none">{cell.text}</span>;
  if (cell.kind === "unreadable") {
    return (
      <span className="pq-paid-text" data-paid="unreadable" role="status">
        {cell.text}
      </span>
    );
  }
  const paid = cell.kind === "paid";
  const allowed = paid ? cell.canUndo : cell.canMark;
  return (
    <div className="pq-paid" data-paid={paid ? "paid" : "not_paid"}>
      <span className="pq-paid-text" title={paid ? cell.title : undefined}>
        {cell.text}
      </span>
      {allowed && (
        <ActionForm action={paid ? undoPaidAction : markPaidAction} className="pq-paid-form">
          {({ state, pending }) => (
            <>
              <input type="hidden" name="proposalId" value={proposalId} />
              <span className="pq-paid-act">
                <span aria-hidden="true">{"·"}</span>
                <button type="submit" className={`lx-btn lx-btn-sm ${paid ? "lx-btn-ghost" : "lx-btn-sec"}`} disabled={pending}>
                  {pending ? (paid ? "Undoing…" : "Marking…") : paid ? "Undo" : "Mark paid"}
                </button>
              </span>
              {!paid && <span className="lx-note pq-paid-note">{MARK_PAID_NOTE}</span>}
              <Outcome state={state} pending={pending} />
            </>
          )}
        </ActionForm>
      )}
    </div>
  );
}
