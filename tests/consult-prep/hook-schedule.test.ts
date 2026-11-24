import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  after: [] as Array<() => unknown>,
  afterThrows: false,
  started: [] as unknown[],
  startThrows: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    if (state.afterThrows) throw new Error("`after` was called outside a request scope.");
    state.after.push(fn);
  },
}));
vi.mock("@/lib/consult-prep/trigger", () => ({
  startPrepOnStageEntries: async (_deps: unknown, moves: unknown) => {
    state.started.push(moves);
    if (state.startThrows) throw new Error("boom");
    return { outcomes: [], over: 0 };
  },
}));
vi.mock("@/lib/agents/deps", () => ({ productionRunnerDeps: () => ({}) }));

afterEach(() => {
  state.after = [];
  state.started = [];
  state.afterThrows = false;
  state.startThrows = false;
  vi.resetModules();
});

describe("scheduleConsultPrepOnEntry", () => {
  it("schedules with after(): nothing runs inside the move, the prep starts after the response", async () => {
    const { scheduleConsultPrepOnEntry } = await import("@/lib/consult-prep/hook");
    scheduleConsultPrepOnEntry({ leadId: "l1", toStageId: "s1" });
    expect(state.after).toHaveLength(1);
    expect(state.started).toHaveLength(0);
    await state.after[0]();
    expect(state.started).toEqual([[{ leadId: "l1", toStageId: "s1" }]]);
  });

  it("outside a request there is no after(): nothing is started and nothing throws", async () => {
    state.afterThrows = true;
    const { scheduleConsultPrepOnEntry } = await import("@/lib/consult-prep/hook");
    expect(() => scheduleConsultPrepOnEntry({ leadId: "l1", toStageId: "s1" })).not.toThrow();
    expect(state.started).toHaveLength(0);
  });

  it("moves made in ONE request are started together: one after(), one run for all the leads", async () => {
    const { scheduleConsultPrepOnEntry } = await import("@/lib/consult-prep/hook");
    for (const id of ["l1", "l2", "l3", "l4", "l5", "l6", "l7"]) scheduleConsultPrepOnEntry({ leadId: id, toStageId: "s1" });
    expect(state.after).toHaveLength(1);
    await state.after[0]();
    expect(state.started).toHaveLength(1);
    expect((state.started[0] as unknown[]).length).toBe(7); // trigger.ts caps one scoped run at five and counts the rest
  });

  it("a prep that throws is swallowed, and the next request's still runs (one at a time)", async () => {
    const { scheduleConsultPrepOnEntry } = await import("@/lib/consult-prep/hook");
    state.startThrows = true;
    scheduleConsultPrepOnEntry({ leadId: "l1", toStageId: "s1" });
    await state.after[0]();
    scheduleConsultPrepOnEntry({ leadId: "l2", toStageId: "s1" });
    await state.after[1]();
    expect(state.started).toEqual([[{ leadId: "l1", toStageId: "s1" }], [{ leadId: "l2", toStageId: "s1" }]]);
  });
});
