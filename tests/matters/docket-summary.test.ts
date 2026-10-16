import { describe, it, expect } from "vitest";
import {
  summarizeDocket,
  isOpenMatter,
  matterLabel,
  type DocketMatterInput,
} from "@/lib/matters/docket-summary";
import { STALE_THRESHOLD_DAYS } from "@/lib/matters/stage-rules";

const NOW = new Date("2026-08-19T12:00:00Z");
const DAY = 86_400_000;

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * DAY).toISOString();
}

function matter(overrides: Partial<DocketMatterInput> = {}): DocketMatterInput {
  return {
    id: "m-1",
    matter_number: "RPB-0001",
    title: "Trademark — Doe Studio",
    mark_text: "DOE STUDIO",
    status: "open",
    stage_entered_at: daysAgo(3),
    stage: { code: "07", label: "Search in progress", is_open: true, waiting_on: "firm" },
    ...overrides,
  };
}

describe("summarizeDocket — the home page's docket arithmetic", () => {
  it("counts an empty docket as empty without inventing anything", () => {
    const summary = summarizeDocket([], NOW);
    expect(summary).toEqual({
      total: 0,
      open: 0,
      waitingOn: { firm: 0, client: 0, uspto: 0, court: 0 },
      unplaced: 0,
      stalled: [],
    });
  });

  it("splits open from closed on EITHER signal — status or a closed stage", () => {
    const matters = [
      matter({ id: "open-1" }),
      matter({ id: "closed-status", status: "closed" }),
      matter({
        id: "closed-stage",
        stage: { code: "24", label: "Registered", is_open: false, waiting_on: "firm" },
      }),
      matter({ id: "on-hold", status: "on_hold" }),
    ];
    const summary = summarizeDocket(matters, NOW);
    // on_hold is not closed — the file is still the firm's problem.
    expect(summary.open).toBe(2);
    expect(summary.total).toBe(4);
  });

  it("breaks the OPEN docket down by who is holding each matter", () => {
    const matters = [
      matter({ id: "a", stage: { code: "07", label: "Search", is_open: true, waiting_on: "firm" } }),
      matter({ id: "b", stage: { code: "09", label: "Specimens", is_open: true, waiting_on: "client" } }),
      matter({ id: "c", stage: { code: "14", label: "Filed", is_open: true, waiting_on: "uspto" } }),
      matter({ id: "d", stage: { code: "14", label: "Filed", is_open: true, waiting_on: "uspto" } }),
      // Closed matters are not "waiting" on anyone.
      matter({
        id: "e",
        status: "closed",
        stage: { code: "14", label: "Filed", is_open: true, waiting_on: "uspto" },
      }),
    ];
    const summary = summarizeDocket(matters, NOW).waitingOn;
    expect(summary).toEqual({ firm: 1, client: 1, uspto: 2, court: 0 });
  });

  it("counts an unplaced matter as OPEN and reports it separately, never dropping it", () => {
    const summary = summarizeDocket(
      [matter({ id: "no-stage", stage: null, stage_entered_at: null })],
      NOW,
    );
    // The single worst outcome would be a matter that exists but is in no
    // total anywhere — invisible work.
    expect(summary.open).toBe(1);
    expect(summary.unplaced).toBe(1);
    expect(summary.waitingOn).toEqual({ firm: 0, client: 0, uspto: 0, court: 0 });
    expect(summary.stalled).toEqual([]);
  });

  it("flags a stale matter against ITS OWN threshold, not a single global one", () => {
    const matters = [
      // 60 days waiting on the USPTO is normal (120d fuse) — not stale.
      matter({
        id: "uspto-quiet",
        stage_entered_at: daysAgo(60),
        stage: { code: "14", label: "Filed", is_open: true, waiting_on: "uspto" },
      }),
      // 60 days with the ball on the firm's side (30d fuse) is a problem.
      matter({
        id: "firm-quiet",
        stage_entered_at: daysAgo(60),
        stage: { code: "07", label: "Search in progress", is_open: true, waiting_on: "firm" },
      }),
    ];
    const stalled = summarizeDocket(matters, NOW).stalled;
    expect(stalled.map((m) => m.id)).toEqual(["firm-quiet"]);
    expect(stalled[0].daysInStage).toBe(60);
    expect(stalled[0].daysOverThreshold).toBe(60 - STALE_THRESHOLD_DAYS.firm);
  });

  it("never flags a closed matter, however long it has sat", () => {
    const stalled = summarizeDocket(
      [
        matter({ id: "done", status: "closed", stage_entered_at: daysAgo(900) }),
        matter({
          id: "registered",
          stage_entered_at: daysAgo(900),
          stage: { code: "24", label: "Registered", is_open: false, waiting_on: "firm" },
        }),
      ],
      NOW,
    ).stalled;
    expect(stalled).toEqual([]);
  });

  it("orders the stalled list worst-first so the home page's top four are the top four", () => {
    const matters = [
      matter({ id: "a", mark_text: "ALPHA", stage_entered_at: daysAgo(40) }),
      matter({ id: "b", mark_text: "BETA", stage_entered_at: daysAgo(120) }),
      matter({ id: "c", mark_text: "GAMMA", stage_entered_at: daysAgo(75) }),
    ];
    expect(summarizeDocket(matters, NOW).stalled.map((m) => m.label)).toEqual([
      "BETA",
      "GAMMA",
      "ALPHA",
    ]);
  });

  it("carries the stage chip and matter number a stalled row needs to be actionable", () => {
    const [row] = summarizeDocket(
      [
        matter({
          id: "m-9",
          matter_number: "RPB-0099",
          mark_text: "QUIET MARK",
          stage_entered_at: daysAgo(200),
          stage: { code: "19A", label: "Office Action outstanding", is_open: true, waiting_on: "uspto" },
        }),
      ],
      NOW,
    ).stalled;
    expect(row).toMatchObject({
      id: "m-9",
      label: "QUIET MARK",
      matterNumber: "RPB-0099",
      stageCode: "19A",
      stageLabel: "Office Action outstanding",
      waitingOn: "uspto",
      daysInStage: 200,
      daysOverThreshold: 80,
    });
  });

  it("is exclusive at the threshold — day 30 is fine, day 31 is stale", () => {
    const at = summarizeDocket([matter({ stage_entered_at: daysAgo(30) })], NOW).stalled;
    const past = summarizeDocket([matter({ stage_entered_at: daysAgo(31) })], NOW).stalled;
    expect(at).toHaveLength(0);
    expect(past).toHaveLength(1);
  });
});

describe("matterLabel", () => {
  it("prefers the mark, falls back to the title, then to the matter number", () => {
    expect(matterLabel(matter())).toBe("DOE STUDIO");
    expect(matterLabel(matter({ mark_text: null }))).toBe("Trademark — Doe Studio");
    expect(matterLabel(matter({ mark_text: "   ", title: null }))).toBe("RPB-0001");
  });
});

describe("isOpenMatter", () => {
  it("treats an unplaced, non-closed matter as open", () => {
    expect(isOpenMatter(matter({ stage: null }))).toBe(true);
  });
});
