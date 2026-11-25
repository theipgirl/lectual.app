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
  it("lead: groups ids by stage and leaves merged leads out", async () => {
    h.rows = [
      { id: "l1", current_stage_id: "a" },
      { id: "l2", current_stage_id: "a" },
      { id: "l3", current_stage_id: "b" },
    ];
    expect(await loadStageHoldings("lead")).toEqual({ status: "ok", byStage: { a: ["l1", "l2"], b: ["l3"] } });
    expect(h.calls[0]).toEqual({ table: "crm_lead", is: true });
  });
  it("matter: every matter, any status", async () => {
    h.rows = [{ id: "m1", stage_id: "s" }];
    expect(await loadStageHoldings("matter")).toEqual({ status: "ok", byStage: { s: ["m1"] } });
    expect(h.calls[0]).toEqual({ table: "crm_matter", is: false });
  });
  it("a failed read is unavailable, never empty", async () => {
    h.error = { code: "XX000" };
    expect(await loadStageHoldings("matter")).toEqual({ status: "unavailable" });
  });
});
