import Link from "next/link";
import type { LeadPendingApproval, LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import { relativeTime } from "@/lib/relative-time";

/** What a pending item is, in Rebecca's words. */
export function approvalLabel(kind: LeadPendingApproval["kind"]): string {
  if (kind === "rebecca_brief") return "Brief for Rebecca";
  if (kind === "client_draft") return "Client email draft — needs approval";
  return "Draft awaiting approval";
}

/**
 * The lead page's "Waiting on Rebecca" panel: this lead's pending approvals,
 * each linking to the queue item where it is reviewed. Nothing is approved or
 * sent from here.
 *
 * THREE-STATE (AGENTS.md): `ok` with nothing for this lead says so;
 * `unavailable` says the queue could not be reached and that this is not an
 * empty queue; `unconfigured` renders nothing (this firm has no queue, so
 * there is nothing for it to be waiting on).
 */
export function WaitingOnRebecca({
  leadId,
  approvals,
  now,
}: {
  leadId: string;
  approvals: LeadPendingApprovals;
  /** The server's render clock (ms), so the ages agree with the rest of the page. */
  now: number;
}) {
  if (approvals.status === "unconfigured") return null;
  const items = approvals.status === "ok" ? (approvals.byLead[leadId] ?? []) : [];
  return (
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 10 }} aria-labelledby="waiting-on-rebecca-heading">
      <h2 id="waiting-on-rebecca-heading" className="lx-h2" style={{ fontSize: 23, margin: 0 }}>
        Waiting on Rebecca
      </h2>
      {approvals.status === "unavailable" ? (
        <p role="alert" className="lx-note" style={{ margin: 0, color: "var(--wine)" }}>
          Couldn&apos;t reach the approval queue — this isn&apos;t an empty queue.
        </p>
      ) : items.length === 0 ? (
        <p className="lx-note" style={{ margin: 0 }}>
          No queued drafts linked to this lead. A draft the queue can&apos;t tie to a lead still shows on the{" "}
          <Link href="/dashboard/queue/">approval queue</Link>.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
          {items.map((a) => (
            <li key={a.queueId} style={{ display: "grid", gap: 4, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className={`lx-pill ${a.kind === "other" ? "lx-pill-mute" : "lx-pill-warn"}`}>{approvalLabel(a.kind)}</span>
                {a.createdAt && <span className="lx-note">queued {relativeTime(a.createdAt, now)}</span>}
              </div>
              <Link href={`/dashboard/queue/${encodeURIComponent(a.queueId)}/`} style={{ fontWeight: 500, color: "var(--ink)" }}>
                {a.headline}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
