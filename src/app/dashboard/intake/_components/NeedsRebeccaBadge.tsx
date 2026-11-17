import type { LeadPendingApproval } from "@/lib/intake/pending-approvals";
import { needsRebeccaLabel, needsRebeccaTitle } from "@/lib/intake/needs-rebecca";
import { Pill } from "@/components/ui/Pill";
import { MEANING_TONE } from "@/lib/ui/tones";

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
    <Pill tone={MEANING_TONE.needsPerson} title={needsRebeccaTitle(pending)}>
      {needsRebeccaLabel(pending.length)}
    </Pill>
  );
}
