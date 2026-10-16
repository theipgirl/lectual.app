import { describe, it, expect } from "vitest";

import {
  buildIntakeTime,
  elapsedSeconds,
  formatClock,
  formatDuration,
  staleRunning,
  startOfWeek,
  totalsByUser,
  weekTotalsByLead,
  type TimeEntryLike,
} from "@/lib/time";

/**
 * Pure coverage for the time roll-ups (blueprint §13.1).
 *
 * No database and no ambient clock: every case passes its own `now`, which is
 * the property that lets the server render a week total and the browser
 * re-render the same number a second later without the two disagreeing.
 *
 * Every name and id below is invented. These numbers are internal effort, not
 * billing — there is no rate anywhere in this module to test.
 */

/** Wednesday 2026-09-16, 14:00 local. The week began Monday the 14th. */
const NOW = new Date(2026, 8, 16, 14, 0, 0);

let nextId = 0;

function entry(partial: Partial<TimeEntryLike> = {}): TimeEntryLike {
  nextId += 1;
  return {
    id: `entry-${nextId}`,
    lead_id: "lead-a",
    matter_id: null,
    user_id: "user-1",
    started_at: new Date(2026, 8, 16, 9, 0, 0).toISOString(),
    ended_at: new Date(2026, 8, 16, 9, 30, 0).toISOString(),
    seconds: 1800,
    note: null,
    ...partial,
  };
}

describe("formatDuration", () => {
  it("floors to whole minutes and never rounds a total up", () => {
    expect(formatDuration(0)).toBe("0m");
    // 59 seconds of work is not "1m" — a number the firm may read back as
    // effort should never be generous by default.
    expect(formatDuration(59)).toBe("0m");
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(3599)).toBe("59m");
  });

  it("switches to hours, dropping a zero minute part", () => {
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(4500)).toBe("1h 15m");
    expect(formatDuration(36_000)).toBe("10h");
  });

  it("treats nonsense as zero rather than printing it", () => {
    expect(formatDuration(-120)).toBe("0m");
    expect(formatDuration(Number.NaN)).toBe("0m");
  });
});

describe("formatClock", () => {
  it("shows seconds while under an hour, and hours once past one", () => {
    expect(formatClock(7)).toBe("0:07");
    expect(formatClock(754)).toBe("12:34");
    expect(formatClock(3723)).toBe("1:02:03");
  });
});

describe("elapsedSeconds", () => {
  it("reports a closed entry's STORED duration, not a re-derivation", () => {
    // The stored number is what Stop wrote and what the timeline recorded; a
    // manual entry's started_at is itself back-computed from it.
    const closed = entry({ seconds: 900, started_at: "2026-09-16T09:00:00.000Z", ended_at: "2026-09-16T10:00:00.000Z" });
    expect(elapsedSeconds(closed, NOW)).toBe(900);
  });

  it("measures a running entry against now", () => {
    const running = entry({
      ended_at: null,
      seconds: 0,
      started_at: new Date(NOW.getTime() - 125_000).toISOString(),
    });
    expect(elapsedSeconds(running, NOW)).toBe(125);
  });

  it("clamps a backwards clock to zero rather than counting down", () => {
    const future = entry({
      ended_at: null,
      seconds: 0,
      started_at: new Date(NOW.getTime() + 60_000).toISOString(),
    });
    expect(elapsedSeconds(future, NOW)).toBe(0);
  });
});

describe("startOfWeek", () => {
  it("is the Monday of the week, at midnight", () => {
    const start = startOfWeek(NOW);
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(14);
    expect(start.getHours()).toBe(0);
  });

  it("puts Sunday in the week that began six days earlier, not the next one", () => {
    // Sunday 2026-09-20 still belongs to the week of Monday the 14th — a
    // Monday reader must not find the total already reset.
    const start = startOfWeek(new Date(2026, 8, 20, 22, 0, 0));
    expect(start.getDate()).toBe(14);
  });
});

describe("weekTotalsByLead", () => {
  it("sums this week's entries per lead and skips last week's", () => {
    const totals = weekTotalsByLead(
      [
        entry({ lead_id: "lead-a", seconds: 1800 }),
        entry({ lead_id: "lead-a", seconds: 600 }),
        entry({ lead_id: "lead-b", seconds: 300 }),
        entry({
          lead_id: "lead-a",
          seconds: 7200,
          started_at: new Date(2026, 8, 11, 9, 0, 0).toISOString(),
          ended_at: new Date(2026, 8, 11, 11, 0, 0).toISOString(),
        }),
      ],
      NOW,
    );
    expect(totals).toEqual({ "lead-a": 2400, "lead-b": 300 });
  });

  it("counts a running entry at its elapsed-so-far", () => {
    const totals = weekTotalsByLead(
      [
        entry({ lead_id: "lead-a", seconds: 600 }),
        entry({
          lead_id: "lead-a",
          ended_at: null,
          seconds: 0,
          started_at: new Date(NOW.getTime() - 300_000).toISOString(),
        }),
      ],
      NOW,
    );
    expect(totals["lead-a"]).toBe(900);
  });

  it("ignores matter-side work — this is the intake card's number", () => {
    const totals = weekTotalsByLead([entry({ lead_id: null, matter_id: "matter-1" })], NOW);
    expect(totals).toEqual({});
  });
});

describe("totalsByUser", () => {
  it("orders by size, counts entries, and carries the latest note", () => {
    const totals = totalsByUser(
      [
        entry({ user_id: "dawn", seconds: 600, note: "Called back" }),
        entry({
          user_id: "dawn",
          seconds: 300,
          note: "Filed the notes",
          started_at: new Date(2026, 8, 16, 11, 0, 0).toISOString(),
          ended_at: new Date(2026, 8, 16, 11, 5, 0).toISOString(),
        }),
        entry({ user_id: "rayn", seconds: 3600 }),
      ],
      NOW,
    );

    expect(totals.map((total) => total.userId)).toEqual(["rayn", "dawn"]);
    const dawn = totals[1];
    expect(dawn.seconds).toBe(900);
    expect(dawn.entries).toBe(2);
    expect(dawn.running).toBe(false);
    expect(dawn.lastNote).toBe("Filed the notes");
  });

  it("flags the person whose clock is still going", () => {
    const totals = totalsByUser(
      [entry({ user_id: "dawn", ended_at: null, seconds: 0, started_at: new Date(NOW.getTime() - 60_000).toISOString() })],
      NOW,
    );
    expect(totals[0].running).toBe(true);
    expect(totals[0].seconds).toBe(60);
  });
});

describe("staleRunning", () => {
  const eightHoursAgo = new Date(NOW.getTime() - 8 * 3600 * 1000).toISOString();
  const twoHoursAgo = new Date(NOW.getTime() - 2 * 3600 * 1000).toISOString();

  it("finds open clocks past the threshold and leaves fresh ones alone", () => {
    const stale = staleRunning(
      [
        entry({ id: "old", ended_at: null, seconds: 0, started_at: eightHoursAgo }),
        entry({ id: "fresh", ended_at: null, seconds: 0, started_at: twoHoursAgo }),
      ],
      NOW,
    );
    expect(stale.map((e) => e.id)).toEqual(["old"]);
  });

  it("never flags a CLOSED entry, however long it ran", () => {
    const stale = staleRunning([entry({ seconds: 20 * 3600 })], NOW);
    expect(stale).toEqual([]);
  });

  it("takes a custom threshold", () => {
    const entries = [entry({ ended_at: null, seconds: 0, started_at: twoHoursAgo })];
    expect(staleRunning(entries, NOW, 1)).toHaveLength(1);
    expect(staleRunning(entries, NOW, 3)).toHaveLength(0);
  });
});

describe("buildIntakeTime", () => {
  it("groups this week per lead and names the lead a timer is running on", () => {
    const running = entry({
      id: "running",
      lead_id: "lead-b",
      user_id: "dawn",
      ended_at: null,
      seconds: 0,
      started_at: new Date(NOW.getTime() - 600_000).toISOString(),
    });

    const time = buildIntakeTime({
      entries: [entry({ lead_id: "lead-a", seconds: 1200, user_id: "rayn" })],
      running,
      now: NOW,
      leadNames: { "lead-a": "Zora Fixtureson", "lead-b": "Marisol Okafor" },
    });

    expect(time.byLeadId["lead-a"].seconds).toBe(1200);
    expect(time.byLeadId["lead-b"].seconds).toBe(600);
    expect(time.byLeadId["lead-b"].byUser[0]).toMatchObject({ userId: "dawn", running: true });
    expect(time.running).toMatchObject({
      entryId: "running",
      leadId: "lead-b",
      leadName: "Marisol Okafor",
    });
  });

  it("counts a running entry ONCE when it is already in the window's entries", () => {
    const running = entry({
      id: "running",
      lead_id: "lead-a",
      ended_at: null,
      seconds: 0,
      started_at: new Date(NOW.getTime() - 600_000).toISOString(),
    });

    const time = buildIntakeTime({ entries: [running], running, now: NOW });
    expect(time.byLeadId["lead-a"].seconds).toBe(600);
    expect(time.byLeadId["lead-a"].byUser[0].entries).toBe(1);
  });

  it("keeps a clock that started before this week — it is still work happening now", () => {
    const running = entry({
      id: "friday",
      lead_id: "lead-a",
      ended_at: null,
      seconds: 0,
      started_at: new Date(2026, 8, 11, 17, 0, 0).toISOString(),
    });

    const time = buildIntakeTime({ entries: [], running, now: NOW });
    // The chip's live face would otherwise tick beside a total of 0m.
    expect(time.byLeadId["lead-a"].seconds).toBeGreaterThan(0);
  });

  it("leaves a lead OUT rather than reporting a zero, so the chip can tell 0m from unknown", () => {
    const time = buildIntakeTime({ entries: [], running: null, now: NOW });
    expect(time.byLeadId).toEqual({});
    expect(time.running).toBeNull();
  });

  it("does not name a lead the page isn't showing", () => {
    const running = entry({ id: "elsewhere", lead_id: "lead-z", ended_at: null, seconds: 0 });
    const time = buildIntakeTime({ entries: [], running, now: NOW, leadNames: { "lead-a": "Zora" } });
    // The chip then says "another lead" rather than naming a record the
    // reader may not be looking at.
    expect(time.running?.leadName).toBeNull();
  });
});
