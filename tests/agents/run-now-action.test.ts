import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The Run now action is its own POST entry point. It asks the same decideRunNow the Agents page asks, so a
 * forged request gets the sentence the page prints beside the button, and the runner is never reached.
 */

const state = vi.hoisted(() => ({
  modules: ["agents", "mailbox"] as string[],
  signedIn: true,
  role: "owner" as string,
  ai: true,
  setting: { enabled: true, autonomy: "draft" } as { enabled: boolean; autonomy: string } | null,
  settingError: null as { message: string } | null,
  autopilot: { status: "ok", state: { paused: false } } as unknown,
  update: "applied" as "applied" | "pending" | "unknown",
  outcome: { status: "ok", result: { summary: "Scored 3 leads.", itemsIn: 5, draftsOut: 2 } } as Record<string, unknown>,
  runOneAgent: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/cache", () => ({ refresh: () => state.refresh() }));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: async (m: string) => state.modules.includes(m) }));
vi.mock("@/lib/firm/session", () => ({
  resolveFirmSession: async () =>
    state.signedIn ? { kind: "ok", org: { id: "org-1" }, user: { id: "user-1" }, role: state.role } : { kind: "signed-out", redirectTo: "/login" },
}));
vi.mock("@/lib/ai/claude", () => ({ aiConfigured: () => state.ai }));
vi.mock("@/lib/agents/deps", () => ({ productionRunnerDeps: () => ({}) }));
vi.mock("@/lib/agents/runner", () => ({
  runOneAgent: async (...args: unknown[]) => {
    state.runOneAgent(...args);
    return state.outcome;
  },
}));
vi.mock("@/lib/agents/autopilot", () => ({ loadAutopilot: async () => state.autopilot }));
vi.mock("@/lib/stage-keeper/readiness-read", () => ({ readCalendarProbe: async () => ({ readiness: "none", databaseUpdate: state.update }) }));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: state.setting, error: state.settingError }) }) }),
      upsert: async () => ({ error: null }),
    }),
  }),
}));

const { runAgentNowAction } = await import("@/app/dashboard/agents/actions");

const form = (e: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(e)) fd.set(k, v);
  return fd;
};
const run = (agent = "intake-triage") => runAgentNowAction({}, form({ agent }));

beforeEach(() => {
  state.modules = ["agents", "mailbox"];
  state.signedIn = true;
  state.role = "owner";
  state.ai = true;
  state.setting = { enabled: true, autonomy: "draft" };
  state.settingError = null;
  state.autopilot = { status: "ok", state: { paused: false } };
  state.update = "applied";
  state.outcome = { status: "ok", result: { summary: "Scored 3 leads.", itemsIn: 5, draftsOut: 2 } };
  state.runOneAgent.mockClear();
  state.refresh.mockClear();
});

describe("Run now action: every refusal returns the shared sentence and never reaches the runner", () => {
  it("a role below senior admin (a forged request)", async () => {
    for (const role of ["viewer", "attorney", "paralegal", "intake", "social_media"]) {
      state.role = role;
      expect(await run()).toEqual({ error: "Only an owner, admin or senior admin can run assistants." });
    }
    expect(state.runOneAgent).not.toHaveBeenCalled();
  });

  it("a firm without the agents module, and a signed-out caller", async () => {
    state.modules = [];
    expect(await run()).toEqual({ error: "Only an owner, admin or senior admin can run assistants." });
    state.modules = ["agents"];
    state.signedIn = false;
    expect(await run()).toEqual({ error: "Only an owner, admin or senior admin can run assistants." });
    expect(state.runOneAgent).not.toHaveBeenCalled();
  });

  it("an agent that is off, and an agent with no setting row", async () => {
    state.setting = { enabled: false, autonomy: "draft" };
    expect(await run()).toEqual({ error: "Switch the assistant on first." });
    state.setting = null;
    expect(await run()).toEqual({ error: "Switch the assistant on first." });
    expect(state.runOneAgent).not.toHaveBeenCalled();
  });

  it("a setting that couldn't be read is not 'off'", async () => {
    state.settingError = { message: "boom" };
    const res = await run();
    expect(res.error).toMatch(/couldn't read this assistant's setting/);
    expect(res.error).not.toMatch(/Switch the agent on/);
    expect(state.runOneAgent).not.toHaveBeenCalled();
  });

  it("a paused firm", async () => {
    state.autopilot = { status: "ok", state: { paused: true } };
    expect(await run()).toEqual({ error: "Assistants paused for your firm, so none of them run. Resume them first." });
    expect(state.runOneAgent).not.toHaveBeenCalled();
  });

  it("an Autopilot state that couldn't be read", async () => {
    state.autopilot = { status: "unavailable" };
    expect(await run()).toEqual({ error: "We couldn't check whether assistants are paused, so nothing will run." });
    expect(state.runOneAgent).not.toHaveBeenCalled();
  });

  it("a missing AI key, except for the Stage Keeper", async () => {
    state.ai = false;
    expect(await run()).toEqual({ error: "AI isn't switched on for your firm yet. Lectual will turn it on." });
    expect(state.runOneAgent).not.toHaveBeenCalled();
    await run("stage-keeper");
    expect(state.runOneAgent).toHaveBeenCalledTimes(1);
  });

  it("a pending database update, for the three agents that need it", async () => {
    state.update = "pending";
    for (const agent of ["morning-brief", "consult-prep", "inbox-summary"]) {
      expect(await run(agent), agent).toEqual({ error: "This isn't switched on for your firm yet. Lectual will turn it on." });
    }
    expect(state.runOneAgent).not.toHaveBeenCalled();
    await run("intake-triage");
    expect(state.runOneAgent).toHaveBeenCalledTimes(1);
  });

  it("an unknown agent", async () => {
    expect(await run("nope")).toEqual({ error: "Unknown assistant." });
    expect(state.runOneAgent).not.toHaveBeenCalled();
  });

  it("two causes at once: the page's precedence", async () => {
    state.setting = { enabled: false, autonomy: "draft" };
    state.autopilot = { status: "ok", state: { paused: true } };
    expect(await run()).toEqual({ error: "Switch the assistant on first." });
    state.role = "viewer";
    expect(await run()).toEqual({ error: "Only an owner, admin or senior admin can run assistants." });
  });

  it("refuses without refreshing the page", async () => {
    state.setting = null;
    await run();
    expect(state.refresh).not.toHaveBeenCalled();
  });
});

describe("Run now action: the outcomes", () => {
  it("a run that finished returns the summary and the counts, and refreshes the page", async () => {
    expect(await run()).toEqual({ ok: true, skipped: false, message: "Scored 3 leads.", itemsIn: 5, draftsOut: 2 });
    expect(state.runOneAgent).toHaveBeenCalledTimes(1);
    expect(state.runOneAgent.mock.calls[0][1]).toMatchObject({ orgId: "org-1", agent: "intake-triage", trigger: "manual", triggeredBy: "user-1", autonomy: "draft" });
    expect(state.refresh).toHaveBeenCalledTimes(1);
  });

  it("a skipped run says so, with the summary", async () => {
    state.outcome = { status: "skipped", result: { summary: "No approval queue is connected.", itemsIn: 0, draftsOut: 0, skipped: true } };
    expect(await run()).toMatchObject({ ok: true, skipped: true, message: "No approval queue is connected." });
    expect(state.refresh).toHaveBeenCalledTimes(1);
  });

  it("a failed run is 'The run failed: <error>'", async () => {
    state.outcome = { status: "error", error: "model overloaded" };
    expect(await run()).toEqual({ error: "The run failed. The AI service was busy or slow. Try Run now again later." });
    expect(state.refresh).toHaveBeenCalledTimes(1);
  });

  it("a run the runner itself refused for Autopilot is an error, not a success", async () => {
    state.outcome = { status: "skipped", reason: "paused" };
    const res = await run();
    expect(res.ok).toBeUndefined();
    expect(res.error).toMatch(/paused for your firm/);
  });
});
