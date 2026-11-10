import { describe, expect, it } from "vitest";
import { DEFAULT_DEAL_TIMES, dealFor, dealLabel, dealtAt, sameFirmDay } from "@/lib/deal/times";

const NY = "America/New_York";
const iso = (d: Date) => d.toISOString();

describe("dealFor", () => {
  it("defaults to 7:00 AM and 2:00 PM", () => {
    expect(DEFAULT_DEAL_TIMES).toEqual(["07:00", "14:00"]);
    expect(dealLabel("07:00")).toBe("7:00 AM");
    expect(dealLabel("14:00")).toBe("2:00 PM");
    expect(dealLabel("00:30")).toBe("12:30 AM");
    expect(dealLabel("12:00")).toBe("12:00 PM");
  });

  it("before the first deal: no current, next is today's 7:00 AM", () => {
    const d = dealFor(new Date("2026-11-10T10:00:00Z"), NY); // 5:00 AM EST
    expect(d.current).toBeNull();
    expect(d.next.label).toBe("7:00 AM");
    expect(iso(d.next.at)).toBe("2026-11-10T12:00:00.000Z");
  });

  it("between the deals: current 7:00 AM, next 2:00 PM", () => {
    const d = dealFor(new Date("2026-11-10T15:00:00Z"), NY); // 10:00 AM EST
    expect(d.current?.label).toBe("7:00 AM");
    expect(iso(d.current!.at)).toBe("2026-11-10T12:00:00.000Z");
    expect(iso(d.next.at)).toBe("2026-11-10T19:00:00.000Z");
  });

  it("exactly at a deal time it is current", () => {
    const d = dealFor(new Date("2026-11-10T19:00:00Z"), NY);
    expect(d.current?.label).toBe("2:00 PM");
    expect(d.next.label).toBe("7:00 AM");
  });

  it("after the last: next is tomorrow's first", () => {
    const d = dealFor(new Date("2026-11-11T02:00:00Z"), NY); // 9:00 PM EST on the 10th
    expect(d.current?.label).toBe("2:00 PM");
    expect(iso(d.next.at)).toBe("2026-11-11T12:00:00.000Z");
  });

  it("follows daylight saving: 7:00 AM is 11:00 UTC in summer, 12:00 UTC in winter", () => {
    expect(iso(dealFor(new Date("2026-07-01T09:00:00Z"), NY).next.at)).toBe("2026-07-01T11:00:00.000Z");
    expect(iso(dealFor(new Date("2026-12-01T09:00:00Z"), NY).next.at)).toBe("2026-12-01T12:00:00.000Z");
  });

  it("across the spring-forward night, tomorrow's 7:00 AM uses the new offset", () => {
    // 2026-03-07 at 10 PM EST; DST starts 2026-03-08 at 2 AM.
    const d = dealFor(new Date("2026-03-08T03:00:00Z"), NY);
    expect(iso(d.next.at)).toBe("2026-03-08T11:00:00.000Z");
  });

  it("across the fall-back night, tomorrow's 7:00 AM uses the new offset", () => {
    // 2026-10-31 at 10 PM EDT; DST ends 2026-11-01 at 2 AM.
    const d = dealFor(new Date("2026-11-01T02:00:00Z"), NY);
    expect(iso(d.next.at)).toBe("2026-11-01T12:00:00.000Z");
  });

  it("uses the firm's zone, not the server's", () => {
    const now = new Date("2026-11-10T15:00:00Z");
    expect(dealFor(now, "America/Los_Angeles").current?.label).toBe("7:00 AM"); // 7:00 AM PST exactly
    const tokyo = dealFor(now, "Asia/Tokyo"); // midnight in Tokyo: before the first deal
    expect(tokyo.current).toBeNull();
    expect(iso(tokyo.next.at)).toBe("2026-11-10T22:00:00.000Z");
  });

  it("an unknown zone falls back to UTC; bad times fall back to the defaults", () => {
    const d = dealFor(new Date("2026-11-10T08:00:00Z"), "Not/AZone");
    expect(iso(d.current!.at)).toBe("2026-11-10T07:00:00.000Z");
    expect(dealFor(new Date("2026-11-10T08:00:00Z"), "UTC", ["25:00", "x"]).current?.label).toBe("7:00 AM");
  });

  it("takes custom times in any order", () => {
    const d = dealFor(new Date("2026-11-10T16:00:00Z"), "UTC", ["17:30", "09:15"]);
    expect(d.current?.label).toBe("9:15 AM");
    expect(d.next.label).toBe("5:30 PM");
  });
});

describe("dealtAt and sameFirmDay", () => {
  it("is the current deal, or yesterday's last before the first", () => {
    expect(iso(dealtAt(new Date("2026-11-10T15:00:00Z"), NY))).toBe("2026-11-10T12:00:00.000Z");
    expect(iso(dealtAt(new Date("2026-11-10T10:00:00Z"), NY))).toBe("2026-11-09T19:00:00.000Z");
  });

  it("compares calendar days in the firm's zone", () => {
    const now = new Date("2026-11-10T15:00:00Z");
    expect(sameFirmDay(new Date("2026-11-10T04:59:00Z"), now, NY)).toBe(false); // 11:59 PM on the 9th in New York
    expect(sameFirmDay(new Date("2026-11-10T05:01:00Z"), now, NY)).toBe(true);
  });
});
