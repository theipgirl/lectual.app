import { describe, it, expect } from "vitest";
import type { Matter } from "@/lib/matters";
import type { MatterStage } from "@/lib/matters/stages";
import {
  buildBoard,
  countStale,
  filterByStageCode,
  sortStagesByOrder,
  stageFilterCatalog,
} from "@/lib/matters/board";

/**
 * Pure tests for the docket board's grouping (src/lib/matters/board.ts).
 * No DB — these always run, with or without env.
 *
 * The behaviour they pin down is the answer to the 42-column problem: only
 * LIVE stages get a column, terminal stages fold into one "Closed" group, and —
 * the part that actually matters — every matter still lands in exactly one
 * bucket. A board that quietly drops a matter because its stage is closed, or
 * unset, or belongs to a stage the caller can't see, is the same class of
 * failure as the approval queue rendering "All caught up" it cannot reach.
 */

const NOW = new Date("2026-08-19T12:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function stage(overrides: Partial<MatterStage> & { id: string }): MatterStage {
  return {
    code: "1",
    label: "Inquiry",
    order_index: 1,
    is_open: true,
    waiting_on: "firm",
    ...overrides,
  };
}

function matter(overrides: Partial<Matter> & { id: string }): Matter {
  return {
    org_id: "org-1",
    lead_id: null,
    matter_number: "M-0001",
    title: "Acme Co. — Wordmark",
    type: "TM",
    status: "open",
    opened_at: NOW.toISOString(),
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    stage_id: null,
    stage_entered_at: null,
    owner_name: "Acme Co.",
    stage: null,
    ...overrides,
  } as Matter;
}

const LIVE = stage({ id: "s-live", code: "12", label: "Application filed", order_index: 12 });
const LIVE_LATER = stage({
  id: "s-uspto",
  code: "19A",
  label: "Office action response owed",
  order_index: 19,
  waiting_on: "uspto",
});
const CLOSED = stage({
  id: "s-closed",
  code: "24",
  label: "Registered",
  order_index: 24,
  is_open: false,
});

describe("sortStagesByOrder", () => {
  it("orders by order_index without mutating the input", () => {
    const input = [CLOSED, LIVE_LATER, LIVE];
    const sorted = sortStagesByOrder(input);
    expect(sorted.map((s) => s.code)).toEqual(["12", "19A", "24"]);
    expect(input.map((s) => s.code)).toEqual(["24", "19A", "12"]);
  });
});

describe("buildBoard", () => {
  it("gives every live stage a column, in order — even when empty", () => {
    const board = buildBoard(
      [LIVE_LATER, LIVE],
      [matter({ id: "m1", stage_id: LIVE.id, stage: LIVE })],
    );
    expect(board.open.map((c) => c.stage.code)).toEqual(["12", "19A"]);
    expect(board.open[0].matters.map((m) => m.id)).toEqual(["m1"]);
    expect(board.open[1].matters).toEqual([]);
  });

  it("folds terminal stages into the closed group instead of a column each", () => {
    const board = buildBoard(
      [LIVE, CLOSED],
      [
        matter({ id: "m1", stage_id: LIVE.id, stage: LIVE }),
        matter({ id: "m2", stage_id: CLOSED.id, stage: CLOSED }),
        matter({ id: "m3", stage_id: CLOSED.id, stage: CLOSED }),
      ],
    );
    expect(board.open.map((c) => c.stage.code)).toEqual(["12"]);
    expect(board.closed.map((c) => c.stage.code)).toEqual(["24"]);
    expect(board.closedCount).toBe(2);
  });

  it("omits terminal stages that hold nothing, but keeps empty live columns", () => {
    const board = buildBoard([LIVE, CLOSED], []);
    expect(board.open).toHaveLength(1);
    expect(board.closed).toEqual([]);
    expect(board.closedCount).toBe(0);
  });

  it("never drops a matter: unstaged and unknown-stage matters get their own bucket", () => {
    const board = buildBoard(
      [LIVE],
      [
        matter({ id: "m1", stage_id: LIVE.id, stage: LIVE }),
        matter({ id: "m2" }),
        matter({ id: "m3", stage_id: "s-invisible" }),
      ],
    );
    const placed =
      board.open.reduce((n, c) => n + c.matters.length, 0) +
      board.closedCount +
      board.unstaged.length;
    expect(placed).toBe(3);
    expect(board.unstaged.map((m) => m.id)).toEqual(["m2", "m3"]);
  });

  it("counts stale matters per column using the stage's waiting_on threshold", () => {
    // 60 days: past the 30-day firm threshold, nowhere near the 120-day USPTO one.
    const board = buildBoard(
      [LIVE, LIVE_LATER],
      [
        matter({ id: "m1", stage_id: LIVE.id, stage: LIVE, stage_entered_at: daysAgo(60) }),
        matter({ id: "m2", stage_id: LIVE.id, stage: LIVE, stage_entered_at: daysAgo(3) }),
        matter({
          id: "m3",
          stage_id: LIVE_LATER.id,
          stage: LIVE_LATER,
          stage_entered_at: daysAgo(60),
        }),
      ],
      NOW,
    );
    expect(board.open[0].stale).toBe(1);
    expect(board.open[1].stale).toBe(0);
  });
});

describe("countStale", () => {
  it("treats a matter with no stage clock as not stale", () => {
    expect(countStale([matter({ id: "m1" })], NOW)).toBe(0);
  });
});

describe("stageFilterCatalog", () => {
  it("offers only stages that currently hold a matter, in board order", () => {
    const catalog = stageFilterCatalog(
      [LIVE, LIVE_LATER, CLOSED],
      [
        matter({ id: "m1", stage_id: LIVE.id, stage: LIVE }),
        matter({ id: "m2", stage_id: CLOSED.id, stage: CLOSED }),
      ],
    );
    expect(catalog.map((c) => c.stage.code)).toEqual(["12", "24"]);
    expect(catalog.map((c) => c.matters.length)).toEqual([1, 1]);
  });
});

describe("filterByStageCode", () => {
  const matters = [
    matter({ id: "m1", stage_id: LIVE.id, stage: LIVE }),
    matter({ id: "m2", stage_id: LIVE_LATER.id, stage: LIVE_LATER }),
    matter({ id: "m3" }),
  ];

  it("is a no-op for a falsy or 'all' code", () => {
    expect(filterByStageCode(matters, undefined)).toHaveLength(3);
    expect(filterByStageCode(matters, "all")).toHaveLength(3);
  });

  it("matches the FULL code, letter included — '19A' is not '19'", () => {
    expect(filterByStageCode(matters, "19A").map((m) => m.id)).toEqual(["m2"]);
    expect(filterByStageCode(matters, "19")).toEqual([]);
  });
});
