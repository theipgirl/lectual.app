import { describe, expect, it } from "vitest";
import { reviewBuckets } from "@/lib/review/buckets";
import { boardLanes, kpis, laneOf, meetingPosition, offBoard, placeOnBoard } from "@/lib/review/lanes";
import { followUpText } from "@/lib/review/format";
import { row, TODAY } from "./fixtures";

const members = [
  { userId: "u-rayn", name: "Rayn", role: "paralegal" },
  { userId: "u-reb", name: "Rebecca", role: "owner" },
  { userId: "u-amor", name: "Amor", role: "intake" },
];
const step = (dueDate: string | null, assigneeId: string | null) => ({ id: "t", title: "x", dueDate, assigneeId });
const rows = [
  row({ key: "1", client: "A", waiting: "us", nextStep: step("2026-10-30", "u-rayn") }),
  row({ key: "2", client: "B", waiting: "us", nextStep: step("2026-11-03", "u-reb") }),
  row({ key: "3", client: "C", waiting: "us", nextStep: null, assignedTo: "u-amor" }),
  row({ key: "4", client: "D", waiting: "us", nextStep: null }),
  row({ key: "5", client: "E", waiting: "us", nextStep: step("2026-10-01", null), assignedTo: "u-rayn" }),
  row({ key: "6", client: "F", waiting: "uspto", nextStep: null }),
  row({ key: "7", client: "G", waiting: null }), // on track, nothing waiting
];

describe("laneOf", () => {
  it("next-step assignee, else the record's, else none", () => {
    expect(laneOf(rows[0])).toBe("u-rayn");
    expect(laneOf(rows[2])).toBe("u-amor");
    expect(laneOf(rows[3])).toBeNull();
    expect(laneOf(row({ assignedTo: "u-amor", nextStep: step(null, "u-reb") }))).toBe("u-reb");
  });
});

describe("placeOnBoard", () => {
  it("waiting on the client wins over every bucket", () => {
    expect(placeOnBoard(row({ waiting: "client" }), "overdue")).toBe("client");
    expect(placeOnBoard(row({ waiting: "client" }), "track")).toBe("client");
  });
  it("flagged buckets, and on-track rows waiting on us or an approval, are our move", () => {
    expect(placeOnBoard(row({ waiting: "us" }), "needs")).toBe("our");
    expect(placeOnBoard(row({ waiting: null }), "week")).toBe("our");
    expect(placeOnBoard(row({ waiting: "us" }), "track")).toBe("our");
    expect(placeOnBoard(row({ waiting: "approval" }), "track")).toBe("our");
  });
  it("USPTO and quiet-nothing on-track stay off the board", () => {
    expect(placeOnBoard(row({ waiting: "uspto" }), "uspto")).toBeNull();
    expect(placeOnBoard(row({ waiting: null }), "track")).toBeNull();
  });
});

describe("boardLanes", () => {
  const b = reviewBuckets(rows, TODAY);
  const lanes = boardLanes(b, members);
  it("owner first, then alphabetical, Unassigned last", () => {
    expect(lanes.map((l) => l.name)).toEqual(["Rebecca", "Amor", "Rayn", "Unassigned"]);
  });
  it("each lane splits Our move and Waiting on client", () => {
    const rayn = lanes.find((l) => l.name === "Rayn")!;
    expect(rayn.our.map((r) => r.key).sort()).toEqual(["1", "5"]);
    expect(rayn.client).toEqual([]);
    expect(lanes.reduce((n, l) => n + l.count, 0)).toBe(5);
  });
  it("a waiting-on-client row goes to that list of its person's lane, longest since follow-up first", () => {
    const rs = [
      row({ key: "c1", client: "Zed", waiting: "client", lastOutbound: "2026-10-30", assignedTo: "u-reb" }),
      row({ key: "c2", client: "Abe", waiting: "client", lastOutbound: "2026-10-20", assignedTo: "u-reb" }),
      row({ key: "c3", client: "Mid", waiting: "client", lastOutbound: null, assignedTo: "u-reb" }),
      row({ key: "o1", client: "Ours", waiting: "us", nextStep: step("2026-10-01", "u-reb") }),
    ];
    const [reb] = boardLanes(reviewBuckets(rs, TODAY), members);
    expect(reb.client.map((r) => r.key)).toEqual(["c3", "c2", "c1"]);
    expect(reb.our.map((r) => r.key)).toEqual(["o1"]);
  });
  it("USPTO and quiet on-track rows are the collapsed lists, not lanes", () => {
    const off = offBoard(b);
    expect(off.uspto.map((r) => r.key)).toEqual(["6"]);
    expect(off.track.map((r) => r.key)).toEqual(["7"]);
  });
  it("an unknown assignee reads Teammate", () => {
    const l = boardLanes(reviewBuckets([row({ nextStep: step("2026-10-01", "gone") })], TODAY), members);
    expect(l[0].name).toBe("Teammate");
  });
  it("no rows on the board, no lanes", () => {
    expect(boardLanes(reviewBuckets([row({ waiting: null })], TODAY), members)).toEqual([]);
  });
});

describe("followUpText", () => {
  it("date and days, fixed sentences for none and unknown", () => {
    expect(followUpText({ contactKnown: true, lastOutbound: "2026-10-28" }, TODAY)).toBe("Last followed up Oct 28 · 5 days");
    expect(followUpText({ contactKnown: true, lastOutbound: "2026-11-01" }, TODAY)).toBe("Last followed up Nov 1 · 1 day");
    expect(followUpText({ contactKnown: true, lastOutbound: "2026-11-02" }, TODAY)).toBe("Last followed up Nov 2 · today");
    expect(followUpText({ contactKnown: true, lastOutbound: null }, TODAY)).toBe("No follow-up recorded");
    expect(followUpText({ contactKnown: false, lastOutbound: null }, TODAY)).toBe("Follow-up couldn't be loaded");
  });
});

describe("meetingPosition (Cards)", () => {
  it("positions clamp and link", () => {
    expect(meetingPosition(0, 1)).toBeNull();
    expect(meetingPosition(5, 3)).toEqual({ index: 2, position: 3, total: 5, prev: 2, next: 4 });
    expect(meetingPosition(5, 99)?.next).toBeNull();
  });
});

describe("kpis", () => {
  it("counts the four attention buckets", () => {
    expect(kpis(reviewBuckets(rows, TODAY))).toEqual({ overdue: 2, week: 1, needs: 2, uspto: 1 });
  });
});
