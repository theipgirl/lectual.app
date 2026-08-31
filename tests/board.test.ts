import { describe, expect, it } from "vitest";
import {
  boardMatterCount,
  boardMatters,
  buildBoard,
  countStale,
  filterByStageCode,
  sortStagesByOrder,
  stageFilterCatalog,
  type BoardMatter,
  type BoardStage,
} from "@/lib/board/board";
import { STALE_THRESHOLD_DAYS, daysInStage, matterIsStale } from "@/lib/board/stage-rules";

type TestMatter = BoardMatter & { id: string };

const NOW = new Date("2026-09-01T12:00:00Z");

const stage = (
  id: string,
  code: string,
  order_index: number,
  is_open = true,
  waiting_on: BoardStage["waiting_on"] = "firm",
): BoardStage => ({ id, code, label: code, order_index, is_open, waiting_on });

const LADDER: BoardStage[] = [
  stage("served", "SERVED", 1),
  stage("answer", "ANSWER", 2),
  stage("mot", "MOT_PENDING", 3),
  stage("hearing", "HEARING_SET", 4, true, "court"),
  stage("closed", "CLOSED", 9, false),
];

const daysAgo = (n: number): string => new Date(NOW.getTime() - n * 86_400_000).toISOString();

const matter = (id: string, stage_id: string | null, enteredDaysAgo?: number): TestMatter => ({
  id,
  stage_id,
  stage_entered_at: enteredDaysAgo === undefined ? null : daysAgo(enteredDaysAgo),
  stage: stage_id ? { waiting_on: LADDER.find((s) => s.id === stage_id)?.waiting_on ?? null } : null,
});

describe("buildBoard conservation", () => {
  it("accounts for every input matter exactly once", () => {
    // Tracy's live shape: 22 unplaced, some staged, some closed.
    const unplaced = Array.from({ length: 22 }, (_, i) => matter(`u${i}`, null));
    const staged = [
      matter("s1", "served", 3),
      matter("s2", "served", 40),
      matter("s3", "answer", 5),
      matter("s4", "hearing", 10),
    ];
    const closed = [matter("c1", "closed", 400), matter("c2", "closed", 500)];
    const input = [...unplaced, ...staged, ...closed];

    const board = buildBoard(LADDER, input, NOW);

    const openMatters = board.open.flatMap((c) => c.matters);
    const closedMatters = board.closed.flatMap((c) => c.matters);
    expect(openMatters.length + closedMatters.length + board.unstaged.length).toBe(input.length);
    expect(openMatters.length + board.closedCount + board.unstaged.length).toBe(input.length);
    expect(boardMatterCount(board)).toBe(input.length);

    // Exactly once, not merely "the right total".
    const ids = boardMatters(board).map((m) => m.id);
    expect(ids).toHaveLength(input.length);
    expect(new Set(ids).size).toBe(input.length);
    expect([...ids].sort()).toEqual(input.map((m) => m.id).sort());
  });

  it("lands all 22 stage_id-null matters in unstaged", () => {
    const input = Array.from({ length: 22 }, (_, i) => matter(`u${i}`, null));
    const board = buildBoard(LADDER, input, NOW);
    expect(board.unstaged).toHaveLength(22);
    expect(board.open.flatMap((c) => c.matters)).toHaveLength(0);
    expect(board.closedCount).toBe(0);
    expect(boardMatterCount(board)).toBe(22);
  });

  it("keeps a matter pointing at an invisible stage — it lands in unstaged", () => {
    // stage_id set, but the stage is not in the catalog the caller can see.
    const input = [matter("ghost", "a-stage-we-cannot-see", 2), matter("ok", "served", 1)];
    const board = buildBoard(LADDER, input, NOW);
    expect(board.unstaged.map((m) => m.id)).toEqual(["ghost"]);
    expect(boardMatterCount(board)).toBe(2);
  });

  it("conserves matters when the stage catalog is empty", () => {
    const input = [matter("a", "served", 1), matter("b", null)];
    const board = buildBoard([], input, NOW);
    expect(board.unstaged).toHaveLength(2);
    expect(boardMatterCount(board)).toBe(2);
  });

  it("returns unstaged as a present array even with no matters at all", () => {
    const board = buildBoard(LADDER, [] as TestMatter[], NOW);
    // Required field, not optional — the unplaced lane always has something
    // to render, so it can always be pinned first.
    expect(Array.isArray(board.unstaged)).toBe(true);
    expect(board.unstaged).toHaveLength(0);
    expect(boardMatterCount(board)).toBe(0);
  });
});

describe("buildBoard columns", () => {
  it("renders every open stage in order_index order, empty ones included", () => {
    const board = buildBoard(
      [stage("b", "B", 2), stage("a", "A", 1), stage("c", "C", 3)],
      [] as TestMatter[],
      NOW,
    );
    expect(board.open.map((c) => c.stage.code)).toEqual(["A", "B", "C"]);
  });

  it("drops empty terminal stages but never their matters", () => {
    const withClosed = buildBoard(LADDER, [matter("c1", "closed", 1)], NOW);
    expect(withClosed.closed.map((c) => c.stage.code)).toEqual(["CLOSED"]);
    expect(withClosed.closedCount).toBe(1);

    const withoutClosed = buildBoard(LADDER, [matter("s1", "served", 1)], NOW);
    expect(withoutClosed.closed).toHaveLength(0);
    expect(withoutClosed.closedCount).toBe(0);
  });

  it("counts stale matters per column against the stage's waiting_on", () => {
    const board = buildBoard(
      LADDER,
      [
        matter("fresh", "served", 3),
        matter("stale", "served", STALE_THRESHOLD_DAYS.firm + 1),
        matter("boundary", "served", STALE_THRESHOLD_DAYS.firm),
        // court gets the longer fuse: 45 days on a set hearing is not stale.
        matter("court", "hearing", 45),
      ],
      NOW,
    );
    const served = board.open.find((c) => c.stage.id === "served");
    expect(served?.stale).toBe(1);
    expect(board.open.find((c) => c.stage.id === "hearing")?.stale).toBe(0);
  });

  it("does not mutate its inputs", () => {
    const stages = [stage("b", "B", 2), stage("a", "A", 1)];
    const order = stages.map((s) => s.id);
    const matters = [matter("m", "a", 1)];
    buildBoard(stages, matters, NOW);
    expect(stages.map((s) => s.id)).toEqual(order);
    expect(matters).toHaveLength(1);
  });
});

describe("sortStagesByOrder", () => {
  it("sorts a copy", () => {
    const stages = [stage("c", "C", 3), stage("a", "A", 1)];
    expect(sortStagesByOrder(stages).map((s) => s.code)).toEqual(["A", "C"]);
    expect(stages.map((s) => s.code)).toEqual(["C", "A"]);
  });
});

describe("stageFilterCatalog", () => {
  it("offers only stages that currently hold work, in board order", () => {
    const catalog = stageFilterCatalog(LADDER, [
      matter("a", "answer", 1),
      matter("b", "served", 1),
      matter("c", "closed", 1),
      matter("d", null),
    ]);
    expect(catalog.map((c) => c.stage.code)).toEqual(["SERVED", "ANSWER", "CLOSED"]);
  });
});

describe("filterByStageCode", () => {
  const matters = [matter("a", "served", 1), matter("b", "answer", 1), matter("c", null)];

  it("is a no-op for a falsy code or 'all'", () => {
    expect(filterByStageCode(LADDER, matters, null)).toHaveLength(3);
    expect(filterByStageCode(LADDER, matters, "all")).toHaveLength(3);
    expect(filterByStageCode(LADDER, matters, "")).toHaveLength(3);
  });

  it("filters to one stage and never returns unplaced matters under a code", () => {
    expect(filterByStageCode(LADDER, matters, "SERVED").map((m) => m.id)).toEqual(["a"]);
    expect(filterByStageCode(LADDER, matters, "NOPE")).toEqual([]);
  });
});

describe("countStale", () => {
  it("treats an unstaged matter as not stale — it has no clock", () => {
    expect(countStale([matter("u", null)], NOW)).toBe(0);
  });

  it("falls back to the firm threshold when the stage has no waiting_on", () => {
    const m: TestMatter = {
      id: "x",
      stage_id: "served",
      stage_entered_at: daysAgo(STALE_THRESHOLD_DAYS.firm + 1),
      stage: { waiting_on: null },
    };
    expect(countStale([m], NOW)).toBe(1);
  });
});

describe("stage-rules", () => {
  it("floors days in stage and returns null for missing or unparseable input", () => {
    expect(daysInStage(daysAgo(0), NOW)).toBe(0);
    expect(daysInStage(daysAgo(5), NOW)).toBe(5);
    expect(daysInStage(null, NOW)).toBeNull();
    expect(daysInStage(undefined, NOW)).toBeNull();
    expect(daysInStage("not-a-date", NOW)).toBeNull();
  });

  it("tips over strictly after the threshold", () => {
    const at = (days: number, waiting_on: "firm" | "uspto") =>
      matterIsStale({ stage_entered_at: daysAgo(days), waiting_on }, NOW);
    expect(at(STALE_THRESHOLD_DAYS.firm, "firm")).toBe(false);
    expect(at(STALE_THRESHOLD_DAYS.firm + 1, "firm")).toBe(true);
    expect(at(STALE_THRESHOLD_DAYS.uspto, "uspto")).toBe(false);
    expect(at(STALE_THRESHOLD_DAYS.uspto + 1, "uspto")).toBe(true);
  });
});
