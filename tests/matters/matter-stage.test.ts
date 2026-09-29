import { describe, it, expect } from "vitest";
import {
  STALE_THRESHOLD_DAYS,
  daysInStage,
  matterIsStale,
} from "@/lib/matters/stages";

/**
 * Pure-logic tests for the docket stall rule (src/lib/matters/stages.ts).
 * No DB — these always run, with or without env.
 *
 * The rule they pin down is the one 0042 moved out of a brief renderer and into
 * data: how long a matter may sit quietly depends entirely on WHO is holding it.
 * A USPTO-waiting matter is healthy after four months; a firm-waiting matter is
 * not healthy after five weeks. Getting that backwards either buries the
 * matters that really are owed work, or cries wolf on every filed application.
 */

const NOW = new Date("2026-08-19T12:00:00.000Z");

/** An ISO timestamp exactly `days` before NOW. */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("daysInStage", () => {
  it("counts whole days since the matter entered its stage", () => {
    expect(daysInStage(daysAgo(0), NOW)).toBe(0);
    expect(daysInStage(daysAgo(1), NOW)).toBe(1);
    expect(daysInStage(daysAgo(31), NOW)).toBe(31);
    expect(daysInStage(daysAgo(400), NOW)).toBe(400);
  });

  it("floors a partial day rather than rounding it up", () => {
    // 29 days and 23 hours is still day 29 — a matter does not age early.
    const almostThirty = new Date(NOW.getTime() - (30 * 86_400_000 - 3_600_000)).toISOString();
    expect(daysInStage(almostThirty, NOW)).toBe(29);
  });

  it("returns null for a matter that is not on the docket", () => {
    expect(daysInStage(null, NOW)).toBeNull();
  });

  it("returns null for an unparseable timestamp rather than NaN", () => {
    expect(daysInStage("not-a-timestamp", NOW)).toBeNull();
  });
});

describe("matterIsStale", () => {
  it("uses a 30-day fuse when the firm is holding the matter", () => {
    expect(matterIsStale({ stage_entered_at: daysAgo(29), waiting_on: "firm" }, NOW)).toBe(false);
    expect(matterIsStale({ stage_entered_at: daysAgo(31), waiting_on: "firm" }, NOW)).toBe(true);
  });

  it("uses a 30-day fuse when the client is holding the matter", () => {
    expect(matterIsStale({ stage_entered_at: daysAgo(29), waiting_on: "client" }, NOW)).toBe(false);
    expect(matterIsStale({ stage_entered_at: daysAgo(31), waiting_on: "client" }, NOW)).toBe(true);
  });

  it("uses a 120-day fuse when the USPTO is holding the matter", () => {
    // The case that matters most: 90 days of silence from the office is normal,
    // and flagging it would drown the real stalls.
    expect(matterIsStale({ stage_entered_at: daysAgo(90), waiting_on: "uspto" }, NOW)).toBe(false);
    expect(matterIsStale({ stage_entered_at: daysAgo(119), waiting_on: "uspto" }, NOW)).toBe(false);
    expect(matterIsStale({ stage_entered_at: daysAgo(121), waiting_on: "uspto" }, NOW)).toBe(true);
  });

  it("is not stale at exactly the threshold, and is stale the day after", () => {
    expect(matterIsStale({ stage_entered_at: daysAgo(30), waiting_on: "firm" }, NOW)).toBe(false);
    expect(matterIsStale({ stage_entered_at: daysAgo(30), waiting_on: "client" }, NOW)).toBe(false);
    expect(matterIsStale({ stage_entered_at: daysAgo(120), waiting_on: "uspto" }, NOW)).toBe(false);

    expect(matterIsStale({ stage_entered_at: daysAgo(31), waiting_on: "firm" }, NOW)).toBe(true);
    expect(matterIsStale({ stage_entered_at: daysAgo(121), waiting_on: "uspto" }, NOW)).toBe(true);
  });

  it("is never stale when the matter has no stage clock", () => {
    // stage_id and stage_entered_at travel together (0042's
    // crm_matter_stage_entered_together), so this is exactly "not on the docket
    // yet" — which is an unplaced matter, not an overdue one.
    expect(matterIsStale({ stage_entered_at: null, waiting_on: "firm" }, NOW)).toBe(false);
    expect(matterIsStale({ stage_entered_at: null, waiting_on: "uspto" }, NOW)).toBe(false);
    expect(matterIsStale({ stage_entered_at: null, waiting_on: null }, NOW)).toBe(false);
  });

  it("falls back to the shortest fuse when waiting_on is unknown", () => {
    // Fail toward nagging, never toward silence — the same default the column
    // itself carries in the database.
    expect(matterIsStale({ stage_entered_at: daysAgo(31), waiting_on: null }, NOW)).toBe(true);
    expect(matterIsStale({ stage_entered_at: daysAgo(29), waiting_on: null }, NOW)).toBe(false);
  });

  it("defaults `now` to the current time", () => {
    // No `now` argument: a year-old firm-waiting matter is stale whenever this
    // test runs, and one entered a moment ago is not.
    expect(matterIsStale({ stage_entered_at: daysAgo(365), waiting_on: "firm" })).toBe(true);
    expect(matterIsStale({ stage_entered_at: new Date().toISOString(), waiting_on: "firm" })).toBe(
      false,
    );
  });
});

describe("STALE_THRESHOLD_DAYS", () => {
  it("keeps the firm/client fuse short and the USPTO fuse long", () => {
    expect(STALE_THRESHOLD_DAYS).toEqual({ firm: 30, client: 30, uspto: 120, court: 60 });
  });

  // A missing key here is silent in the worst direction: `days > undefined` is
  // false, so matterIsStale() would return false forever and a court-waiting
  // matter would never once be flagged. Assert every value has a fuse.
  it("gives every waiting_on value a threshold", () => {
    for (const who of ["firm", "client", "uspto", "court"] as const) {
      expect(typeof STALE_THRESHOLD_DAYS[who]).toBe("number");
    }
  });
});
