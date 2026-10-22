import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAllAgents } from "@/lib/agents/runner";
import { costFor } from "@/lib/ai/claude";
import { fakeAdmin, type Recorded } from "../mailbox/fake-db";
import { fakeLlm, NOW, ORG } from "./helpers";

function deps(handler: (q: Recorded) => { data: unknown; error: null } | undefined) {
  const { client, log } = fakeAdmin(handler);
  const createDraft = vi.fn(async () => ({ id: "q" }));
  return { log, createDraft, deps: { admin: client as unknown as SupabaseClient, llm: fakeLlm({}).llm, createDraft, now: () => NOW } };
}

describe("agent runner", () => {
  it("runs nothing for a firm without the agents module", async () => {
    const { deps: d, log } = deps((q) => (q.table === "crm_org" ? { data: [], error: null } : undefined));
    expect(await runAllAgents(d)).toEqual([]);
    expect(log.some((q) => q.table === "agent_run")).toBe(false);
  });

  it("runs only agents switched on (no row = off), and logs each run", async () => {
    const { deps: d, log } = deps((q) => {
      if (q.table === "crm_org" && q.action === "select" && q.filters.some((f) => f.op === "contains")) return { data: [{ id: ORG }], error: null };
      if (q.table === "agent_setting") return { data: [{ agent: "intake-triage", enabled: true, autonomy: "draft" }, { agent: "post-consult", enabled: false, autonomy: "draft" }], error: null };
      if (q.table === "agent_run" && q.action === "insert") return { data: [{ id: "run-1" }], error: null };
      return undefined;
    });
    const outcomes = await runAllAgents(d);
    expect(outcomes.map((o) => o.agent)).toEqual(["intake-triage"]);
    const done = log.find((q) => q.table === "agent_run" && q.action === "update");
    expect(done!.values).toMatchObject({ status: "ok", summary: "No new leads to score." });
  });

  it("records a failure on the run and carries on with the next agent", async () => {
    const { deps: d, log } = deps((q) => {
      if (q.table === "crm_org" && q.filters.some((f) => f.op === "contains")) return { data: [{ id: ORG }], error: null };
      if (q.table === "agent_setting") return { data: [{ agent: "intake-triage", enabled: true, autonomy: "draft" }, { agent: "post-consult", enabled: true, autonomy: "draft" }], error: null };
      if (q.table === "crm_lead") return { data: null, error: { message: "boom" } } as never;
      if (q.table === "agent_run" && q.action === "insert") return { data: [{ id: "run" }], error: null };
      return undefined;
    });
    const outcomes = await runAllAgents(d);
    expect(outcomes.map((o) => `${o.agent}:${o.status}`)).toEqual(["intake-triage:error", "post-consult:skipped"]);
    // The two run on different cron tracks, at the same time, so the order of their closing updates is not fixed.
    const failed = log.filter((q) => q.table === "agent_run" && q.action === "update").find((q) => (q.values as { status?: string }).status === "error");
    expect(failed!.values).toMatchObject({ status: "error", error: expect.stringContaining("boom") });
  });
});

describe("cost accounting", () => {
  it("prices input, output and cache tokens, and admits when it doesn't know a model", () => {
    expect(costFor("claude-opus-5", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(5);
    expect(costFor("claude-opus-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 })).toBe(0.5);
    expect(costFor("some-future-model", { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
  });
});

describe("the Stage Keeper in the registry (Sprint 16, F16)", () => {
  it("is an agent id with a definition that says it moves leads and defaults to act", async () => {
    const { AGENT_DEFS, AGENT_IDS, autonomyHint, agentNeedsAi } = await import("@/lib/agents/types");
    expect(AGENT_IDS).toContain("stage-keeper");
    expect(AGENT_DEFS["stage-keeper"]).toMatchObject({ name: "Stage Keeper", defaultAutonomy: "act" });
    expect(AGENT_DEFS["stage-keeper"].description).toMatch(/moves the lead forward/);
    expect(AGENT_DEFS["stage-keeper"].description).toMatch(/never sends anything/);
    expect(agentNeedsAi("stage-keeper")).toBe(false);
    expect(agentNeedsAi("email-intel")).toBe(true);
    // The hint says what each level does to the board; the other agents keep the generic wording.
    expect(autonomyHint("stage-keeper", "act")).toMatch(/Moves the lead forward itself and logs it/);
    expect(autonomyHint("stage-keeper", "suggest")).toMatch(/suggestion card/);
    expect(autonomyHint("stage-keeper", "draft")).toMatch(/suggestion card/);
    expect(autonomyHint("email-intel", "act")).toBe((await import("@/lib/agents/types")).AUTONOMY_HINT.act);
  });

  it("loadAgentSettings returns its setting, and runAllAgents runs it only when switched on, with no AI key needed", async () => {
    const { loadAgentSettings } = await import("@/lib/agents/runner");
    const { client, log } = fakeAdmin((q) => {
      if (q.table === "agent_setting") return { data: [{ agent: "stage-keeper", enabled: true, autonomy: "act" }, { agent: "bogus", enabled: true, autonomy: "act" }], error: null };
      return undefined;
    });
    const settings = await loadAgentSettings(client as unknown as SupabaseClient, ORG);
    expect([...settings.keys()]).toEqual(["stage-keeper"]);
    expect(settings.get("stage-keeper")).toEqual({ enabled: true, autonomy: "act" });
    expect(log).toHaveLength(1);

    const { deps: d, log: runLog } = deps((q) => {
      if (q.table === "crm_org" && q.filters.some((f) => f.op === "contains")) return { data: [{ id: ORG }], error: null };
      if (q.table === "agent_setting") return { data: [{ agent: "stage-keeper", enabled: true, autonomy: "suggest" }], error: null };
      if (q.table === "agent_run" && q.action === "insert") return { data: [{ id: "run-sk" }], error: null };
      return undefined;
    });
    const outcomes = await runAllAgents(d);
    expect(outcomes.map((o) => `${o.agent}:${o.status}`)).toEqual(["stage-keeper:ok"]);
    expect(runLog.find((q) => q.table === "agent_run" && q.action === "update")!.values).toMatchObject({ status: "ok", summary: "No matched mail or booked consults to place." });
  });

  it("the Run now action does not need the AI key for it, still needs the setting on, and keeps the key rule for the others", async () => {
    vi.resetModules();
    const state = { ai: false, enabled: true, runs: 0 };
    vi.doMock("next/cache", () => ({ refresh: () => {} }));
    vi.doMock("@/lib/org/modules", () => ({ orgHasModule: async () => true }));
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: async () => ({ kind: "ok", org: { id: ORG }, user: { id: "u" }, role: "owner" }) }));
    vi.doMock("@/lib/ai/claude", () => ({ aiConfigured: () => state.ai }));
    vi.doMock("@/lib/agents/deps", () => ({ productionRunnerDeps: () => ({}) }));
    vi.doMock("@/lib/agents/runner", () => ({
      runOneAgent: async () => {
        state.runs += 1;
        return { status: "ok", result: { summary: "done" } };
      },
    }));
    vi.doMock("@/lib/agents/autopilot", () => ({ loadAutopilot: async () => ({ status: "ok", state: { paused: false } }) }));
    vi.doMock("@/lib/db/scoped-client", () => ({
      getScopedClient: async () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { enabled: state.enabled, autonomy: "act" }, error: null }) }) }) }) }),
    }));
    const { runAgentNowAction } = await import("@/app/dashboard/agents/actions");
    const fd = (agent: string) => {
      const f = new FormData();
      f.set("agent", agent);
      return f;
    };
    expect(await runAgentNowAction({}, fd("stage-keeper"))).toMatchObject({ ok: true });
    expect(state.runs).toBe(1);
    expect((await runAgentNowAction({}, fd("intake-triage"))).error).toMatch(/AI key/);
    expect(state.runs).toBe(1);
    state.enabled = false;
    expect((await runAgentNowAction({}, fd("stage-keeper"))).error).toBe("Switch the agent on first.");
    expect(state.runs).toBe(1);
    vi.resetModules();
  });

  it("saving its setting when the database refuses it (0098 not applied) says so, and other agents' messages are unchanged", async () => {
    vi.resetModules();
    let error: { code?: string; message: string } | null = { code: "23514", message: 'new row for relation "agent_setting" violates check constraint "agent_setting_agent"' };
    vi.doMock("next/cache", () => ({ refresh: () => {} }));
    vi.doMock("@/lib/org/modules", () => ({ orgHasModule: async () => true }));
    vi.doMock("@/lib/firm/session", () => ({ resolveFirmSession: async () => ({ kind: "ok", org: { id: ORG }, user: { id: "u" }, role: "owner" }) }));
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ from: () => ({ upsert: async () => ({ error }) }) }) }));
    const { saveAgentSettingAction } = await import("@/app/dashboard/agents/actions");
    const fd = (agent: string) => {
      const f = new FormData();
      f.set("agent", agent);
      f.set("autonomy", "act");
      f.set("enabled", "true");
      return f;
    };
    const refused = await saveAgentSettingAction({}, fd("stage-keeper"));
    expect(refused.error).toMatch(/isn't available until the database update/);
    expect(refused.error).not.toMatch(/violates|constraint|agent_setting/);
    error = { code: "42501", message: "permission denied for table agent_setting" };
    expect((await saveAgentSettingAction({}, fd("stage-keeper"))).error).toBe("Couldn't save: permission denied for table agent_setting");
    error = { code: "23514", message: "check constraint" };
    expect((await saveAgentSettingAction({}, fd("email-intel"))).error).toBe("Couldn't save: check constraint");
    error = null;
    expect(await saveAgentSettingAction({}, fd("stage-keeper"))).toEqual({ ok: true });
    vi.resetModules();
  });
});
