import Link from "next/link";
import type { LinkedPanel } from "@/lib/consult-proposal/link";
import { statusLabel, statusTone } from "@/lib/proposal-editor/labels";
import { formatCents } from "@/lib/quotes/money";

/**
 * The proposal that travels with a consult-agent email. The email may be
 * approved only by a named proposal approver and only once the proposal is
 * approved (the server action enforces it; this panel says so up front).
 */
export function LinkedProposalPanel({ panel, pending }: { panel: LinkedPanel; pending: boolean }) {
  if (panel.status === "none") return null;
  if (panel.status === "unavailable") {
    return (
      <div role="status" className="lx-banner lx-banner-warn" style={{ display: "grid", gap: 4 }}>
        <strong>Linked proposal</strong>
        <span>This email goes with a proposal, but it couldn&apos;t be loaded. Approving is paused until it can be read.</span>
      </div>
    );
  }
  const p = panel.proposal;
  const ready = p.status === "approved" || p.status === "sent";
  return (
    <section className="lx-card" style={{ padding: 14, display: "grid", gap: 8 }} aria-label="Linked proposal">
      <div className="lx-label" style={{ fontSize: 11 }}>
        Linked proposal
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className={`lx-pill lx-pill-${statusTone(p.status)}`}>{statusLabel(p.status)}</span>
        <span className="lx-note" style={{ margin: 0 }}>
          Version {p.version} · {p.clientName}
        </span>
      </div>
      <div className="lx-meta">
        <span>Legal fee</span>
        <span className="lx-num">{formatCents(p.legalCents)}</span>
      </div>
      <div className="lx-meta">
        <span>USPTO fees</span>
        <span className="lx-num">{formatCents(p.govCents)}</span>
      </div>
      <div className="lx-meta">
        <span>Needs attention</span>
        <span>
          {p.errorCount === 0 && p.warningCount === 0
            ? "None"
            : [p.errorCount ? `${p.errorCount} to fix` : null, p.warningCount ? `${p.warningCount} to check` : null].filter(Boolean).join(", ")}
        </span>
      </div>
      <Link href={`/dashboard/proposals/${p.id}/`} className="lx-btn lx-btn-sec lx-btn-sm" style={{ justifySelf: "start" }}>
        Open proposal
      </Link>
      {pending && (
        <p className="lx-note" style={{ margin: 0 }}>
          {ready
            ? "The proposal is approved. Approving this email makes the client's link live and puts the email in your mailbox as a draft. Nothing is sent."
            : "Approve the proposal first: open it, review it, and click Approve. Only the firm's named proposal approvers can approve this email."}
        </p>
      )}
    </section>
  );
}
