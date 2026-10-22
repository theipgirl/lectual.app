import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StructuredCall } from "@/lib/ai/claude";
import { DID_NOT_FINISH_ERROR } from "@/lib/agents/run-status";
import { fakeAdmin } from "../mailbox/fake-db";
import { NOW, ORG } from "./helpers";

/** B5 and B4 at the runner: every error run (cron or Run now) makes one alert attempt; ok and skipped make none. */

const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/agents/intake-triage", () => ({ runIntakeTriage: (ctx: unknown) => mocks.run(ctx), TRIAGE_MAX_TOKENS: 1 }));

/** The env module caches each variable on first read, so every call loads a fresh copy of the runner. */
async function runOneAgent(...a: Parameters<typeof import("@/lib/agents/runner").runOneAgent>) {
  vi.resetModules();
  return (await import("@/lib/agents/runner")).runOneAgent(...a);
}

beforeEach(() => {
  process.env.AGENT_FAILURE_ALERT_TO = "bugs@lectual.app";
  process.env.RESEND_API_KEY = "re_key";
  mocks.run.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete process.env.AGENT_FAILURE_ALERT_TO;
  delete process.env.RESEND_API_KEY;
});

function setup() {
  const { client, log } = fakeAdmin((q) => {
    if (q.table === "agent_run" && q.action === "insert") return { data: [{ id: "run-1" }], error: null };
    if (q.table === "crm_org") return { data: [{ name: "RPB Law", queue_org_key: null, modules: [] }], error: null };
    return undefined;
  });
  const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
  const deps = {
    admin: client as unknown as SupabaseClient,
    llm: vi.fn() as unknown as StructuredCall,
    createDraft: vi.fn(),
    now: () => NOW,
    fetchImpl: fetchImpl as unknown as typeof fetch,
  };
  return { deps, log, fetchImpl };
}
const args = (trigger: "cron" | "manual") => ({ orgId: ORG, agent: "intake-triage" as const, autonomy: "draft" as const, trigger });
const sent = (f: ReturnType<typeof vi.fn>) => f.mock.calls.filter((c) => String(c[0]).startsWith("https://api.resend.com"));

describe("runOneAgent and the failure alert", () => {
  it.each(["cron", "manual"] as const)("a %s run that errors makes exactly one alert attempt and still returns the error", async (trigger) => {
    mocks.run.mockRejectedValue(new Error("Queue API 500 invalid input value for enum"));
    const { deps, log, fetchImpl } = setup();
    const out = await runOneAgent(deps, args(trigger));
    expect(out).toMatchObject({ status: "error", runId: "run-1", error: "Queue API 500 invalid input value for enum" });
    expect(sent(fetchImpl)).toHaveLength(1);
    const body = JSON.parse(String((sent(fetchImpl)[0][1] as RequestInit).body));
    expect(body.subject).toBe("[Lectual bug] intake-triage failed for RPB Law");
    expect(log.filter((q) => q.table === "agent_run" && q.action === "update")).toHaveLength(1);
  });

  it("ok and skipped runs make no alert attempt", async () => {
    mocks.run.mockResolvedValue({ itemsIn: 0, draftsOut: 0, summary: "ok" });
    const a = setup();
    expect((await runOneAgent(a.deps, args("cron"))).status).toBe("ok");
    mocks.run.mockResolvedValue({ itemsIn: 0, draftsOut: 0, summary: "no", skipped: true });
    const b = setup();
    expect((await runOneAgent(b.deps, args("cron"))).status).toBe("skipped");
    expect(sent(a.fetchImpl)).toHaveLength(0);
    expect(sent(b.fetchImpl)).toHaveLength(0);
  });

  it("a time-limit close is an error run and triggers one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    mocks.run.mockImplementation(() => new Promise(() => {}));
    const { deps, fetchImpl } = setup();
    const pending = runOneAgent(deps, { ...args("cron"), budgetMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_001);
    const out = await pending;
    expect(out).toMatchObject({ status: "error", error: DID_NOT_FINISH_ERROR, reason: "time-limit" });
    expect(sent(fetchImpl)).toHaveLength(1);
  });

  it("unset recipients or key means no call and the same outcome", async () => {
    mocks.run.mockRejectedValue(new Error("boom"));
    for (const k of ["AGENT_FAILURE_ALERT_TO", "RESEND_API_KEY"]) {
      const saved = process.env[k];
      delete process.env[k];
      const { deps, fetchImpl } = setup();
      expect(await runOneAgent(deps, args("cron"))).toMatchObject({ status: "error", error: "boom", runId: "run-1" });
      expect(fetchImpl).not.toHaveBeenCalled();
      process.env[k] = saved;
    }
  });

  it("a failing send is swallowed: same outcome, same stored row, one log line", async () => {
    mocks.run.mockRejectedValue(new Error("boom"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, log } = setup();
    deps.fetchImpl = vi.fn(async () => Promise.reject(new Error("down"))) as unknown as typeof fetch;
    const out = await runOneAgent(deps, args("manual"));
    expect(out).toMatchObject({ status: "error", error: "boom", runId: "run-1" });
    expect(log.filter((q) => q.table === "agent_run" && q.action === "update")[0].values).toMatchObject({ status: "error", error: "boom" });
    expect(err).toHaveBeenCalledTimes(1);
  });
});
