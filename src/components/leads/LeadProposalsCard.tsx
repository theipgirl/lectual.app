import Link from "next/link";
import type { ProposalListItem } from "@/lib/proposals/store";
import { statusLabel, statusTone } from "@/lib/proposal-editor/labels";
import { formatCents } from "@/lib/quotes/money";
import { ProposalFromTranscript } from "./ProposalFromTranscript";

/**
 * The lead's client proposals: each family's newest version, a link to start a
 * new one, and (when the model is set up) "draft from a transcript". The read
 * is three-state: a failed read says so rather than showing "none yet".
 */
export function LeadProposalsCard({
  leadId,
  read,
  canWrite,
  canDraft,
  maxChars,
}: {
  leadId: string;
  read: { status: "ok"; proposals: ProposalListItem[] } | { status: "unavailable" };
  canWrite: boolean;
  /** The model is configured: the paste form is offered. */
  canDraft: boolean;
  maxChars: number;
}) {
  return (
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }} aria-labelledby="lead-proposals-title">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <h2 id="lead-proposals-title" className="lx-h2" style={{ fontSize: 23 }}>
          Client proposal
        </h2>
        {canWrite && (
          <Link href={`/dashboard/proposals/new/?lead=${leadId}`} className="lx-btn lx-btn-sec lx-btn-sm">
            New proposal
          </Link>
        )}
      </div>
      {read.status === "unavailable" ? (
        <p className="lx-note" style={{ margin: 0 }}>Proposals couldn&apos;t be loaded just now.</p>
      ) : read.proposals.length === 0 ? (
        <p className="lx-note" style={{ margin: 0 }}>No proposal for this lead yet.</p>
      ) : (
        <ul className="lx-list" style={{ margin: 0 }}>
          {read.proposals.map((p) => (
            <li key={p.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              <Link href={`/dashboard/proposals/${p.id}/`}>{p.title}</Link>
              <span className={`lx-pill lx-pill-${statusTone(p.status)}`}>{statusLabel(p.status)}</span>
              <span className="lx-note">
                v{p.version} · {formatCents(p.legal_total_cents)} legal · {formatCents(p.gov_total_cents)} USPTO
                {p.source === "agent" ? " · drafted by the consult agent" : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canWrite && canDraft && (
        <details className="lx-disclosure">
          <summary>Draft from a transcript</summary>
          <div style={{ padding: "12px 0 0" }}>
            <ProposalFromTranscript leadId={leadId} maxChars={maxChars} />
          </div>
        </details>
      )}
    </section>
  );
}
