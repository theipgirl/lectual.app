import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { autopilotAllowsRuns, runAllAgents, runOneAgent } from "@/lib/agents/runner";
import { fakeAdmin, type Recorded } from "../mailbox/fake-db";
import { fakeLlm, NOW, ORG } from "./helpers";

type R = { data: unknown; error: { message: string; code?: string } | null } | undefined;

function deps(handler: (q: Recorded) => R) {
  const { client, log } = fakeAdmin(handler);
  const createDraft = vi.fn(async () => ({ id: "q" }));
  return { log, deps: { admin: client as unknown as SupabaseClient, llm: fakeLlm({}).llm, createDraft, now: () => NOW } };
}

const firm = (autopilot: R) => (q: Recorded): R => {
  if (q.table === "crm_org" && q.filters.some((f) => f.op === "contains")) return { data: [{ id: ORG }], error: null };
  if (q.table === "agent_autopilot") return autopilot;
  if (q.table === "agent_setting") return { data: [{ agent: "intake-triage", enabled: true, autonomy: "draft" }], error: null };
  if (q.table === "agent_run" && q.action === "insert") return { data: [{ id: "run-1" }], error: null };
  return undefined;
};

describe("Autopilot pause is honoured by the runner (cron path)", () => {
  it("a paused firm runs nothing and writes no run row, and its agent switches are not touched", async () => {
    const { deps: d, log } = deps(firm({ data: [{ paused: true }], error: null }));
    expect(await runAllAgents(d)).toEqual([]);
    expect(log.some((q) => q.table === "agent_run")).toBe(false);
    expect(log.some((q) => q.table === "agent_setting" && q.action !== "select")).toBe(false);
  });

  it("a firm that is not paused (or has no row) runs as before", async () => {
    for (const autopilot of [{ data: [{ paused: false }], error: null }, { data: [], error: null }]) {
      const { deps: d } = deps(firm(autopilot));
      const out = await runAllAgents(d);
      expect(out.map((o) => `${o.agent}:${o.status}`)).toEqual(["intake-triage:ok"]);
    }
  });

  it("fails closed: an unreadable pause state counts as paused", async () => {
    const { deps: d, log } = deps(firm({ data: null, error: { message: "boom", code: "08006" } }));
    expect(await runAllAgents(d)).toEqual([]);
    expect(log.some((q) => q.table === "agent_run")).toBe(false);
  });

  it("an environment without the 0078 table has no pause, so agents still run", async () => {
    const { deps: d } = deps(firm({ data: null, error: { message: "relation missing", code: "PGRST205" } }));
    expect((await runAllAgents(d)).length).toBe(1);
  });

  it("the check is fenced to the firm's own org_id", async () => {
    const { deps: d, log } = deps(firm({ data: [{ paused: false }], error: null }));
    await autopilotAllowsRuns(d.admin, ORG);
    const q = log.find((x) => x.table === "agent_autopilot")!;
    expect(q.filters).toContainEqual({ op: "eq", column: "org_id", value: ORG });
  });
});

describe("runOneAgent (the Run now path) honours the pause itself", () => {
  it("returns skipped/paused without starting a run", async () => {
    const { deps: d, log } = deps(firm({ data: [{ paused: true }], error: null }));
    const out = await runOneAgent(d, { orgId: ORG, agent: "intake-triage", autonomy: "draft", trigger: "manual", triggeredBy: "u1" });
    expect(out).toMatchObject({ status: "skipped", reason: "paused", runId: null });
    expect(log.some((q) => q.table === "agent_run" || q.table === "crm_lead")).toBe(false);
  });
});
