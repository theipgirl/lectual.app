import { describe, it, expect } from "vitest";
import {
  buildCalendarRows,
  groupCalendarRows,
  civilDate,
  civilDaysBetween,
  taskHref,
  type CalendarRow,
} from "@/lib/matters/calendar-rows";
import type { UpcomingDeadline } from "@/lib/matters/deadlines";
import type { Task } from "@/lib/matters/tasks";

const NOW = new Date("2026-08-21T12:00:00Z");
const DAY = 86_400_000;

/** Civil date (YYYY-MM-DD) `offset` days from NOW, in NOW's UTC calendar
 * day — the fixtures below are built in UTC so this stays predictable
 * regardless of the machine's local timezone. */
function civil(offset: number): string {
  const d = new Date(NOW.getTime() + offset * DAY);
  return d.toISOString().slice(0, 10);
}

function deadline(overrides: Partial<UpcomingDeadline> = {}): UpcomingDeadline {
  return {
    id: "dl-1",
    org_id: "org-1",
    matter_id: "matter-1",
    kind: "office_action_response",
    title: null,
    due_date: civil(5),
    anchor_event: null,
    anchor_date: null,
    source: "calculated",
    calculation_basis: null,
    is_extendable: true,
    max_extensions: 1,
    extensions_used: 0,
    notes: null,
    status: "open",
    attorney_confirmed: false,
    confirmed_by: null,
    confirmed_at: null,
    satisfied_at: null,
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    matter_number: "RPB-0001",
    matter_title: "Trademark — Doe Studio",
    ...overrides,
  } as UpcomingDeadline;
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-1",
    org_id: "org-1",
    lead_id: null,
    matter_id: "matter-1",
    title: "Follow up with client",
    type: "custom",
    status: "open",
    due_at: `${civil(2)}T00:00:00.000Z`,
    assignee_id: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Task;
}

describe("civilDate / civilDaysBetween", () => {
  it("formats a Date as a timezone-free YYYY-MM-DD civil date", () => {
    expect(civilDate(new Date("2026-08-21T23:00:00"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("counts whole days between two civil dates", () => {
    expect(civilDaysBetween("2026-08-21", "2026-08-24")).toBe(3);
    expect(civilDaysBetween("2026-08-24", "2026-08-21")).toBe(-3);
    expect(civilDaysBetween("2026-08-21", "2026-08-21")).toBe(0);
  });
});

describe("taskHref", () => {
  it("links to the matter when the task has one", () => {
    expect(taskHref(task({ matter_id: "m-9", lead_id: null }))).toBe("/dashboard/matters/m-9");
  });
  it("falls back to the lead when there's no matter", () => {
    expect(taskHref(task({ matter_id: null, lead_id: "l-9" }))).toBe("/dashboard/leads/l-9");
  });
  it("falls back to the matters list when neither is set", () => {
    expect(taskHref(task({ matter_id: null, lead_id: null }))).toBe("/dashboard/matters");
  });
});

describe("buildCalendarRows — the merge behind Ops Home + the Calendar page", () => {
  it("merges deadlines and tasks into one list, soonest due date first", () => {
    const rows = buildCalendarRows(
      [deadline({ id: "dl-1", due_date: civil(5) })],
      [task({ id: "t-1", due_at: `${civil(1)}T00:00:00.000Z` })],
      NOW,
    );
    expect(rows.map((r) => r.key)).toEqual(["t-t-1", "d-dl-1"]);
  });

  it("flags past-due rows as OVERDUE via overdueDays rather than dropping them", () => {
    const rows = buildCalendarRows(
      [deadline({ id: "dl-1", due_date: civil(-3) })],
      [],
      NOW,
    );
    expect(rows[0].overdueDays).toBe(3);
  });

  it("excludes tasks with no due date — they don't belong on a calendar", () => {
    const rows = buildCalendarRows([], [task({ id: "t-no-due", due_at: null })], NOW);
    expect(rows).toEqual([]);
  });

  it("labels a deadline row with its title (falling back to the kind label) and matter detail", () => {
    const rows = buildCalendarRows(
      [deadline({ id: "dl-1", title: null, kind: "statement_of_use", matter_number: "RPB-0007", matter_title: "SOU Co" })],
      [],
      NOW,
    );
    expect(rows[0].detail).toBe("RPB-0007 · SOU Co");
    expect(rows[0].name.length).toBeGreaterThan(0);
  });

  it("links a deadline row to its matter and a task row to taskHref's result", () => {
    const rows = buildCalendarRows(
      [deadline({ id: "dl-1", matter_id: "m-1" })],
      [task({ id: "t-1", matter_id: "m-2", lead_id: null })],
      NOW,
    );
    const deadlineRow = rows.find((r) => r.source === "deadline")!;
    const taskRow = rows.find((r) => r.source === "task")!;
    expect(deadlineRow.href).toBe("/dashboard/matters/m-1");
    expect(taskRow.href).toBe("/dashboard/matters/m-2");
  });
});

describe("groupCalendarRows — the Calendar page's agenda sections", () => {
  it("buckets rows into Overdue / Today / Tomorrow / This week / Later", () => {
    const rows: CalendarRow[] = buildCalendarRows(
      [
        deadline({ id: "overdue", due_date: civil(-2) }),
        deadline({ id: "today", due_date: civil(0) }),
        deadline({ id: "tomorrow", due_date: civil(1) }),
        deadline({ id: "this-week", due_date: civil(4) }),
        deadline({ id: "later", due_date: civil(30) }),
      ],
      [],
      NOW,
    );
    const groups = groupCalendarRows(rows, NOW);
    const labelFor = (key: string) => groups.find((g) => g.rows.some((r) => r.key === `d-${key}`))?.label;

    expect(labelFor("overdue")).toBe("Overdue");
    expect(labelFor("today")).toBe("Today");
    expect(labelFor("tomorrow")).toBe("Tomorrow");
    expect(labelFor("this-week")).toBe("This week");
    expect(labelFor("later")).toBe("Later");
  });

  it("omits empty sections rather than rendering them blank", () => {
    const rows = buildCalendarRows([deadline({ id: "only-one", due_date: civil(0) })], [], NOW);
    const groups = groupCalendarRows(rows, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Today");
  });

  it("returns no groups for an empty row list", () => {
    expect(groupCalendarRows([], NOW)).toEqual([]);
  });

  it("puts an overdue row in Overdue even though its date also falls in a later week", () => {
    // due_date far in the past — well outside "this week" by date, but the
    // rule is: overdue always wins over date-bucketing.
    const rows = buildCalendarRows([deadline({ id: "old", due_date: civil(-40) })], [], NOW);
    const groups = groupCalendarRows(rows, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("overdue");
  });
});
