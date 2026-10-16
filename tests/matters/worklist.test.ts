import { describe, it, expect } from "vitest";
import type { Matter } from "@/lib/matters";
import type { MatterStage } from "@/lib/matters/stages";
import { bandOf, filterBySegment, groupIntoBands, isSegment, searchMatters, stageAge } from "@/lib/matters/worklist";

const NOW = new Date("2026-09-26T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function stage(waiting_on: MatterStage["waiting_on"], is_open = true): MatterStage {
  return { id: `s-${waiting_on}-${is_open}`, code: "10", label: "Preparing", order_index: 1, is_open, waiting_on };
}

function matter(o: Partial<Matter> = {}): Matter {
  return {
    id: "m1",
    matter_number: "TM-2026-0001",
    mark_text: "ACME",
    title: null,
    owner_name: null,
    serial_number: null,
    registration_number: null,
    status: "open",
    assigned_to: null,
    stage: null,
    stage_entered_at: null,
    ...o,
  } as Matter;
}

describe("bandOf", () => {
  it("uses the stage's waiting_on for an open matter", () => {
    expect(bandOf(matter({ stage: stage("client") }))).toBe("client");
  });
  it("puts a matter with no stage in its own band rather than dropping it", () => {
    expect(bandOf(matter())).toBe("unplaced");
  });
  it("closes on either signal: status closed, or a terminal stage", () => {
    expect(bandOf(matter({ status: "closed", stage: stage("firm") }))).toBe("closed");
    expect(bandOf(matter({ stage: stage("uspto", false) }))).toBe("closed");
  });
});

describe("groupIntoBands", () => {
  it("orders bands firm → client → uspto → court → unplaced → closed, skipping empty ones", () => {
    const bands = groupIntoBands(
      [
        matter({ id: "a", status: "closed" }),
        matter({ id: "b", stage: stage("uspto") }),
        matter({ id: "c", stage: stage("firm") }),
      ],
      NOW,
    );
    expect(bands.map((b) => b.key)).toEqual(["firm", "uspto", "closed"]);
  });
  it("puts the longest-in-stage first within a band, unknown ages last", () => {
    const [band] = groupIntoBands(
      [
        matter({ id: "new", stage: stage("firm"), stage_entered_at: daysAgo(2) }),
        matter({ id: "none", stage: stage("firm") }),
        matter({ id: "old", stage: stage("firm"), stage_entered_at: daysAgo(40) }),
      ],
      NOW,
    );
    expect(band.matters.map((m) => m.id)).toEqual(["old", "new", "none"]);
  });
  it("never loses a matter", () => {
    const all = [matter({ id: "1" }), matter({ id: "2", status: "on_hold", stage: stage("court") }), matter({ id: "3", status: "closed" })];
    expect(groupIntoBands(all, NOW).flatMap((b) => b.matters).length).toBe(3);
  });
});

describe("filterBySegment", () => {
  const sets = { review: new Set(["r"]), stalled: new Set(["s"]) };
  const all = [
    matter({ id: "r", stage: stage("firm"), assigned_to: "u1" }),
    matter({ id: "s", stage: stage("client") }),
    matter({ id: "x", status: "closed" }),
  ];
  it("'open' drops closed matters and 'all' keeps them", () => {
    expect(filterBySegment(all, "open", sets).map((m) => m.id)).toEqual(["r", "s"]);
    expect(filterBySegment(all, "all", sets)).toHaveLength(3);
  });
  it("filters by waiting_on, review and stalled sets, and unassigned open matters", () => {
    expect(filterBySegment(all, "client", sets).map((m) => m.id)).toEqual(["s"]);
    expect(filterBySegment(all, "review", sets).map((m) => m.id)).toEqual(["r"]);
    expect(filterBySegment(all, "stalled", sets).map((m) => m.id)).toEqual(["s"]);
    expect(filterBySegment(all, "unassigned", sets).map((m) => m.id)).toEqual(["s"]);
    expect(filterBySegment(all, "closed", sets).map((m) => m.id)).toEqual(["x"]);
  });
  it("rejects unknown segments from the URL", () => {
    expect(isSegment("firm")).toBe(true);
    expect(isSegment("drop table")).toBe(false);
    expect(isSegment(undefined)).toBe(false);
  });
});

describe("stageAge", () => {
  it("flags a matter past its stage's threshold", () => {
    const old = stageAge(matter({ stage: stage("firm"), stage_entered_at: daysAgo(400) }), NOW);
    expect(old.days).toBe(400);
    expect(old.stale).toBe(true);
    expect(stageAge(matter({ stage: stage("firm"), stage_entered_at: daysAgo(1) }), NOW).stale).toBe(false);
  });
  it("never flags a closed matter", () => {
    expect(stageAge(matter({ status: "closed", stage: stage("firm"), stage_entered_at: daysAgo(400) }), NOW).stale).toBe(false);
  });
});

describe("searchMatters", () => {
  it("matches mark, number, owner and serial, case-insensitively", () => {
    const all = [matter({ id: "1", mark_text: "Bluebird" }), matter({ id: "2", mark_text: null, serial_number: "97123456" }), matter({ id: "3", mark_text: "X", owner_name: "Dana Ruiz" })];
    expect(searchMatters(all, "BLUE").map((m) => m.id)).toEqual(["1"]);
    expect(searchMatters(all, "9712").map((m) => m.id)).toEqual(["2"]);
    expect(searchMatters(all, "ruiz").map((m) => m.id)).toEqual(["3"]);
    expect(searchMatters(all, "  ")).toHaveLength(3);
  });
});
