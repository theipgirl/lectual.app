import type { LeadPendingApproval, LeadPendingApprovals } from "./pending-approvals";

/**
 * Pure helpers behind the "Needs attorney" badge and filter on /intake. No
 * server imports — see scope.ts's header for why that matters here.
 *
 * The approvals read has three states plus "not passed at all", and none of the
 * last three may ever look like "nobody needs an attorney": only an `ok` read can
 * say that. Every helper below therefore returns "nothing to show" for
 * undefined / unconfigured / unavailable, and `approvalsShown` is the one place
 * the caller asks whether the badge and the filter are allowed to render.
 */

/** True only when the queue was actually read — the one state that may badge or filter. */
export function approvalsShown(
  approvals: LeadPendingApprovals | undefined,
): approvals is Extract<LeadPendingApprovals, { status: "ok" }> {
  return approvals?.status === "ok";
}

/** The pending drafts for one lead; empty for no lead entry or a queue we couldn't read. */
export function pendingFor(
  approvals: LeadPendingApprovals | undefined,
  leadId: string,
): LeadPendingApproval[] {
  if (!approvalsShown(approvals)) return [];
  return approvals.byLead[leadId] ?? [];
}

/** Ids of every lead with at least one pending draft. Empty unless the read was ok. */
export function leadsNeedingApproval(approvals: LeadPendingApprovals | undefined): Set<string> {
  const ids = new Set<string>();
  if (!approvalsShown(approvals)) return ids;
  for (const [leadId, list] of Object.entries(approvals.byLead)) {
    if (list.length > 0) ids.add(leadId);
  }
  return ids;
}

/**
 * Applies the "Needs Rebecca" toggle. When the queue read isn't ok the toggle is
 * ignored and the rows come back untouched: filtering to an empty set would read
 * as "nothing is waiting on her" when we simply couldn't look.
 */
export function filterNeedsRebecca<T extends { lead: { id: string } }>(
  rows: T[],
  approvals: LeadPendingApprovals | undefined,
  on: boolean,
): T[] {
  if (!on || !approvalsShown(approvals)) return rows;
  const needing = leadsNeedingApproval(approvals);
  return rows.filter((row) => needing.has(row.lead.id));
}

/** "Needs attorney · 2" (role-neutral: every firm sees this, not one firm's attorney). */
export function needsRebeccaLabel(count: number): string {
  return `Needs attorney · ${count}`;
}

/** Tooltip text: one headline per line, blank headlines named rather than dropped. */
export function needsRebeccaTitle(pending: LeadPendingApproval[]): string {
  return pending.map((item) => item.headline.trim() || "Draft waiting for review").join("\n");
}
