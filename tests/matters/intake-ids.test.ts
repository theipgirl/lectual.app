import { beforeEach, describe, expect, it, vi } from "vitest";

const stages = [
  { id: "a", code: "1", label: "Potential New Client", order_index: 0, is_open: true, waiting_on: "firm", phase: "pipeline" },
  { id: "h", code: "7", label: "Signed LOE / Deposit Received", order_index: 6, is_open: true, waiting_on: "firm", phase: "pipeline" },
  { id: "n", code: "25", label: "Lost/Nurture", order_index: 24, is_open: false, waiting_on: "firm", phase: null },
];
let read: unknown;
beforeEach(() => {
  vi.resetModules();
  vi.doMock("@/lib/matters/stages", () => ({ loadMatterStages: vi.fn(async () => { if (read instanceof Error) throw read; return read; }) }));
});

describe("Today and Copilot count matters the way the Matters page draws them", () => {
  it("drops matters in intake stages; keeps Signed LOE and the null-phase matter", async () => {
    read = { status: "ok", stages };
    const { loadIntakeStageIds, withoutIntake } = await import("../../src/lib/matters/intake-ids");
    const ids = await loadIntakeStageIds();
    expect([...(ids ?? [])]).toEqual(["a"]);
    const kept = withoutIntake([{ stage_id: "a" }, { stage_id: "h" }, { stage_id: "n" }, { stage_id: null }], ids);
    expect(kept.map((m) => m.stage_id)).toEqual(["h", "n", null]);
  });
  it("a database with no phase column has no intake; a failed or thrown read is unknown and counts every matter", async () => {
    const { loadIntakeStageIds, withoutIntake } = await import("../../src/lib/matters/intake-ids");
    read = { status: "not-set-up", stages };
    expect((await loadIntakeStageIds())?.size).toBe(0);
    read = { status: "unavailable", error: new Error("x") };
    const unknown = await loadIntakeStageIds();
    expect(unknown).toBeNull();
    expect(withoutIntake([{ stage_id: "a" }], unknown)).toHaveLength(1);
    read = new Error("boom");
    expect(await loadIntakeStageIds()).toBeNull();
  });
});
