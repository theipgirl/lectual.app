import Link from "next/link";
import type { LeadPendingApproval, LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import { relativeTime } from "@/lib/relative-time";

/** What a pending item is, in plain words. */
export function approvalLabel(kind: LeadPendingApproval["kind"]): string {
  if (kind === "rebecca_brief") return "Brief for the attorney";
  if (kind === "client_draft") return "Client email draft — needs approval";
  return "Draft awaiting approval";
}

/**
 * The lead page's "Waiting on attorney review" panel: this lead's pending approvals,
 * each linking to the queue item where it is reviewed. Nothing is approved or
 * sent from here.
 *
 * THREE-STATE (AGENTS.md): `ok` with nothing for this lead renders nothing (an
 * empty card is clutter); `unavailable` says the queue could not be reached and
 * that this is not an empty queue; `unconfigured` renders nothing (this firm has
 * no queue, so there is nothing for it to be waiting on).
 */
export function WaitingOnRebecca({
  leadId,
  approvals,
  now,
  bare = false,
}: {
  leadId: string;
  /** Inside the lead page's "Needs attention" card: no card of its own. */
  bare?: boolean;
  approvals: LeadPendingApprovals;
  /** The server's render clock (ms), so the ages agree with the rest of the page. */
  now: number;
}) {
  if (approvals.status === "unconfigured") return null;
  const items = approvals.status === "ok" ? (approvals.byLead[leadId] ?? []) : [];
  if (approvals.status === "ok" && items.length === 0) return null;
  const Wrapper = bare ? "div" : "section";
  const Heading = bare ? "h3" : "h2";
  return (
    <Wrapper className={bare ? undefined : "lx-card"} style={{ padding: bare ? 0 : 18, display: "grid", gap: 10 }} aria-labelledby="waiting-on-rebecca-heading">
      <Heading id="waiting-on-rebecca-heading" className={bare ? "lx-label" : "lx-h2"} style={bare ? { margin: 0 } : { fontSize: 23, margin: 0 }}>
        Waiting on attorney review
      </Heading>
      {approvals.status === "unavailable" ? (
        <p role="alert" className="lx-note" style={{ margin: 0, color: "var(--wine)" }}>
          Can&apos;t show what&apos;s waiting for approval right now. Refresh to try again.
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
    </Wrapper>
  );
}
