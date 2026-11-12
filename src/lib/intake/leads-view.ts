import { decisionOpen } from "./stage-decision";
import type { IntakeRow } from "./rows";
import type { LeadSet } from "./working";
import { leadsNeedingApproval } from "./needs-rebecca";
import type { LeadPendingApprovals } from "./pending-approvals";
import type { LeadTimeSummary, RunningSummary } from "@/lib/time";

/** Small pure rules for how the Leads page draws itself. No client, no clock. */

/** What the header calls the leads in each set. */
const NOUN: Record<LeadSet, string> = {
  working: "working leads",
  event: "event contacts",
  "not-started": "leads not started",
  open: "open leads",
  nurture: "leads in nurture",
  lost: "lost leads",
};

export const NOBODY_ASSIGNED = "Nobody is assigned yet";

/**
 * The header line: "<N> working leads · <n> need a first reply", then ONE note about owners: "Nobody is assigned yet" when
 * every lead in view is unassigned (and there is at least one), else "<u> unassigned" when some are. `rows` are the rows
 * the list underneath shows (the set after the filters).
 */
export function leadsHeaderLine(set: LeadSet, rows: readonly IntakeRow[]): string {
  const n = rows.length;
  const needFirstReply = rows.filter((r) => r.reply === "replied").length;
  const unassigned = rows.filter((r) => !r.lead.assigned_to).length;
  const parts = [`${n} ${n === 1 ? NOUN[set].replace(/s\b/, "") : NOUN[set]}`, `${needFirstReply} need a first reply`];
  if (n > 0 && unassigned === n) parts.push(NOBODY_ASSIGNED);
  else if (unassigned > 0) parts.push(`${unassigned} unassigned`);
  return parts.join(" · ");
}

/** The Owner column is drawn only when some lead in view has an owner. */
export function ownerColumnShown(rows: readonly IntakeRow[]): boolean {
  return rows.some((r) => !!r.lead.assigned_to);
}

/**
 * The time chip on a row or card: only when time was logged on the lead this week, or the caller's timer is running on
 * it. Starting a timer and adding time live in the row menu.
 */
export function showTimeChip(summary: LeadTimeSummary | undefined, running: RunningSummary | null, leadId: string): boolean {
  return (summary?.seconds ?? 0) > 0 || running?.leadId === leadId;
}

export type ChipCounts = {
  /** null = the source was not read (the chip is not offered). */
  decision: number | null;
  needsAttorney: number | null;
  suggestions: number;
  agent: { today: number; week: number } | null;
};

/**
 * The counts beside the secondary chips, computed over the rows of the CHOSEN SET (before the other filters), so
 * "Needs a stage decision 117" can never sit beside "Working 32".
 */
export function chipCountsWithin(
  setRows: readonly IntakeRow[],
  reads: { approvals: LeadPendingApprovals | undefined; decisionsRead: boolean; agentRead: boolean },
): ChipCounts {
  const needing = leadsNeedingApproval(reads.approvals);
  return {
    decision: reads.decisionsRead ? setRows.filter((r) => decisionOpen(r.decision, r.lead.current_stage_id)).length : null,
    needsAttorney: reads.approvals?.status === "ok" ? setRows.filter((r) => needing.has(r.lead.id)).length : null,
    suggestions: setRows.filter((r) => r.temperature.suggestion === "long_term_nurture").length,
    agent: reads.agentRead ? { today: setRows.filter((r) => r.agentMove?.today).length, week: setRows.filter((r) => r.agentMove).length } : null,
  };
}

/** The "Needs a stage" marker's tooltip: the Lawmatics stage text, read-only, or the plain reason. */
export function needsStageTitle(flag: { lawmaticsStage: string | null; hired: boolean }): string {
  if (flag.hired) return "Hired in Lawmatics. Open a matter for this person.";
  return flag.lawmaticsStage ? `Imported from Lawmatics, stage: ${flag.lawmaticsStage}. Nobody has chosen its stage here yet.` : "Imported from Lawmatics. Nobody has chosen its stage here yet.";
}
