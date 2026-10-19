import type { LeadPendingApproval } from "@/lib/intake/pending-approvals";
import { needsRebeccaLabel, needsRebeccaTitle } from "@/lib/intake/needs-rebecca";

/**
 * "Needs Rebecca · N": this lead has drafts sitting in the approval queue for
 * her review. The tooltip lists the headlines, one per line.
 *
 * Informational only — it does not open, approve or send anything; the queue
 * stays the one place a draft is resolved. Renders nothing for an empty list,
 * so callers can pass `pendingFor(...)` without a guard.
 */
export default function NeedsRebeccaBadge({ pending }: { pending: LeadPendingApproval[] }) {
  if (pending.length === 0) return null;
  return (
    <span
      className="intake-mono"
      title={needsRebeccaTitle(pending)}
      style={{
        flex: "0 0 auto",
        fontSize: 10,
        padding: "2px 6px",
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
