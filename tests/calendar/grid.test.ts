import { describe, expect, it } from "vitest";
import {
  addMonths,
  isCivilDate,
  monthGrid,
  parseCalendarView,
  shortTime,
  startOfWeek,
  stepAnchor,
  viewRange,
  viewTitle,
  weekGrid,
  zonedParts,
  type CalendarItem,
} from "@/lib/calendar/grid";

const item = (over: Partial<CalendarItem>): CalendarItem => ({
  key: "k",
  date: "2026-09-09",
  time: null,
  title: "Item",
  detail: null,
  href: null,
  kind: "deadline",
  overdue: false,
  unconfirmed: false,
  ...over,
});

describe("calendar grid", () => {
  it("covers a month in whole Sunday-first weeks", () => {
    const weeks = monthGrid("2026-09-15", "2026-09-27", []);
    expect(weeks).toHaveLength(5);
    expect(weeks[0][0].date).toBe("2026-08-30");
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[4][6].date).toBe("2026-10-03");
    expect(weeks.flat().find((d) => d.date === "2026-09-27")?.isToday).toBe(true);
  });

  it("uses six rows when the month needs them", () => {
    expect(monthGrid("2026-08-01", "2026-08-01", [])).toHaveLength(6);
  });

  it("puts items on their civil date, timed ones first in time order", () => {
    const week = weekGrid("2026-09-09", "2026-09-09", [
      item({ key: "a", title: "Deadline" }),
      item({ key: "b", kind: "event", time: "14:00", title: "Late call" }),
      item({ key: "c", kind: "event", time: "09:30", title: "Early call" }),
      item({ key: "d", date: "2026-09-10", kind: "task", title: "Task" }),
    ]);
    const wed = week.find((d) => d.date === "2026-09-09")!;
    expect(wed.items.map((i) => i.key)).toEqual(["c", "b", "a"]);
    expect(week.find((d) => d.date === "2026-09-10")!.items).toHaveLength(1);
    expect(week[0].date).toBe("2026-09-06");
  });

  it("steps and ranges by view", () => {
    expect(stepAnchor("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(stepAnchor("week", "2026-09-09", -1)).toBe("2026-08-30");
    expect(viewRange("week", "2026-09-09")).toEqual({ from: "2026-09-06", to: "2026-09-12" });
    expect(viewRange("month", "2026-09-15")).toEqual({ from: "2026-08-30", to: "2026-10-03" });
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(startOfWeek("2026-09-06")).toBe("2026-09-06");
  });

  it("titles views", () => {
    expect(viewTitle("month", "2026-09-15")).toBe("September 2026");
    expect(viewTitle("week", "2026-09-09")).toBe("Sep 6 – 12, 2026");
    expect(viewTitle("week", "2026-09-29")).toBe("Sep 27 – Oct 3, 2026");
  });

  it("reads events in the firm's time zone, not the server's", () => {
    // 02:30 UTC on the 10th is still the evening of the 9th in New York.
    expect(zonedParts("2026-09-10T02:30:00Z", "America/New_York")).toEqual({ date: "2026-09-09", time: "22:30" });
    expect(zonedParts("2026-09-10T02:30:00Z", "Europe/London")).toEqual({ date: "2026-09-10", time: "03:30" });
  });

  it("validates input", () => {
    expect(isCivilDate("2026-02-30")).toBe(false);
    expect(isCivilDate("2026-02-28")).toBe(true);
    expect(isCivilDate("nope")).toBe(false);
    expect(parseCalendarView("week")).toBe("week");
    expect(parseCalendarView("year")).toBe("month");
    expect(shortTime("09:30")).toBe("9:30a");
    expect(shortTime("12:00")).toBe("12p");
    expect(shortTime("00:15")).toBe("12:15a");
  });
});
