import { describe, expect, it } from "vitest";

import {
  COURT_TIME_ZONE,
  courtWallClockToUtcIso,
  formatCourtDateTime,
  toCourtDateTimeLocal,
} from "@/lib/court-time";
import { courtTimeOfDay } from "@/lib/calendar/rows";
import { courtCivilDate } from "@/lib/format/date";

/**
 * The four-hour error.
 *
 * Cabanis Law's imported docket stores the Pinellas hearing as
 * `2026-08-25T14:00:00Z`, because 10:00am Eastern IS 14:00 UTC. Rendering that
 * instant in UTC — or in whatever zone the server happens to sit in — shows
 * "2:00 PM" for a hearing the attorney must attend at 10:00. These tests exist
 * so that regression cannot ship quietly.
 */
describe("court time", () => {
  it("is Eastern, deliberately and not by locale", () => {
    expect(COURT_TIME_ZONE).toBe("America/New_York");
  });

  it("renders the Pinellas hearing as 10:00 AM EDT, not 2:00 PM", () => {
    const rendered = formatCourtDateTime("2026-08-25T14:00:00Z");
    expect(rendered).toContain("10:00 AM");
    expect(rendered).toContain("EDT");
    expect(rendered).not.toContain("2:00 PM");
  });

  it("names the zone in the time-of-day used on calendar rows", () => {
    expect(courtTimeOfDay("2026-08-25T14:00:00Z")).toBe("10:00 AM EDT");
  });

  it("reads winter hearings as EST, not a fixed summer offset", () => {
    // 15:00Z in January is 10:00 Eastern Standard Time.
    expect(courtTimeOfDay("2027-01-14T15:00:00Z")).toBe("10:00 AM EST");
  });

  it("round-trips a wall-clock reading back to the same reading", () => {
    const iso = courtWallClockToUtcIso(2026, 8, 25, 10, 0);
    expect(iso).toBe("2026-08-25T14:00:00.000Z");
    expect(toCourtDateTimeLocal(iso)).toBe("2026-08-25T10:00");
  });

  it("round-trips across both sides of a DST transition", () => {
    // Fall back 2026: Nov 1. A hearing the morning after, and one before.
    for (const [y, m, d, h, min] of [
      [2026, 10, 30, 9, 30],
      [2026, 11, 2, 9, 30],
      [2027, 3, 15, 13, 45],
      [2026, 12, 24, 8, 0],
    ] as const) {
      const iso = courtWallClockToUtcIso(y, m, d, h, min);
      const pad = (n: number) => String(n).padStart(2, "0");
      expect(toCourtDateTimeLocal(iso)).toBe(`${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(min)}`);
    }
  });

  it("nudges the spring-forward gap forwards, never silently back an hour", () => {
    // 2:30am on 8 Mar 2026 does not exist in Eastern time. The reading must not
    // resolve backwards into 1:30 EST — an hour EARLIER than asked for.
    const iso = courtWallClockToUtcIso(2026, 3, 8, 2, 30);
    const local = toCourtDateTimeLocal(iso);
    expect(local >= "2026-03-08T02:30").toBe(true);
  });

  it("places a late-evening instant on the court's day, not UTC's", () => {
    // 01:00Z on 3 Sep is 9:00pm Eastern on the 2nd. The calendar must show the
    // 2nd — the day the court, and the attorney, are having.
    expect(courtCivilDate("2026-09-03T01:00:00Z")).toBe("2026-09-02");
  });

  it("returns null rather than a wrong time for junk input", () => {
    expect(formatCourtDateTime(null)).toBeNull();
    expect(formatCourtDateTime("not-a-date")).toBeNull();
    expect(courtTimeOfDay("not-a-date")).toBeNull();
    expect(toCourtDateTimeLocal(null)).toBe("");
  });
});
