import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writesTo } from "../matters/helpers/fake-db";
import { ORG, S } from "./helpers";
import { L, leadRow, makeWorld } from "./world";

/**
 * moveLeadStage gains an optional third parameter, the date a lead really entered its stage.
 * These run the REAL function (and its real timeline logging) over the in-memory scoped client.
 */

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function setup(role = "admin") {
  const world = makeWorld({ role, leads: [leadRow({ id: L.amara, org_id: ORG, current_stage_id: S.pnc, stage_entered_at: "2026-08-01T00:00:00Z" })] });
  vi.resetModules();
  vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: vi.fn(async () => world.client) }));
  const { moveLeadStage } = await import("../../src/lib/pipeline/leads");
  const leadUpdate = () => writesTo(world.db, "crm_lead").find((w) => w.op === "update")!.payload as Record<string, unknown>;
  const stageChanged = () => world.db.activity().filter((a) => a.type === "stage_changed");
  return { world, moveLeadStage, leadUpdate, stageChanged };
}

describe("moveLeadStage with an evidence date", () => {
  it("stamps stage_entered_at with the date, last_activity_at with now, and records the date on the timeline row", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
    const { moveLeadStage, leadUpdate, stageChanged, world } = await setup();
    await moveLeadStage(L.amara, S.consult, "2026-09-03T00:00:00.000Z");
    expect(leadUpdate()).toEqual({
      current_stage_id: S.consult,
      stage_entered_at: "2026-09-03T00:00:00.000Z",
      last_activity_at: "2026-10-21T15:00:00.000Z",
    });
    expect(world.db.rows("crm_lead")[0]).toMatchObject({ current_stage_id: S.consult, stage_entered_at: "2026-09-03T00:00:00.000Z" });
    const [row] = stageChanged();
    expect(row.payload).toMatchObject({ from_stage: "Potential New Client", to_stage: "Consultation Scheduled", from_stage_id: S.pnc, to_stage_id: S.consult, evidence_at: "2026-09-03T00:00:00.000Z" });
  });

  it("accepts a date-only value and a full ISO instant", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
    const a = await setup();
    await a.moveLeadStage(L.amara, S.consult, "2026-09-03");
    expect(a.leadUpdate().stage_entered_at).toBe("2026-09-03T00:00:00.000Z");
    const b = await setup();
    await b.moveLeadStage(L.amara, S.consult, "2026-09-03T10:30:00Z");
    expect(b.leadUpdate().stage_entered_at).toBe("2026-09-03T10:30:00.000Z");
  });
});

describe("moveLeadStage without a usable evidence date stamps now, as before", () => {
  const unusable: Array<[string, string | null | undefined]> = [
    ["no third argument", undefined],
    ["null", null],
    ["an empty string", ""],
    ["a future date", "2027-01-01T00:00:00Z"],
    ["a date later today than now", "2026-10-21T15:00:01Z"],
    ["not a date", "yesterday"],
    ["not an ISO date", "Sep 3 2026"],
    ["a day that does not exist", "2026-02-31"],
    ["an hour that does not exist", "2026-09-03T25:00:00Z"],
    ["a number as text", "1788000000000"],
  ];
  it.each(unusable)("%s", async (_label, value) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
    const { moveLeadStage, leadUpdate, stageChanged } = await setup();
    if (value === undefined) await moveLeadStage(L.amara, S.consult);
    else await moveLeadStage(L.amara, S.consult, value);
    expect(leadUpdate().stage_entered_at).toBe("2026-10-21T15:00:00.000Z");
    expect(leadUpdate().stage_entered_at).toBe(leadUpdate().last_activity_at);
    expect(stageChanged()[0].payload).not.toHaveProperty("evidence_at");
    expect(stageChanged()[0].payload).toMatchObject({ to_stage_id: S.consult });
  });
});

describe("moveLeadStage keeps its role gate", () => {
  it("refuses a role that cannot move stages, even with an evidence date", async () => {
    const { moveLeadStage, world } = await setup("paralegal");
    await expect(moveLeadStage(L.amara, S.consult, "2026-09-03")).rejects.toThrow(/Forbidden/);
    expect(writesTo(world.db, "crm_lead")).toEqual([]);
  });
});
