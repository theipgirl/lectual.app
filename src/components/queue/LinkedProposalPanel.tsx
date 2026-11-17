import Link from "next/link";
import { APPROVE_PROPOSAL_FIRST, type LinkedPanel } from "@/lib/consult-proposal/link";
import { statusLabel, statusTone } from "@/lib/proposal-editor/labels";
import { Notice } from "@/components/ui/Notice";
import { Pill } from "@/components/ui/Pill";
import { formatMoney } from "@/lib/ui/format";
import { ProposalCard } from "@/components/proposal-editor/ProposalCard";

/**
 * The proposal that travels with a consult-agent email. The email may be
 * approved only by a named proposal approver and only once the proposal is
 * approved (the server action enforces it; this panel says so up front).
 */
export function LinkedProposalPanel({ panel, pending }: { panel: LinkedPanel; pending: boolean }) {
  if (panel.status === "none") return null;
  if (panel.status === "unavailable") {
    return (
      <Notice tone="warn" role="status" title="Linked proposal">
        <span>This email goes with a proposal, but it couldn&apos;t be loaded. Approving is paused until it can be read.</span>
      </Notice>
    );
  }
  const p = panel.proposal;
  const readyNote =
    p.status === "sent"
      ? "The proposal's link is live. Approving this email puts it in your mailbox as a draft. Nothing is sent."
      : p.status === "approved"
        ? "The proposal is saved. Approving this email turns its link on and puts the email in your mailbox as a draft. Nothing is sent."
        : null;
  return (
    <>
      {p.card && <ProposalCard card={p.card} />}
      <section className="lx-card lx-linked" aria-label="Linked proposal">
        <div className="lx-label">Linked proposal</div>
        <div className="lx-queue-filters">
          <Pill tone={statusTone(p.status)}>{statusLabel(p.status)}</Pill>
          <span className="lx-note">
            Version {p.version} · {p.clientName}
          </span>
        </div>
        {!p.card && (
          <>
            <div className="lx-meta">
              <span>Legal fee</span>
              <span className="lx-num">{formatMoney(p.legalCents)}</span>
            </div>
            <div className="lx-meta">
              <span>USPTO fees</span>
              <span className="lx-num">{formatMoney(p.govCents)}</span>
            </div>
          </>
        )}
        <div className="lx-meta">
          <span>Needs attention</span>
          <span>
            {p.errorCount === 0 && p.warningCount === 0
              ? "None"
              : [p.errorCount ? `${p.errorCount} to fix` : null, p.warningCount ? `${p.warningCount} to check` : null].filter(Boolean).join(", ")}
          </span>
        </div>
        <Link href={`/dashboard/proposals/${p.id}/`} className="lx-btn lx-btn-sec lx-btn-sm lx-linked-open">
          Open proposal
        </Link>
        {pending && (
          <p className="lx-note">
            {readyNote ?? `${APPROVE_PROPOSAL_FIRST} Only the firm's named proposal approvers can approve this email.`}
          </p>
        )}
      </section>
    </>
  );
}
