import { describe, it, expect } from "vitest";
import {
  PHASE_GROUPS,
  boardStagesForGroup,
  filterByPhaseGroup,
  firmHasPhases,
  isMissingColumnError,
  isPhaseGroup,
  phaseGroupCounts,
  phaseGroupOf,
  stagesForGroup,
} from "@/lib/matters/phase-group";

const m = (type: string, phase: string | null | undefined, extra: Record<string, unknown> = {}) => ({
  type,
  stage: phase === undefined ? null : { phase, label: "ignored", code: "ignored" },
  stage_id: phase === undefined ? null : "s",
  ...extra,
});

describe("phaseGroupOf: phase and type, never stage names", () => {
  it("puts filed types in the group their stage's phase names", () => {
    for (const type of ["TM", "CR", "PATENT"]) {
      expect(phaseGroupOf(m(type, "pipeline"))).toBe("intake");
      expect(phaseGroupOf(m(type, "pre_filing"))).toBe("pre");
      expect(phaseGroupOf(m(type, "post_filing"))).toBe("post");
      expect(phaseGroupOf(m(type, "maintenance"))).toBe("post");
    }
  });

  it("does not fold pipeline into Pre-filing", () => {
    expect(phaseGroupOf(m("TM", "pipeline"))).not.toBe(phaseGroupOf(m("TM", "pre_filing")));
  });

  it("puts every other type in Matters, whatever its stage's phase says", () => {
    for (const type of ["BL", "EL", "SO", "LIT", "WHATEVER"]) {
      for (const phase of ["pipeline", "pre_filing", "post_filing", "maintenance", null]) expect(phaseGroupOf(m(type, phase))).toBe("other");
    }
  });

  it("puts a matter with no stage, or a null, missing or unknown phase, in Matters", () => {
    expect(phaseGroupOf(m("TM", undefined))).toBe("other");
    expect(phaseGroupOf(m("TM", null))).toBe("other");
    expect(phaseGroupOf({ type: "TM", stage: {} })).toBe("other");
    expect(phaseGroupOf(m("TM", "retired"))).toBe("other");
    expect(phaseGroupOf(m("CR", ""))).toBe("other");
  });

  it("never reads the stage name: a label that says filed or intake changes nothing", () => {
    expect(phaseGroupOf({ type: "TM", stage: { phase: "post_filing", label: "Potential New Client", code: "1" } as never })).toBe("post");
    expect(phaseGroupOf({ type: "TM", stage: { phase: null, label: "Filed", code: "9" } as never })).toBe("other");
  });

  it("a prod-shaped sample: every matter lands in exactly one group and nothing is lost", () => {
    const sample = [
      ...Array.from({ length: 29 }, () => m("TM", "pipeline")),
      ...Array.from({ length: 34 }, () => m("TM", "pre_filing")),
      ...Array.from({ length: 42 }, () => m("TM", "post_filing")),
      ...Array.from({ length: 23 }, () => m("BL", undefined)),
      m("LIT", undefined),
      m("TM", null),
      m("PATENT", "maintenance"),
    ];
    const counts = phaseGroupCounts(sample);
    expect(counts).toEqual({ intake: 29, pre: 34, post: 43, other: 25 });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(sample.length);
    // Each matter is in exactly one group's filter.
    for (const row of sample) expect(PHASE_GROUPS.filter((g) => filterByPhaseGroup([row], g).length === 1)).toHaveLength(1);
    expect(PHASE_GROUPS.flatMap((g) => filterByPhaseGroup(sample, g))).toHaveLength(sample.length);
  });
});

describe("firmHasPhases", () => {
  it("is false with no stages, no phase column, or only null / unknown phases", () => {
    expect(firmHasPhases([])).toBe(false);
    expect(firmHasPhases([{}, {}])).toBe(false);
    expect(firmHasPhases([{ phase: null }, { phase: "mystery" }])).toBe(false);
  });
  it("is true when any stage has a known phase", () => {
    expect(firmHasPhases([{ phase: null }, { phase: "pre_filing" }])).toBe(true);
    expect(firmHasPhases([{ phase: "maintenance" }])).toBe(true);
  });
});

describe("the groups' stages", () => {
  const stages = [
    { id: "a", phase: "pipeline" },
    { id: "b", phase: "pre_filing" },
    { id: "c", phase: "post_filing" },
    { id: "d", phase: "maintenance" },
    { id: "e", phase: null },
    { id: "f" },
  ];
  it("each phase group gets its own stages; Matters gets the ones with no known phase", () => {
    expect(stagesForGroup(stages, "intake").map((s) => s.id)).toEqual(["a"]);
    expect(stagesForGroup(stages, "pre").map((s) => s.id)).toEqual(["b"]);
    expect(stagesForGroup(stages, "post").map((s) => s.id)).toEqual(["c", "d"]);
    expect(stagesForGroup(stages, "other").map((s) => s.id)).toEqual(["e", "f"]);
  });
  it("a Matters-group matter sitting on a phased stage still gets that stage's column", () => {
    expect(boardStagesForGroup(stages, "other", [{ stage_id: "a" }, { stage_id: null }]).map((s) => s.id)).toEqual(["a", "e", "f"]);
    expect(boardStagesForGroup(stages, "pre", [{ stage_id: "b" }]).map((s) => s.id)).toEqual(["b"]);
  });
});

describe("small helpers", () => {
  it("isPhaseGroup", () => {
    expect(isPhaseGroup("pre")).toBe(true);
    expect(isPhaseGroup("all")).toBe(false);
    expect(isPhaseGroup(undefined)).toBe(false);
  });
  it("isMissingColumnError reads the CODE only", () => {
    expect(isMissingColumnError({ code: "42703" })).toBe(true);
    expect(isMissingColumnError({ code: "PGRST204" })).toBe(true);
    expect(isMissingColumnError({ code: "XX000" })).toBe(false);
    expect(isMissingColumnError({ code: undefined, message: 'column "phase" does not exist' } as never)).toBe(false);
    expect(isMissingColumnError(null)).toBe(false);
  });
});

import { parseGroupChoice, filterByGroupChoice, boardStagesForChoice } from "@/lib/matters/phase-group";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("the All choice", () => {
  it("parseGroupChoice accepts all and the four groups, nothing else", () => {
    expect(parseGroupChoice("all")).toBe("all");
    expect(parseGroupChoice("post")).toBe("post");
    expect(parseGroupChoice("nope")).toBeNull();
    expect(parseGroupChoice(undefined)).toBeNull();
  });
  it("lists every matter exactly once", () => {
    const rows = [m("TM", "pipeline"), m("TM", "pre_filing"), m("BL", undefined), m("CR", "maintenance")];
    expect(filterByGroupChoice(rows, "all")).toHaveLength(rows.length);
    expect(filterByGroupChoice(rows, "all")).toEqual(rows);
  });
  it("draws every stage on the All board", () => {
    const stages = [{ id: "a", phase: "pipeline" }, { id: "b", phase: null }];
    expect(boardStagesForChoice(stages, "all", []).map((s) => s.id)).toEqual(["a", "b"]);
  });
});

describe("links from other pages carry group=all so their numbers match on arrival", () => {
  const src = (f: string) => readFileSync(path.resolve(__dirname, "../..", f), "utf8");
  it.each([
    ["src/app/dashboard/page.tsx", ["group=all&seg=firm", "group=all&seg=${w}", "group=all&seg=stalled"]],
    ["src/app/dashboard/pipeline/page.tsx", ["group=all&view=board"]],
    ["src/lib/copilot/stats.ts", ["group=all&seg=stalled"]],
  ])("%s", (file, needles) => {
    const text = src(file);
    for (const n of needles) expect(text).toContain(n);
    expect(text).not.toMatch(/dashboard\/matters\/\?(seg|view)=/);
  });
});

describe("defaultGroupChoice", () => {
  const counts = (o: Partial<Record<"intake" | "pre" | "post" | "other", number>>) => ({ intake: 0, pre: 0, post: 0, other: 0, ...o });
  it("is Pre-filing when it holds a matter for the status filter", async () => {
    const { defaultGroupChoice } = await import("../../src/lib/matters/phase-group");
    expect(defaultGroupChoice(counts({ pre: 1, post: 5 }))).toBe("pre");
  });
  it("falls back to All when Pre-filing is empty", async () => {
    const { defaultGroupChoice } = await import("../../src/lib/matters/phase-group");
    expect(defaultGroupChoice(counts({ post: 4 }))).toBe("all");
    expect(defaultGroupChoice(counts({ other: 2 }))).toBe("all");
    expect(defaultGroupChoice(counts({}))).toBe("all");
  });
  it("an explicit ?group= wins, even an empty group", async () => {
    const { defaultGroupChoice, parseGroupChoice } = await import("../../src/lib/matters/phase-group");
    const c = counts({ post: 4 });
    // Intake is not a choice any more (Nov 17): an old link to it opens the default.
    expect(parseGroupChoice("intake")).toBeNull();
    expect(parseGroupChoice("intake") ?? defaultGroupChoice(c)).toBe("all");
    expect(parseGroupChoice("pre") ?? defaultGroupChoice(c)).toBe("pre");
    expect(parseGroupChoice("nope") ?? defaultGroupChoice(c)).toBe("all");
  });
});

describe("intake stages (Nov 17): pipeline-phase stages before Signed LOE / Deposit Received", () => {
  const st = (id: string, label: string, order_index: number | null, phase?: string | null) => ({ id, label, order_index, ...(phase === undefined ? {} : { phase }) });
  const rpb = [
    st("a", "Potential New Client", 0, "pipeline"),
    st("b", "Preliminary Search", 1, "pipeline"),
    st("hired", "Signed LOE / Deposit Received", 6, "pipeline"),
    st("pre", "Application Preparation", 7, "pre_filing"),
    st("post", "Filed", 16, "post_filing"),
    st("closed", "Abandoned", 22, "inactive"),
    st("done", "Trademark Registered", 23, "maintenance"),
    st("nul", "Lost/Nurture", 24, null),
  ];

  it("hides pipeline stages before the hired-sync stage; keeps that stage and every other phase, including null", async () => {
    const { intakeStageIds, pastLoeView } = await import("../../src/lib/matters/phase-group");
    expect([...intakeStageIds(rpb)].sort()).toEqual(["a", "b"]);
    const view = pastLoeView([{ stage_id: "a", stage: { phase: "pipeline" } }, { stage_id: "hired", stage: { phase: "pipeline" } }, { stage_id: "nul", stage: { phase: null } }, { stage_id: null, stage: null }], rpb, intakeStageIds(rpb));
    expect(view.intake).toHaveLength(1);
    expect(view.matters).toHaveLength(3);
    // The Signed LOE stage is shown as Pre-filing, so its matters land in a group; the null-phase stage is untouched.
    expect(view.stages.find((s) => s.id === "hired")?.phase).toBe("pre_filing");
    expect(view.stages.find((s) => s.id === "nul")?.phase).toBeNull();
    expect(view.stages.map((s) => s.id)).not.toContain("a");
  });

  it("the stage is the one the hired sync files into: the shared label rule, not a second match", async () => {
    const { TM_HIRED_STAGE_LABEL, isHiredStage } = await import("../../src/lib/matters/hired-stage");
    const plan = await import("../../src/lib/lawmatics/hired-sync-plan");
    expect(plan.TM_HIRED_STAGE_LABEL).toBe(TM_HIRED_STAGE_LABEL);
    expect(isHiredStage({ label: TM_HIRED_STAGE_LABEL })).toBe(true);
    expect(isHiredStage({ label: "signed loe / deposit received" })).toBe(false);
  });

  it("a firm with no such stage hides every pipeline-phase stage, as before; no phase column hides nothing", async () => {
    const { intakeStageIds } = await import("../../src/lib/matters/phase-group");
    expect([...intakeStageIds([st("a", "New", 0, "pipeline"), st("b", "Next", 1, "pipeline"), st("c", "Filed", 2, "post_filing")])].sort()).toEqual(["a", "b"]);
    expect(intakeStageIds([st("a", "New", 0), st("b", "Filed", 1)]).size).toBe(0);
  });

  it("a pipeline stage ordered after Signed LOE stays visible; ties break the way the pipeline order does", async () => {
    const { intakeStageIds } = await import("../../src/lib/matters/phase-group");
    const s = [st("x", "Early", 1, "pipeline"), st("h", "Signed LOE / Deposit Received", 2, "pipeline"), st("y", "Late", 3, "pipeline")];
    expect([...intakeStageIds(s)]).toEqual(["x"]);
  });

  it("the stage name never decides anything but the hired stage's own label", async () => {
    const { intakeStageIds } = await import("../../src/lib/matters/phase-group");
    expect([...intakeStageIds([st("a", "Filed", 0, "pipeline"), st("b", "Intake review", 1, "pre_filing")])]).toEqual(["a"]);
  });
});
