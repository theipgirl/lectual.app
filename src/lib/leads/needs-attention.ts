import type { LeadPendingApprovals } from "@/lib/intake/pending-approvals";

/**
 * Does the lead page's single "Needs attention" card have anything to show?
 *
 * A failed read counts: an unreachable queue or calendar is a warning the card must still draw,
 * never an empty card that reads as "nothing waiting". A calendar that simply isn't switched on
 * does not open the card by itself.
 */
export type NeedsAttentionInput = {
  leadId: string;
  consult: { status: "ok"; event: unknown | null } | { status: "database-update-needed" } | { status: "unavailable" } | null;
  approvals: LeadPendingApprovals;
  clientEmailProposals: number;
  stageSuggestions: number;
};

export function needsAttention(input: NeedsAttentionInput): boolean {
  const { consult, approvals } = input;
  if (consult?.status === "unavailable") return true;
  if (consult?.status === "ok" && consult.event) return true;
  if (approvals.status === "unavailable") return true;
  if (approvals.status === "ok" && (approvals.byLead[input.leadId] ?? []).length > 0) return true;
  return input.clientEmailProposals > 0 || input.stageSuggestions > 0;
}
