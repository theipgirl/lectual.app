import { describe, it, expect } from "vitest";
import {
  parseReportRange,
  reportPeriod,
  isInPeriod,
  isInPreviousPeriod,
  DEFAULT_REPORT_RANGE,
} from "@/lib/reports/period";

describe("parseReportRange", () => {
  it("accepts 7, 30 and 90", () => {
    expect(parseReportRange("7")).toBe(7);
    expect(parseReportRange("30")).toBe(30);
    expect(parseReportRange("90")).toBe(90);
  });

  it("falls back to the default for anything else", () => {
    expect(parseReportRange(undefined)).toBe(DEFAULT_REPORT_RANGE);
    expect(parseReportRange("")).toBe(DEFAULT_REPORT_RANGE);
    expect(parseReportRange("14")).toBe(DEFAULT_REPORT_RANGE);
    expect(parseReportRange("not-a-number")).toBe(DEFAULT_REPORT_RANGE);
  });

  it("takes the first value of an array (a duplicated query param)", () => {
    expect(parseReportRange(["90", "7"])).toBe(90);
  });
});

describe("reportPeriod", () => {
  const now = new Date("2026-09-27T12:00:00Z");

  it("builds a [start, now) window of exactly `range` days", () => {
    const p = reportPeriod(30, now);
    expect(p.end).toEqual(now);
    expect(p.start).toEqual(new Date("2026-08-28T12:00:00Z"));
  });

  it("makes the previous period immediately precede the current one, same length", () => {
    const p = reportPeriod(7, now);
    expect(p.prevEnd).toEqual(p.start);
    expect(p.prevStart).toEqual(new Date("2026-09-13T12:00:00Z"));
  });
});

describe("isInPeriod / isInPreviousPeriod", () => {
  const now = new Date("2026-09-27T12:00:00Z");
  const period = reportPeriod(30, now);

  it("includes a timestamp inside the current window", () => {
    expect(isInPeriod("2026-09-01T00:00:00Z", period)).toBe(true);
  });

  it("excludes the boundary at `start` from neither window — it belongs to neither", () => {
    // start is 2026-08-28T12:00:00Z; the current window is [start, now).
    expect(isInPeriod(period.start.toISOString(), period)).toBe(true);
    expect(isInPreviousPeriod(period.start.toISOString(), period)).toBe(false);
  });

  it("excludes anything before the previous period", () => {
    expect(isInPeriod("2026-01-01T00:00:00Z", period)).toBe(false);
    expect(isInPreviousPeriod("2026-01-01T00:00:00Z", period)).toBe(false);
  });

  it("puts a timestamp from the prior equal period only in isInPreviousPeriod", () => {
    const mid = "2026-08-10T00:00:00Z";
    expect(isInPeriod(mid, period)).toBe(false);
    expect(isInPreviousPeriod(mid, period)).toBe(true);
  });

  it("treats null/undefined/unparseable as in neither window", () => {
    expect(isInPeriod(null, period)).toBe(false);
    expect(isInPeriod(undefined, period)).toBe(false);
    expect(isInPeriod("not-a-date", period)).toBe(false);
    expect(isInPreviousPeriod(null, period)).toBe(false);
  });
});
