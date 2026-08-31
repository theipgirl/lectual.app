import { describe, expect, it } from "vitest";

import {
  buildCalendar,
  buildCalendarRows,
  countsFor,
  upNext,
  type CalendarRow,
  type DeadlineSourceRow,
  type ExternalEvent,
  type HearingSourceRow,
  type TaskSourceRow,
} from "@/lib/calendar/rows";
import {
  attachRows,
  buildMonthGrid,
  bucketRowsByDate,
  nextMonth,
  previousMonth,
} from "@/lib/calendar/month";
import { formatDocketDate, formatDocketDateWithYear } from "@/lib/format/date";

const TODAY = "2026-09-01";

const deadline = (over: Partial<DeadlineSourceRow> = {}): DeadlineSourceRow => ({
  id: "d1",
  matter_id: "m1",
  matter_number: "26-CC-011354",
  kind: "motion_response",
  title: "Motion response",
  due_date: "2026-09-22",
  ...over,
});

const hearing = (over: Partial<HearingSourceRow> = {}): HearingSourceRow => ({
  matter_id: "m1",
  matter_number: "26-CC-011354",
  next_hearing_at: "2026-09-04T14:00:00Z",
  next_hearing_purpose: "Pretrial conference",
  ...over,
});

const task = (over: Partial<TaskSourceRow> = {}): TaskSourceRow => ({
  id: "t1",
  matter_id: "m1",
  matter_number: "26-CC-010992",
  title: "File default, Barrios",
  due_at: "2026-09-02T16:00:00Z",
  ...over,
});

const external = (over: Partial<ExternalEvent> = {}): ExternalEvent => ({
  id: "x1",
  subject: "Client call — Nicole",
  startsAt: "2026-09-04T18:00:00Z",
  ...over,
});

describe("calendar rows — merge", () => {
  it("merges four sources into one list sorted by date", () => {
    const rows = buildCalendarRows({
      today: TODAY,
      deadlines: [deadline()],
      hearings: [hearing()],
      tasks: [task()],
      external: [external()],
    });
    expect(rows.map((r) => `${r.date} ${r.kind}`)).toEqual([
      "2026-09-02 task",
      "2026-09-04 hearing",
      "2026-09-04 external",
      "2026-09-22 deadline",
    ]);
  });

  it("renders hearings in court wall-clock with the zone named", () => {
    const [row] = buildCalendarRows({ today: TODAY, hearings: [hearing()] });
    expect(row.time).toBe("10:00 AM EDT");
    expect(row.date).toBe("2026-09-04");
  });

  it("places an instant on the court's civil date, not UTC's", () => {
    // 00:30Z on the 5th is 8:30pm Eastern on the 4th.
    const [row] = buildCalendarRows({
      today: TODAY,
      tasks: [task({ due_at: "2026-09-05T00:30:00Z" })],
    });
    expect(row.date).toBe("2026-09-04");
  });

  it("drops rows with no date rather than guessing one", () => {
    const rows = buildCalendarRows({
      today: TODAY,
      tasks: [task({ due_at: null })],
      hearings: [hearing({ next_hearing_at: null })],
    });
    expect(rows).toEqual([]);
  });

  it("bands urgency, with an overdue date overdue however far past", () => {
    const rows = buildCalendarRows({
      today: TODAY,
      deadlines: [
        deadline({ id: "old", due_date: "2025-08-18", title: "Appeal window" }),
        deadline({ id: "soon", due_date: "2026-09-04" }),
        deadline({ id: "far", due_date: "2026-11-04" }),
      ],
    });
    expect(rows.map((r) => r.urgency)).toEqual(["overdue", "soon", "later"]);
  });
});

describe("calendar rows — dedupe", () => {
  it("collapses a hearing deadline and next_hearing_at on the same matter and date", () => {
    const rows = buildCalendarRows({
      today: TODAY,
      deadlines: [
        deadline({ id: "h", kind: "hearing", title: "Hearing", due_date: "2026-09-04" }),
      ],
      hearings: [hearing()],
    });
    expect(rows).toHaveLength(1);
    // The docket row wins — it is the one the firm maintains and can satisfy —
    // and it is annotated with the time only the timestamp carried.
    expect(rows[0].kind).toBe("deadline");
    expect(rows[0].time).toBe("10:00 AM EDT");
  });

  it("does not collapse a non-hearing deadline that merely shares the date", () => {
    const rows = buildCalendarRows({
      today: TODAY,
      deadlines: [deadline({ kind: "motion_response", due_date: "2026-09-04" })],
      hearings: [hearing()],
    });
    expect(rows.map((r) => r.kind)).toEqual(["deadline", "hearing"]);
  });

  it("does not collapse a hearing on a different matter or a different day", () => {
    const rows = buildCalendarRows({
      today: TODAY,
      deadlines: [deadline({ kind: "hearing", due_date: "2026-09-04" })],
      hearings: [
        hearing({ matter_id: "m2", matter_number: "26-CC-009882" }),
        hearing({ next_hearing_at: "2026-09-11T14:00:00Z" }),
      ],
    });
    expect(rows).toHaveLength(3);
  });

  it("collapses an external event naming a matter already on that day's docket", () => {
    const rows = buildCalendarRows({
      today: TODAY,
      deadlines: [deadline({ kind: "hearing", due_date: "2026-09-04" })],
      external: [
        external({ id: "same", subject: "Hearing 26-CC-011354 — Pinellas" }),
        external({ id: "other", subject: "Client call — Nicole" }),
      ],
    });
    expect(rows.filter((r) => r.kind === "external").map((r) => r.key)).toEqual([
      "external:other",
    ]);
  });
});

describe("calendar rows — external events are never obligations", () => {
  it("never counts an external row as a deadline", () => {
    const rows = buildCalendarRows({
      today: TODAY,
      deadlines: [deadline({ id: "a", due_date: "2025-08-18" }), deadline({ id: "b" })],
      hearings: [hearing()],
      tasks: [task()],
      external: [
        external({ id: "x1" }),
        external({ id: "x2", subject: "Lunch", startsAt: "2026-09-07T16:00:00Z" }),
      ],
    });

    const counts = countsFor(rows);
    expect(counts.total).toBe(3); // two deadlines + one hearing
    expect(counts.overdue).toBe(1);
    expect(counts.uncounted).toBe(3); // one task + two external events

    // Adding external events cannot move any counted number.
    const withoutExternal = countsFor(
      buildCalendarRows({
        today: TODAY,
        deadlines: [deadline({ id: "a", due_date: "2025-08-18" }), deadline({ id: "b" })],
        hearings: [hearing()],
        tasks: [task()],
      }),
    );
    expect({ ...counts, uncounted: 0 }).toEqual({ ...withoutExternal, uncounted: 0 });
  });

  it("gives external rows no urgency band at all", () => {
    const rows = buildCalendarRows({ today: TODAY, external: [external()] });
    expect(rows[0].urgency).toBeUndefined();
  });

  it("returns EVERY internal row when the external source throws", () => {
    // The failure mode this test exists for: an expired Outlook token emptying
    // the calendar, which looks exactly like "nothing is due" — the precise
    // condition that cost this firm a pretrial conference.
    const throwing = () => {
      throw new Error("token expired");
    };

    const sources = {
      today: TODAY,
      deadlines: [deadline({ id: "a", due_date: "2025-08-18" }), deadline({ id: "b" })],
      hearings: [hearing()],
      tasks: [task()],
    };

    const healthy = buildCalendar(sources);
    const broken = buildCalendar({ ...sources, external: throwing });

    expect(broken.rows).toEqual(healthy.rows);
    expect(broken.rows).toHaveLength(4);
    expect(countsFor(broken.rows)).toEqual(countsFor(healthy.rows));
    // And the failure is loud, not silent — the UI renders a reconnect chip.
    expect(broken.externalUnavailable).toBe(true);
    expect(healthy.externalUnavailable).toBe(false);
  });

  it("defaults to no external events without pretending they failed", () => {
    const build = buildCalendar({ today: TODAY, deadlines: [deadline()] });
    expect(build.externalUnavailable).toBe(false);
    expect(build.rows).toHaveLength(1);
  });
});

describe("up next", () => {
  it("bounds the far end only and never invents an overdue-free screen", () => {
    const rows = buildCalendarRows({
      today: TODAY,
      deadlines: [
        deadline({ id: "old", due_date: "2025-08-18" }),
        deadline({ id: "in", due_date: "2026-09-08" }),
        deadline({ id: "out", due_date: "2026-10-08" }),
      ],
    });
    expect(upNext(rows, TODAY, 14).map((r) => r.key)).toEqual(["deadline:in"]);
    // The overdue row is still present in the full list the hero reads.
    expect(rows.some((r) => r.key === "deadline:old")).toBe(true);
  });
});

describe("docket date formatting", () => {
  it("always carries the weekday", () => {
    expect(formatDocketDate("2026-09-02")).toBe("Wed 2 Sep");
    expect(formatDocketDate("2026-08-18")).toBe("Tue 18 Aug");
    expect(formatDocketDateWithYear("2026-09-02")).toBe("Wed 2 Sep 2026");
  });

  it("never renders a bare numeric date, and never invents one", () => {
    expect(formatDocketDate("2026-09-02")).not.toMatch(/^\d/);
    expect(formatDocketDate(null)).toBe("—");
    expect(formatDocketDate("2026-02-30")).toBe("—");
  });
});

describe("month grid", () => {
  it("builds whole weeks with leading and trailing days flagged", () => {
    const grid = buildMonthGrid(2026, 9, TODAY);
    expect(grid.label).toBe("September 2026");
    expect(grid.weeks.every((w) => w.days.length === 7)).toBe(true);
    expect(grid.start).toBe("2026-08-30");
    expect(grid.weeks[0].days[0]).toMatchObject({ date: "2026-08-30", inMonth: false });
    expect(grid.weeks[0].days[2]).toMatchObject({ date: "2026-09-01", inMonth: true, isToday: true });
    expect(grid.weeks.flatMap((w) => w.days).filter((d) => d.inMonth)).toHaveLength(30);
  });

  it("handles a leap February and wraps months at the year boundary", () => {
    expect(
      buildMonthGrid(2028, 2, TODAY)
        .weeks.flatMap((w) => w.days)
        .filter((d) => d.inMonth),
    ).toHaveLength(29);
    expect(previousMonth(2026, 1)).toEqual({ year: 2025, month: 12 });
    expect(nextMonth(2026, 12)).toEqual({ year: 2027, month: 1 });
  });

  it("buckets rows onto their days, including the borrowed ones", () => {
    const rows: CalendarRow[] = buildCalendarRows({
      today: TODAY,
      deadlines: [
        deadline({ id: "spill", kind: "hearing", due_date: "2026-08-31" }),
        deadline({ id: "mid", due_date: "2026-09-04" }),
      ],
    });
    const buckets = bucketRowsByDate(rows);
    expect(buckets["2026-08-31"]).toHaveLength(1);

    const grid = attachRows(buildMonthGrid(2026, 9, TODAY), rows);
    const spillDay = grid.weeks[0].days.find((d) => d.date === "2026-08-31");
    expect(spillDay?.inMonth).toBe(false);
    // A deadline on a borrowed day still shows its marker — an empty corner
    // reads as "nothing there".
    expect(spillDay?.rows).toHaveLength(1);
  });
});
