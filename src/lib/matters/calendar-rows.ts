import { deadlineKindLabel } from "./deadline-rules";
import type { UpcomingDeadline } from "./deadlines";
import type { Task } from "./tasks";

/**
 * Docket deadline + task due-date merge — the ONE calendar-shaped list this
 * app can honestly build today. There is no external-calendar or
 * consult-booking source wired into the dashboard (no Microsoft Graph /
 * Lawmatics event-booking integration, and crm_discovery_session only holds
 * retrospective started_at/ended_at for sessions that already happened) — so
 * this merges exactly two sources: crm_matter_deadline (listUpcomingDeadlines)
 * and crm_task due dates (listTasks). Both the Ops Home "Deadlines" card and
 * the Calendar page read through this module so there is exactly one place
 * that turns those two reads into one sorted, honestly-labelled list.
 */

const MS_PER_DAY = 86_400_000;

/** Civil (calendar) date of a Date in local time — docket dates are civil
 * dates with no time of day, so comparing them through Date objects would
 * introduce a timezone the docket never had. */
export function civilDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** Whole days between two civil dates (b - a), timezone-free. */
export function civilDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY);
}

/** Where a task's row should link — its matter if it has one, else its lead,
 * else the matters list as a last resort. */
export function taskHref(task: Task): string {
  if (task.matter_id) return `/dashboard/matters/${task.matter_id}`;
  if (task.lead_id) return `/dashboard/leads/${task.lead_id}`;
  return "/dashboard/matters";
}

/** One line in a calendar-shaped list — a docket date or a task due date. */
export type CalendarRow = {
  key: string;
  href: string;
  name: string;
  detail: string;
  /** Civil date, YYYY-MM-DD, for grouping/sorting and display. */
  dueDate: string;
  /** 0 when not yet due; days past due otherwise. */
  overdueDays: number;
  source: "deadline" | "task";
};

/**
 * Merges open docket deadlines and task due dates into one sorted list,
 * soonest first. Past-due entries are INCLUDED and flagged via `overdueDays`
 * rather than dropped — hiding a blown date would be the worst possible
 * kindness (see listUpcomingDeadlines). Tasks with no due_at are excluded
 * (they don't belong on a calendar).
 */
export function buildCalendarRows(
  deadlines: UpcomingDeadline[],
  tasks: Task[],
  now: Date = new Date(),
): CalendarRow[] {
  const todayCivil = civilDate(now);

  const rows: CalendarRow[] = [
    ...deadlines.map((d): CalendarRow => ({
      key: `d-${d.id}`,
      href: `/dashboard/matters/${d.matter_id}`,
      name: d.title ?? deadlineKindLabel(d.kind),
      detail: [d.matter_number, d.matter_title].filter(Boolean).join(" · ") || "Docket",
      dueDate: d.due_date,
      overdueDays: Math.max(0, civilDaysBetween(d.due_date, todayCivil)),
      source: "deadline",
    })),
    ...tasks
      .filter((t): t is Task & { due_at: string } => Boolean(t.due_at))
      .map((t): CalendarRow => {
        const dueDate = civilDate(new Date(t.due_at));
        return {
          key: `t-${t.id}`,
          href: taskHref(t),
          name: t.title,
          detail: `Task · ${t.type}`,
          dueDate,
          overdueDays: Math.max(0, civilDaysBetween(dueDate, todayCivil)),
          source: "task",
        };
      }),
  ];

  return rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** One date-header section of an agenda view. */
export type CalendarRowGroup = {
  key: string;
  label: string;
  rows: CalendarRow[];
};

/**
 * Buckets an already-sorted CalendarRow list into agenda sections —
 * Overdue / Today / Tomorrow / This week / Later — the grouping the
 * Calendar page's agenda view renders. Overdue always wins regardless of
 * `dueDate` bucket, matching the rest of the app's rule that a blown date is
 * never hidden inside a quieter section. Empty sections are omitted.
 */
export function groupCalendarRows(
  rows: CalendarRow[],
  now: Date = new Date(),
): CalendarRowGroup[] {
  const todayCivil = civilDate(now);
  const tomorrowCivil = civilDate(new Date(now.getTime() + MS_PER_DAY));
  const weekEndCivil = civilDate(new Date(now.getTime() + 7 * MS_PER_DAY));

  const buckets: Record<"overdue" | "today" | "tomorrow" | "week" | "later", CalendarRow[]> = {
    overdue: [],
    today: [],
    tomorrow: [],
    week: [],
    later: [],
  };

  for (const row of rows) {
    if (row.overdueDays > 0) buckets.overdue.push(row);
    else if (row.dueDate === todayCivil) buckets.today.push(row);
    else if (row.dueDate === tomorrowCivil) buckets.tomorrow.push(row);
    else if (row.dueDate <= weekEndCivil) buckets.week.push(row);
    else buckets.later.push(row);
  }

  return (
    [
      { key: "overdue", label: "Overdue", rows: buckets.overdue },
      { key: "today", label: "Today", rows: buckets.today },
      { key: "tomorrow", label: "Tomorrow", rows: buckets.tomorrow },
      { key: "week", label: "This week", rows: buckets.week },
      { key: "later", label: "Later", rows: buckets.later },
    ] satisfies CalendarRowGroup[]
  ).filter((group) => group.rows.length > 0);
}
