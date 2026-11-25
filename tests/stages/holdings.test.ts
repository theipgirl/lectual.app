import { beforeEach, describe, expect, it, vi } from "vitest";

/** What each stage holds, for the delete dialog: live leads only (merged left out), paged, and a failed page is "unavailable". */
const h = vi.hoisted(() => ({ calls: [] as Array<{ table: string; is: boolean }>, rows: [] as Array<Record<string, unknown>>, error: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        not: () => {
          const call = { table, is: false };
          h.calls.push(call);
          const chain = {
            is: () => ((call.is = true), chain),
            order: () => chain,
            range: async () => ({ data: h.error ? null : h.rows, error: h.error }),
          };
          return chain;
        },
      }),
    }),
  }),
}));

const { loadStageHoldings } = await import("@/lib/stages/holdings");

beforeEach(() => {
  h.calls = [];
  h.rows = [];
  h.error = null;
});

describe("loadStageHoldings", () => {
  it("lead: groups live ids by stage; merged leads are COUNTED per stage, never listed", async () => {
    h.rows = [
      { id: "l1", current_stage_id: "a", merged_into_id: null },
      { id: "l2", current_stage_id: "a", merged_into_id: null },
      { id: "l3", current_stage_id: "b", merged_into_id: null },
      { id: "dup1", current_stage_id: "a", merged_into_id: "l1" },
      { id: "dup2", current_stage_id: "c", merged_into_id: "l3" },
    ];
    const got = await loadStageHoldings("lead");
    expect(got).toEqual({ status: "ok", byStage: { a: ["l1", "l2"], b: ["l3"] }, merged: { a: 1, c: 1 } });
    expect(JSON.stringify(got)).not.toContain("dup");
    // Read WITHOUT the live filter: a merged lead still sits in the stage.
    expect(h.calls[0]).toEqual({ table: "crm_lead", is: false });
  });
  it("matter: every matter, any status", async () => {
    h.rows = [{ id: "m1", stage_id: "s" }];
    expect(await loadStageHoldings("matter")).toEqual({ status: "ok", byStage: { s: ["m1"] }, merged: {} });
    expect(h.calls[0]).toEqual({ table: "crm_matter", is: false });
  });
  it("a failed read is unavailable, never empty", async () => {
    h.error = { code: "XX000" };
    expect(await loadStageHoldings("matter")).toEqual({ status: "unavailable" });
  });
});
