import { describe, expect, it } from "vitest";
import { civilDay, formatDay, formatDayTime, formatRelative, formatTime } from "@/lib/ui/dates";
import { relativeTime } from "@/lib/relative-time";

const NY = "America/New_York";
const NOW = new Date("2026-11-17T15:00:00Z");

describe("formatDay", () => {
  it("prints 'Nov 16' with no year in the current year", () => {
    expect(formatDay("2026-11-16T15:00:00Z", { tz: NY, now: NOW })).toBe("Nov 16");
  });
  it("adds the year only when it is not this year", () => {
    expect(formatDay("2025-11-16T15:00:00Z", { tz: NY, now: NOW })).toBe("Nov 16, 2025");
  });
  it("never shifts a civil date, whatever the zone", () => {
    expect(formatDay("2026-11-16", { tz: "Pacific/Auckland", now: NOW })).toBe("Nov 16");
    expect(formatDay("2026-11-16", { tz: "Pacific/Honolulu", now: NOW })).toBe("Nov 16");
  });
  it("shows an 11 PM New York instant on its own day, not UTC's next day", () => {
    expect(formatDay("2026-11-17T04:00:00Z", { tz: NY, now: NOW })).toBe("Nov 16");
    expect(civilDay("2026-11-17T04:00:00Z", NY)).toBe("2026-11-16");
  });
  it("uses a fixed month table (Sep, not Sept)", () => {
    expect(formatDay("2026-09-05", { tz: NY, now: NOW })).toBe("Sep 5");
  });
  it("the year is judged in the firm's zone at now", () => {
    const newYearUtc = new Date("2027-01-01T03:00:00Z"); // still Dec 31, 2026 in New York
    expect(formatDay("2026-12-30", { tz: NY, now: newYearUtc })).toBe("Dec 30");
  });
  it("gives null for junk and empty input", () => {
    for (const bad of [null, undefined, "", "not a date", "2026-13-40"]) expect(formatDay(bad as string, { tz: NY, now: NOW })).toBeNull();
  });
});

describe("formatTime", () => {
  it("prints '2:30 PM' with a plain space", () => {
    const t = formatTime("2026-11-17T19:30:00Z", { tz: NY });
    expect(t).toBe("2:30 PM");
    expect(t).not.toMatch(/[  ]/);
  });
  it("handles midnight and noon", () => {
    expect(formatTime("2026-11-17T05:00:00Z", { tz: NY })).toBe("12:00 AM");
    expect(formatTime("2026-11-17T17:05:00Z", { tz: NY })).toBe("12:05 PM");
  });
  it("is null for a civil date (it has no time) and for junk", () => {
    expect(formatTime("2026-11-17", { tz: NY })).toBeNull();
    expect(formatTime("nope", { tz: NY })).toBeNull();
  });
});

describe("formatDayTime", () => {
  it("joins the day and the time", () => {
    expect(formatDayTime("2026-11-16T19:30:00Z", { tz: NY, now: NOW })).toBe("Nov 16, 2:30 PM");
    expect(formatDayTime("2025-11-16T19:30:00Z", { tz: NY, now: NOW })).toBe("Nov 16, 2025, 2:30 PM");
  });
  it("is just the day for a civil date", () => {
    expect(formatDayTime("2026-11-16", { tz: NY, now: NOW })).toBe("Nov 16");
  });
});

describe("formatRelative", () => {
  const at = (secondsAgo: number) => new Date(NOW.getTime() - secondsAgo * 1000).toISOString();
  it("uses words under a week", () => {
    expect(formatRelative(at(10), { tz: NY, now: NOW })).toBe("just now");
    expect(formatRelative(at(300), { tz: NY, now: NOW })).toBe("5 min ago");
    expect(formatRelative(at(3 * 3600), { tz: NY, now: NOW })).toBe("3 h ago");
    expect(formatRelative(at(86400), { tz: NY, now: NOW })).toBe("1 day ago");
    expect(formatRelative(at(86400 * 6 + 100), { tz: NY, now: NOW })).toBe("6 days ago");
  });
  it("cuts off at 7 days and prints the day", () => {
    expect(formatRelative(at(86400 * 7), { tz: NY, now: NOW })).toBe("Nov 10");
    expect(formatRelative(at(86400 * 10), { tz: NY, now: NOW })).toBe("Nov 7");
  });
  it("prints the day for the future and null for junk", () => {
    expect(formatRelative("2026-11-20T15:00:00Z", { tz: NY, now: NOW })).toBe("Nov 20");
    expect(formatRelative("junk", { tz: NY, now: NOW })).toBeNull();
    expect(formatRelative(null, { tz: NY, now: NOW })).toBeNull();
  });
});

describe("relativeTime delegates to it", () => {
  it("keeps 'never' and its words", () => {
    expect(relativeTime(null)).toBe("never");
    expect(relativeTime("2026-11-17T14:55:00Z", NOW.getTime())).toBe("5 min ago");
    expect(relativeTime("2026-11-01T14:55:00Z", NOW.getTime(), NY)).toBe("Nov 1");
  });
});
