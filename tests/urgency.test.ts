import { describe, expect, it } from "vitest";
import {
  SOON_HORIZON_DAYS,
  URGENCY_BANDS,
  addCivilDays,
  allBands,
  civilDaysBetween,
  civilToday,
  civilWeekday,
  countByUrgency,
  daysUntil,
  deadlineBand,
  groupByUrgency,
  isCivilDate,
  isOverdue,
  sortByUrgency,
  urgencyBand,
  urgencyLabel,
  urgencyPhrase,
} from "@/lib/deadlines/urgency";

const TODAY = "2026-09-01";

describe("urgencyBand", () => {
  it("bands today and the seven days after it as 'soon', inclusive at both ends", () => {
    expect(urgencyBand("2026-09-01", TODAY)).toBe("soon");
    expect(urgencyBand("2026-09-08", TODAY)).toBe("soon"); // exactly 7 days
    expect(urgencyBand("2026-09-09", TODAY)).toBe("later"); // day 8
    expect(SOON_HORIZON_DAYS).toBe(7);
  });

  it("bands anything past due as 'overdue', however far past", () => {
    // Tracey's two intentionally-overdue lapsed appeal windows are the reason
    // this rule has no distance cutoff: they must never fall out of the top.
    expect(urgencyBand("2026-08-31", TODAY)).toBe("overdue"); // yesterday
    expect(urgencyBand("2026-08-18", TODAY)).toBe("overdue"); // a fortnight
    expect(urgencyBand("2025-01-04", TODAY)).toBe("overdue"); // a year and a half
    expect(urgencyBand("1998-06-30", TODAY)).toBe("overdue"); // absurdly far
  });

  it("never lets an old overdue date decay into a quieter band", () => {
    for (let daysPast = 1; daysPast <= 4000; daysPast += 37) {
      const due = addCivilDays(TODAY, -daysPast);
      expect(urgencyBand(due, TODAY)).toBe("overdue");
      expect(isOverdue(due, TODAY)).toBe(true);
    }
  });

  it("survives a DST-crossing week: seven calendar days is still 'soon'", () => {
    // US DST ends 2026-11-01. A week spanning it is 7 civil days, not 7.04.
    expect(civilDaysBetween("2026-10-29", "2026-11-05")).toBe(7);
    expect(urgencyBand("2026-11-05", "2026-10-29")).toBe("soon");
    expect(urgencyBand("2026-11-06", "2026-10-29")).toBe("later");
    // And the spring-forward boundary, 2026-03-08.
    expect(civilDaysBetween("2026-03-05", "2026-03-12")).toBe(7);
    expect(urgencyBand("2026-03-12", "2026-03-05")).toBe("soon");
    expect(urgencyBand("2026-03-07", "2026-03-08")).toBe("overdue");
  });

  it("crosses a month, a year and a leap day without drifting", () => {
    expect(civilDaysBetween("2026-12-28", "2027-01-04")).toBe(7);
    expect(urgencyBand("2027-01-04", "2026-12-28")).toBe("soon");
    expect(civilDaysBetween("2028-02-26", "2028-03-04")).toBe(7); // 2028 is a leap year
    expect(addCivilDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addCivilDays("2027-02-28", 1)).toBe("2027-03-01");
  });
});

describe("civil-date primitives", () => {
  it("rejects dates that do not exist", () => {
    expect(isCivilDate("2026-09-01")).toBe(true);
    expect(isCivilDate("2026-02-30")).toBe(false);
    expect(isCivilDate("2027-02-29")).toBe(false);
    expect(isCivilDate("2028-02-29")).toBe(true);
    expect(isCivilDate("2026-9-1")).toBe(false);
    expect(isCivilDate("2026-09-01T00:00:00Z")).toBe(false);
    expect(isCivilDate(20260901)).toBe(false);
    expect(isCivilDate(null)).toBe(false);
  });

  it("reads 'today' in the docket's timezone, not the server's", () => {
    // 2026-09-02T01:30Z is still the evening of 1 September in Florida. A
    // UTC-based "today" would mark a 1 September deadline overdue while she
    // is still at her desk on its due date.
    const lateEvening = new Date("2026-09-02T01:30:00Z");
    expect(civilToday(lateEvening)).toBe("2026-09-01");
    expect(civilToday(lateEvening, "UTC")).toBe("2026-09-02");
    expect(urgencyBand("2026-09-01", civilToday(lateEvening))).toBe("soon");
  });

  it("names the weekday of a civil date", () => {
    expect(civilWeekday("2026-09-01")).toBe("Tuesday");
    expect(civilWeekday("2026-09-05")).toBe("Saturday");
    expect(civilWeekday("2026-09-06")).toBe("Sunday");
  });

  it("counts days until, negative when past", () => {
    expect(daysUntil("2026-09-08", TODAY)).toBe(7);
    expect(daysUntil("2026-08-18", TODAY)).toBe(-14);
  });
});

describe("band labels", () => {
  it("gives every band a text label so colour is never the only signal", () => {
    for (const band of URGENCY_BANDS) {
      expect(urgencyLabel(band).length).toBeGreaterThan(0);
    }
    expect(urgencyLabel("overdue")).toBe("Overdue");
    expect(new Set(URGENCY_BANDS.map(urgencyLabel)).size).toBe(URGENCY_BANDS.length);
  });

  it("exposes all three bands in urgency order for empty-state rendering", () => {
    expect(allBands().map((b) => b.band)).toEqual(["overdue", "soon", "later"]);
    for (const descriptor of allBands()) {
      expect(descriptor.description.length).toBeGreaterThan(0);
    }
  });

  it("phrases distance in words that keep overdue sounding overdue", () => {
    expect(urgencyPhrase("2026-09-01", TODAY)).toBe("due today");
    expect(urgencyPhrase("2026-09-02", TODAY)).toBe("due tomorrow");
    expect(urgencyPhrase("2026-08-31", TODAY)).toBe("1 day overdue");
    expect(urgencyPhrase("2026-08-18", TODAY)).toBe("14 days overdue");
    expect(urgencyPhrase("2026-09-22", TODAY)).toBe("due in 21 days");
  });
});

describe("grouping and sorting", () => {
  const docket = [
    { id: "later", due_date: "2026-09-22", status: "open" },
    { id: "soon", due_date: "2026-09-04", status: "open" },
    { id: "appeal-b", due_date: "2026-08-21", status: "open" },
    { id: "appeal-a", due_date: "2026-08-18", status: "open" },
    { id: "today", due_date: "2026-09-01", status: "open" },
  ];

  it("puts overdue first, oldest blown date at the very top", () => {
    expect(sortByUrgency(docket, TODAY).map((d) => d.id)).toEqual([
      "appeal-a",
      "appeal-b",
      "today",
      "soon",
      "later",
    ]);
  });

  it("does not mutate its input", () => {
    const before = docket.map((d) => d.id);
    sortByUrgency(docket, TODAY);
    expect(docket.map((d) => d.id)).toEqual(before);
  });

  it("keeps every row: grouping conserves the docket", () => {
    const groups = groupByUrgency(docket, TODAY);
    expect(groups.map((g) => g.band)).toEqual(["overdue", "soon", "later"]);
    expect(groups.flatMap((g) => g.deadlines)).toHaveLength(docket.length);
    expect(groups[0].deadlines.map((d) => d.id)).toEqual(["appeal-a", "appeal-b"]);
  });

  it("renders empty bands rather than dropping the section", () => {
    const groups = groupByUrgency([{ due_date: "2026-08-18", status: "open" }], TODAY);
    expect(groups).toHaveLength(3);
    expect(groups[1].deadlines).toEqual([]);
    expect(groups[1].label).toBe("This week");
  });

  it("counts by band for the hero strip", () => {
    expect(countByUrgency(docket, TODAY)).toEqual({
      overdue: 2,
      soon: 2,
      later: 1,
      total: 5,
    });
  });

  it("bands a row off its date alone — status can never hide a blown date", () => {
    expect(deadlineBand({ due_date: "2026-08-18", status: "open" }, TODAY)).toBe("overdue");
    expect(deadlineBand({ due_date: "2026-08-18" }, TODAY)).toBe("overdue");
  });
});
