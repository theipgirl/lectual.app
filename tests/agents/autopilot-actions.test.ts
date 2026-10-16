import { describe, it, expect, vi, beforeEach } from "vitest";

/** Run now and Pause/Resume: module gate, role split, and a clear "paused" answer. */

const state = vi.hoisted(() => ({
  modules: ["agents"] as string[],
  role: "owner" as string,
  autopilot: { status: "ok", state: { paused: false } } as unknown,
  runs: 0,
  upserts: [] as unknown[],
}));

vi.mock("next/cache", () => ({ refresh: () => {} }));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: async (m: string) => state.modules.includes(m) }));
vi.mock("@/lib/firm/session", () => ({
  resolveFirmSession: async () => ({ kind: "ok", org: { id: "org-1" }, user: { id: "user-1" }, role: state.role }),
}));
vi.mock("@/lib/ai/claude", () => ({ aiConfigured: () => true }));
vi.mock("@/lib/agents/deps", () => ({ productionRunnerDeps: () => ({}) }));
vi.mock("@/lib/agents/runner", () => ({
  runOneAgent: async () => {
    state.runs += 1;
    return { status: "ok", result: { summary: "done" } };
  },
}));
vi.mock("@/lib/agents/autopilot", () => ({ loadAutopilot: async () => state.autopilot }));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { enabled: true, autonomy: "draft" }, error: null }) }) }),
      upsert: async (v: unknown) => {
        state.upserts.push(v);
        return { error: null };
      },
    }),
  }),
}));

const { runAgentNowAction, setAutopilotAction } = await import("@/app/dashboard/agents/actions");

const form = (e: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(e)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  state.modules = ["agents"];
  state.role = "owner";
  state.autopilot = { status: "ok", state: { paused: false } };
  state.runs = 0;
  state.upserts = [];
});

describe("Run now", () => {
  it("explains the firm is paused and runs nothing", async () => {
    state.autopilot = { status: "ok", state: { paused: true } };
    const res = await runAgentNowAction({}, form({ agent: "intake-triage" }));
    expect(res.error).toMatch(/Autopilot is paused/);
    expect(state.runs).toBe(0);
  });

  it("refuses when the pause state can't be read", async () => {
    state.autopilot = { status: "unavailable" };
    const res = await runAgentNowAction({}, form({ agent: "intake-triage" }));
    expect(res.error).toMatch(/couldn't check/);
    expect(state.runs).toBe(0);
  });

  it("runs when Autopilot is on", async () => {
    const res = await runAgentNowAction({}, form({ agent: "intake-triage" }));
    expect(res).toMatchObject({ ok: true });
    expect(state.runs).toBe(1);
  });
});

describe("Pause / Resume", () => {
  it("does not exist without the agents module", async () => {
    state.modules = [];
    const res = await setAutopilotAction({}, form({ paused: "true" }));
    expect(res.error).toBeTruthy();
    expect(state.upserts).toHaveLength(0);
  });

  it("an attorney may pause, under the session's org", async () => {
    state.role = "attorney";
    const res = await setAutopilotAction({}, form({ paused: "true", reason: "reviewing drafts", org_id: "other-org" }));
    expect(res.ok).toBe(true);
    expect(state.upserts).toEqual([{ org_id: "org-1", paused: true, reason: "reviewing drafts" }]);
  });

  it("an attorney may not resume; an admin may", async () => {
    state.role = "attorney";
    expect((await setAutopilotAction({}, form({ paused: "false" }))).error).toMatch(/resume/);
    state.role = "admin";
    expect((await setAutopilotAction({}, form({ paused: "false" }))).ok).toBe(true);
  });

  it.each(["paralegal", "intake", "viewer"])("%s may not pause", async (role) => {
    state.role = role;
    expect((await setAutopilotAction({}, form({ paused: "true" }))).error).toMatch(/pause/);
    expect(state.upserts).toHaveLength(0);
  });
});
