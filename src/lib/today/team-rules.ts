import { civilDaysBetween } from "@/lib/matters/calendar-rows";
import { civilInZone } from "@/lib/today/outcomes";
import { deadlineChip } from "@/lib/today/owner-rules";
import { PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
import type { Role } from "@/lib/auth/roles";

/** How many of a person's own next steps the team Today lists before "See all". */
export const TEAM_STEPS_SHOWN = 5;

/** The slice of a task row this card reads. */
export type TeamTaskInput = {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  assignee_id: string | null;
  matter_id: string | null;
  lead_id: string | null;
};

export type TeamStep = {
  id: string;
  title: string;
  href: string;
  dueDate: string | null;
  chip: { text: string; tone: "risk" | "warn" | "plain" } | null;
};

/**
 * The person's OWN open next steps: assigned to them (never to anyone else, never unassigned), open only, soonest due
 * first and undated last. Pure: the rows come from the existing scoped task read.
 */
export function teamNextSteps(tasks: readonly TeamTaskInput[], userId: string, now: Date, tz: string): TeamStep[] {
  const today = civilInZone(now, tz);
  const mine = tasks.filter((t) => t.status === "open" && t.assignee_id === userId);
  const rows = mine.map((t): TeamStep & { sort: string } => {
    const dueDate = t.due_at ? civilInZone(new Date(t.due_at), tz) : null;
    const overdueDays = dueDate ? Math.max(0, civilDaysBetween(dueDate, today)) : 0;
    return {
      id: t.id,
      title: t.title,
      href: t.matter_id ? `/dashboard/matters/${t.matter_id}/` : t.lead_id ? `/dashboard/leads/${t.lead_id}/` : "/dashboard/review/",
      dueDate,
      chip: dueDate ? deadlineChip({ dueDate, overdueDays }, today) : null,
      sort: dueDate ?? "9999-99-99",
    };
  });
  return rows.sort((a, b) => a.sort.localeCompare(b.sort)).map(({ sort: _sort, ...r }) => r);
}

/** Proposals out appear on the team Today only for a firm with the Proposals feature AND a proposal-writing role. */
export function teamSeesProposals(role: Role, hasProposals: boolean): boolean {
  return hasProposals && PROPOSAL_STAFF_WRITE_ROLES.includes(role);
}
