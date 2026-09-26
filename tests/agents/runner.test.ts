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
    const failed = log.filter((q) => q.table === "agent_run" && q.action === "update")[0];
    expect(failed.values).toMatchObject({ status: "error", error: expect.stringContaining("boom") });
  });
});

describe("cost accounting", () => {
  it("prices input, output and cache tokens, and admits when it doesn't know a model", () => {
    expect(costFor("claude-opus-5", { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(5);
    expect(costFor("claude-opus-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 })).toBe(0.5);
    expect(costFor("some-future-model", { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
  });
});
