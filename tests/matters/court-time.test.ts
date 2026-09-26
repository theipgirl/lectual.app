import { describe, expect, it } from "vitest";

import {
  COURT_TIME_ZONE,
  courtWallClockToUtcIso,
  formatCourtDateTime,
  toCourtDateTimeLocal,
} from "../../src/lib/matters/court-time";

describe("court time", () => {
  it("uses the zone every county in the docket sits in", () => {
    expect(COURT_TIME_ZONE).toBe("America/New_York");
  });

  describe("against the real imported docket", () => {
    // Cabanis Law, Pinellas 26-000169-SC: the tracker reads
    // "08/25/2026 10:00 AM - Hearing on Defendant's Motion to Dismiss" and the
    // imported row stores 2026-08-25T14:00:00+00. Rendering that instant in
    // UTC would tell the attorney 2:00 PM. This is the regression guard.
    const stored = "2026-08-25T14:00:00+00:00";

    it("shows a stored instant at the time the court will call it", () => {
      expect(formatCourtDateTime(stored)).toBe("Aug 25, 2026, 10:00 AM EDT");
    });

    it("loads that instant into the form as the court's wall clock", () => {
      expect(toCourtDateTimeLocal(stored)).toBe("2026-08-25T10:00");
    });

    it("round-trips: what is typed is what is stored is what is shown", () => {
      const iso = courtWallClockToUtcIso(2026, 8, 25, 10, 0);
      expect(iso).toBe("2026-08-25T14:00:00.000Z");
      expect(toCourtDateTimeLocal(iso)).toBe("2026-08-25T10:00");
      expect(formatCourtDateTime(iso)).toBe("Aug 25, 2026, 10:00 AM EDT");
    });
  });

  describe("daylight saving", () => {
    it("converts a summer hearing at EDT (-4)", () => {
      expect(courtWallClockToUtcIso(2026, 8, 25, 9, 30)).toBe("2026-08-25T13:30:00.000Z");
    });

    it("converts a winter hearing at EST (-5)", () => {
      expect(courtWallClockToUtcIso(2026, 1, 14, 9, 30)).toBe("2026-01-14T14:30:00.000Z");
    });

    it("round-trips either side of a transition", () => {
      for (const [y, mo, d, h, mi] of [
        [2026, 1, 14, 9, 30],
        [2026, 3, 8, 13, 0], // spring forward (2am local)
        [2026, 8, 25, 10, 0],
        [2026, 11, 1, 13, 0], // fall back (2am local)
      ] as const) {
        const iso = courtWallClockToUtcIso(y, mo, d, h, mi);
        const pad = (n: number) => String(n).padStart(2, "0");
        expect(toCourtDateTimeLocal(iso)).toBe(
          `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`,
        );
      }
    });
  });

  describe("the spring-forward gap", () => {
    // 02:00–02:59 on 8 Mar 2026 does not exist in Eastern time. No court sits
    // in it, but the conversion must not resolve it BACKWARDS into the hour
    // before — that would put a hearing an hour earlier than typed, on the one
    // morning of the year when a docketing slip is hardest to spot.
    it("nudges a nonexistent reading forwards, never back", () => {
      for (const minute of [0, 30]) {
        const iso = courtWallClockToUtcIso(2026, 3, 8, 2, minute);
        const readBack = toCourtDateTimeLocal(iso);
        expect(readBack.startsWith("2026-03-08T01:")).toBe(false);
        expect(readBack).toBe(`2026-03-08T03:${String(minute).padStart(2, "0")}`);
      }
    });

    it("still fixes 03:00, which a single pass gets wrong", () => {
      expect(courtWallClockToUtcIso(2026, 3, 8, 3, 0)).toBe("2026-03-08T07:00:00.000Z");
    });
  });

  describe("empty and malformed input", () => {
    it("treats null as no hearing", () => {
      expect(formatCourtDateTime(null)).toBeNull();
      expect(toCourtDateTimeLocal(null)).toBe("");
    });

    it("does not throw on an unparseable stored value", () => {
      expect(formatCourtDateTime("not a date")).toBeNull();
      expect(toCourtDateTimeLocal("not a date")).toBe("");
    });
  });
});
