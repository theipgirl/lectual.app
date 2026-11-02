import { describe, expect, it } from "vitest";
import { reviewBuckets } from "@/lib/review/buckets";
import { beyondBoard, boardLanes, kpis, laneOf, meetingPosition, meetingQueue, stageGroups } from "@/lib/review/lanes";
import { row, TODAY } from "./fixtures";

const members = [
  { userId: "u-rayn", name: "Rayn", role: "paralegal" },
  { userId: "u-reb", name: "Rebecca", role: "owner" },
  { userId: "u-amor", name: "Amor", role: "intake" },
];
const step = (dueDate: string | null, assigneeId: string | null) => ({ id: "t", title: "x", dueDate, assigneeId });
const rows = [
  row({ key: "1", client: "A", nextStep: step("2026-10-30", "u-rayn") }),
  row({ key: "2", client: "B", nextStep: step("2026-11-03", "u-reb") }),
  row({ key: "3", client: "C", nextStep: null, assignedTo: "u-amor" }),
  row({ key: "4", client: "D", nextStep: null }),
  row({ key: "5", client: "E", nextStep: step("2026-10-01", null), assignedTo: "u-rayn" }),
  row({ key: "6", client: "F", waiting: "uspto", nextStep: null }),
  row({ key: "7", client: "G" }),
];

describe("laneOf", () => {
  it("next-step assignee, else the record's, else none", () => {
    expect(laneOf(rows[0])).toBe("u-rayn");
    expect(laneOf(rows[2])).toBe("u-amor");
    expect(laneOf(rows[3])).toBeNull();
    expect(laneOf(row({ assignedTo: "u-amor", nextStep: step(null, "u-reb") }))).toBe("u-reb");
  });
});

describe("boardLanes", () => {
  const b = reviewBuckets(rows, TODAY);
  const lanes = boardLanes(b, members);
  it("owner first, then alphabetical, Unassigned last", () => {
    expect(lanes.map((l) => l.name)).toEqual(["Rebecca", "Amor", "Rayn", "Unassigned"]);
  });
  it("puts cards in the four columns only", () => {
    const rayn = lanes.find((l) => l.name === "Rayn")!;
    expect(rayn.columns.overdue.map((r) => r.key).sort()).toEqual(["1", "5"]);
    expect(lanes.reduce((n, l) => n + l.count, 0)).toBe(5);
  });
  it("USPTO and on-track are counted, not lanes", () => {
    expect(beyondBoard(b)).toEqual({ uspto: 1, track: 1 });
  });
  it("an unknown assignee reads Teammate", () => {
    const l = boardLanes(reviewBuckets([row({ nextStep: step("2026-10-01", "gone") })], TODAY), members);
    expect(l[0].name).toBe("Teammate");
  });
  it("no flagged rows, no lanes", () => {
    expect(boardLanes(reviewBuckets([row({})], TODAY), members)).toEqual([]);
  });
});

describe("meeting queue", () => {
  const b = reviewBuckets(rows, TODAY);
  it("follows board order and excludes USPTO / on track", () => {
    const q = meetingQueue(b, members).map((r) => r.key);
    expect(q).toEqual(["2", "3", "5", "1", "4"]);
  });
  it("positions clamp and link", () => {
    expect(meetingPosition(0, 1)).toBeNull();
    expect(meetingPosition(5, 3)).toEqual({ index: 2, position: 3, total: 5, prev: 2, next: 4 });
    expect(meetingPosition(5, 99)?.position).toBe(5);
    expect(meetingPosition(5, 99)?.next).toBeNull();
    expect(meetingPosition(5, 0)?.prev).toBeNull();
  });
});

describe("stageGroups", () => {
  it("pipeline order, flagged first, counts", () => {
    const g = stageGroups(reviewBuckets([
      row({ key: "a", stageLabel: "Late", stageOrder: 100_020, nextStep: null }),
      row({ key: "b", stageLabel: "Early", stageOrder: 100_010 }),
      row({ key: "c", stageLabel: "Early", stageOrder: 100_010, nextStep: null }),
      row({ key: "d", kind: "lead", stageLabel: "Lead stage", stageOrder: 2 }),
    ], TODAY));
    expect(g.map((x) => x.label)).toEqual(["Lead stage", "Early", "Late"]);
    expect(g[1].rows.map((r) => r.key)).toEqual(["c", "b"]);
    expect(g[1].flagged).toBe(1);
  });
});

describe("kpis", () => {
  it("counts, and a failed approvals source is null not 0", () => {
    const b = reviewBuckets(rows, TODAY);
    expect(kpis(b, rows, true)).toMatchObject({ overdue: 2, week: 1, needs: 2, uspto: 1, approval: 0 });
    expect(kpis(b, rows, false).approval).toBeNull();
  });
});
