import type { LeadPendingApproval } from "@/lib/intake/pending-approvals";
import { needsRebeccaLabel, needsRebeccaTitle } from "@/lib/intake/needs-rebecca";

/**
 * "Needs attorney · N": this lead has drafts sitting in the approval queue for
 * an attorney's review. The tooltip lists the headlines, one per line.
 *
 * Informational only — it does not open, approve or send anything; the queue
 * stays the one place a draft is resolved. Renders nothing for an empty list,
 * so callers can pass `pendingFor(...)` without a guard.
 */
export default function NeedsRebeccaBadge({ pending }: { pending: LeadPendingApproval[] }) {
  if (pending.length === 0) return null;
  return (
    <span
      title={needsRebeccaTitle(pending)}
      style={{
        flex: "0 0 auto",
        fontSize: "var(--lp-meta, 13px)",
        lineHeight: 1.4,
        padding: "1px 7px",
        borderRadius: 4,
        background: "var(--critbg)",
        color: "var(--crit)",
        whiteSpace: "nowrap",
      }}
    >
      {needsRebeccaLabel(pending.length)}
    </span>
  );
}
