import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StructuredCall } from "@/lib/ai/claude";
import { runAllAgents, runOneAgent } from "@/lib/agents/runner";
import { AGENT_RUN_BUDGET_MS, CRON_AGENT_CAP_MS, CRON_TRACKS, CRON_WALL_BUDGET_MS, MIN_AGENT_START_MS } from "@/lib/agents/budget";
import { AGENT_IDS } from "@/lib/agents/types";
import { DID_NOT_FINISH_ERROR, displayRunStatus, isStaleRun, runDurationLabel, STALE_RUN_MS } from "@/lib/agents/run-status";
import { buildRunDigest } from "@/lib/agents/digest";
import { runIntakeTriage, TRIAGE_MAX_TOKENS, triageSummary, type Triage } from "@/lib/agents/intake-triage";
import { runMorningBrief, FOLLOW_UP_RESERVE_MS } from "@/lib/agents/morning-brief/run";
import { decideRunNow } from "@/lib/agents/run-now";
import { fakeAdmin, type Recorded } from "../mailbox/fake-db";
import { agentCtx, fakeLlm, NOW, ORG } from "./helpers";
import { memDb, type Row } from "./mem-db";

/**
 * The fixes for RPB's 2026-10-22 cron: a run has a time budget and is closed as "Did not finish within the
 * time limit" when it overruns, the cron fits inside its function, a row left "running" reads as "Didn't
 * finish", intake triage skips one unusable answer instead of failing, and the morning brief stops drafting
 * follow-ups before its budget runs out.
 */

afterEach(() => {
  vi.useRealTimers();
});

const triage: Triage = { lane: "warm", readiness: 3, value: "MID", urgency: "7d", practice_fit: "strong", reason: "Interested.", red_flags: [] };

const leadRow = (id: string) => ({
  id,
  first_name: "Amara",
  last_name: id,
  business_name: null,
  email: `${id}@client.example`,
  phone: null,
  website: null,
  practice_area: "Trademark",
  mark_text: null,
  referral_source: null,
  referral_detail: null,
  qualification_score: null,
  temperature: null,
  created_at: "2026-09-24T09:00:00Z",
});

/** A runner wired to the recording fake db, with intake triage switched on and `leads` waiting to be scored. */
function triageDeps(llm: StructuredCall, leads: unknown[] = [leadRow("lead-1")], extra: (q: Recorded) => { data: unknown; error: null } | undefined = () => undefined) {
  const { client, log } = fakeAdmin((q) => {
    const e = extra(q);
    if (e) return e;
    if (q.table === "agent_run" && q.action === "insert") return { data: [{ id: `run-${(q.values as { agent: string }).agent}` }], error: null };
    if (q.table === "crm_lead" && q.action === "select") return { data: leads, error: null };
    return undefined;
  });
  const createDraft = vi.fn(async () => ({ id: "q" }));
  return { log, deps: { admin: client as unknown as SupabaseClient, llm, createDraft, now: () => NOW } };
}

const runUpdates = (log: Recorded[]) => log.filter((q) => q.table === "agent_run" && q.action === "update");

describe("runOneAgent: the per-run time budget", () => {
  it("an agent past its budget is closed as an error 'Did not finish within the time limit', and its in-flight model call is aborted", async () => {
    let seen: AbortSignal | undefined;
    const hanging = (async (req) => {
      seen = req.signal;
      return new Promise(() => {});
    }) as StructuredCall;
    const { deps, log } = triageDeps(hanging);
    // A real-sized budget on a fake timer: intake triage starts its lead (it has far more than its reserve left) and hangs.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const pending = runOneAgent(deps, { orgId: ORG, agent: "intake-triage", autonomy: "draft", trigger: "manual", budgetMs: AGENT_RUN_BUDGET_MS });
    await vi.advanceTimersByTimeAsync(AGENT_RUN_BUDGET_MS + 1);
    const outcome = await pending;

    expect(outcome).toMatchObject({ status: "error", error: DID_NOT_FINISH_ERROR, reason: "time-limit", runId: "run-intake-triage" });
    expect(DID_NOT_FINISH_ERROR).toBe("Did not finish within the time limit");
    const updates = runUpdates(log);
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toMatchObject({ status: "error", error: DID_NOT_FINISH_ERROR, finished_at: expect.any(String) });
    expect(seen?.aborted).toBe(true);
  });

  it("a result that arrives after the budget is ignored: the row is closed once, as the time-limit error", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const late = (async () => {
      await new Promise((r) => setTimeout(r, 100_000));
      return { output: triage, model: "claude-opus-5", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUsd: 0.01 };
    }) as StructuredCall;
    const { deps, log } = triageDeps(late);
    const pending = runOneAgent(deps, { orgId: ORG, agent: "intake-triage", autonomy: "draft", trigger: "cron", budgetMs: 60_000 });
    await vi.advanceTimersByTimeAsync(60_001);
    const outcome = await pending;
    // The model answers 40 seconds later; nothing about the run changes.
    await vi.advanceTimersByTimeAsync(50_000);
    expect(outcome.status).toBe("error");
    expect(runUpdates(log)).toHaveLength(1);
    expect(runUpdates(log)[0].values).toMatchObject({ status: "error", error: DID_NOT_FINISH_ERROR });
  });

  it("an agent inside its budget is unchanged, and sees how much time it has left", async () => {
    const { llm } = fakeLlm(triage);
    const { deps, log } = triageDeps(llm);
    const outcome = await runOneAgent(deps, { orgId: ORG, agent: "intake-triage", autonomy: "draft", trigger: "manual" });
    expect(outcome).toMatchObject({ status: "ok", result: { summary: "1 lead(s) scored, 0 hot." } });
    expect(runUpdates(log)[0].values).toMatchObject({ status: "ok", error: null });
    expect(AGENT_RUN_BUDGET_MS).toBeLessThan(300_000);
  });

  it("every model call carries the run's abort signal, still live while the run is inside its budget", async () => {
    const signals: Array<AbortSignal | undefined> = [];
    const { llm } = fakeLlm(triage);
    const spy = (async (req) => {
      signals.push(req.signal);
      return llm(req);
    }) as StructuredCall;
    const { deps } = triageDeps(spy, [leadRow("a"), leadRow("b")]);
    const outcome = await runOneAgent(deps, { orgId: ORG, agent: "intake-triage", autonomy: "draft", trigger: "manual" });
    expect(outcome.status).toBe("ok");
    expect(signals).toHaveLength(2);
    for (const s of signals) {
      expect(s).toBeInstanceOf(AbortSignal);
      expect(s!.aborted).toBe(false);
    }
  });
});

describe("runAllAgents: the cron fits inside its function", () => {
  it("the two tracks hold every agent exactly once, and the budgets fit inside maxDuration = 300", () => {
    const all = CRON_TRACKS.flat();
    expect([...all].sort()).toEqual([...AGENT_IDS].sort());
    expect(new Set(all).size).toBe(all.length);
    expect(CRON_WALL_BUDGET_MS).toBeLessThan(300_000);
    expect(CRON_AGENT_CAP_MS).toBeLessThanOrEqual(CRON_WALL_BUDGET_MS);
    // The brief runs after the agents whose output it reads (suggestion cards, post-consult drafts).
    const a = CRON_TRACKS[0];
    expect(a.indexOf("stage-keeper")).toBeLessThan(a.indexOf("morning-brief"));
    expect(a.indexOf("post-consult")).toBeLessThan(a.indexOf("morning-brief"));
  });

  it("one agent that hangs is cut off at its cap; the other track's agent still runs and finishes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const hanging = (async () => new Promise(() => {})) as StructuredCall;
    const { client, log } = fakeAdmin((q) => {
      if (q.table === "crm_org" && q.filters.some((f) => f.op === "contains")) return { data: [{ id: ORG }], error: null };
      if (q.table === "agent_setting") {
        return { data: [{ agent: "intake-triage", enabled: true, autonomy: "draft" }, { agent: "stage-keeper", enabled: true, autonomy: "act" }], error: null };
      }
      if (q.table === "agent_run" && q.action === "insert") return { data: [{ id: `run-${(q.values as { agent: string }).agent}` }], error: null };
      if (q.table === "crm_lead" && q.action === "select" && q.filters.some((f) => f.column === "ai_enriched_at")) return { data: [leadRow("lead-1")], error: null };
      return undefined;
    });
    const deps = { admin: client as unknown as SupabaseClient, llm: hanging, createDraft: vi.fn(async () => ({ id: "q" })), now: () => NOW, clock: () => 0 };
    const pending = runAllAgents(deps);
    await vi.advanceTimersByTimeAsync(CRON_AGENT_CAP_MS + 10);
    const outcomes = await pending;
    const byAgent = Object.fromEntries(outcomes.map((o) => [o.agent, o]));
    expect(byAgent["intake-triage"]).toMatchObject({ status: "error", reason: "time-limit" });
    expect(byAgent["stage-keeper"].status).not.toBe("error");
    // In AGENT_IDS order, whatever order the tracks finished in.
    expect(outcomes.map((o) => o.agent)).toEqual(["intake-triage", "stage-keeper"]);
    expect(runUpdates(log).find((q) => (q.values as { status: string }).status === "error")!.values).toMatchObject({ error: DID_NOT_FINISH_ERROR });
  });

  it("an agent whose turn comes with too little of the cron's budget left is not started, and its row says why", async () => {
    let t = 0;
    const { llm } = fakeLlm(triage);
    const { client, log } = fakeAdmin((q) => {
      if (q.table === "crm_org" && q.filters.some((f) => f.op === "contains")) return { data: [{ id: ORG }], error: null };
      if (q.table === "agent_setting") {
        return { data: [{ agent: "email-intel", enabled: true, autonomy: "draft" }, { agent: "intake-triage", enabled: true, autonomy: "draft" }], error: null };
      }
      if (q.table === "agent_run" && q.action === "insert") {
        // email-intel's run "takes" most of the budget.
        if ((q.values as { agent: string }).agent === "email-intel") t += CRON_WALL_BUDGET_MS - MIN_AGENT_START_MS + 1;
        return { data: [{ id: `run-${(q.values as { agent: string }).agent}` }], error: null };
      }
      return undefined;
    });
    const outcomes = await runAllAgents({ admin: client as unknown as SupabaseClient, llm, createDraft: vi.fn(async () => ({ id: "q" })), now: () => NOW, clock: () => t });
    const triageOutcome = outcomes.find((o) => o.agent === "intake-triage");
    expect(triageOutcome).toMatchObject({ status: "skipped", reason: "no-time" });
    const notStarted = log.find((q) => q.table === "agent_run" && q.action === "insert" && (q.values as { agent: string }).agent === "intake-triage");
    expect(notStarted!.values).toMatchObject({ org_id: ORG, status: "skipped", trigger: "cron", summary: expect.stringContaining("ran out of time") });
    // No model call was made for it.
    expect(log.some((q) => q.table === "crm_lead" && q.filters.some((f) => f.column === "ai_enriched_at"))).toBe(false);
  });
});

describe("a run row left 'running' reads as Didn't finish after 15 minutes", () => {
  const started = new Date(NOW - STALE_RUN_MS - 60_000).toISOString();
  const fresh = new Date(NOW - 60_000).toISOString();

  it("displayRunStatus and the duration label", () => {
    expect(STALE_RUN_MS).toBe(15 * 60_000);
    expect(displayRunStatus({ status: "running", started_at: started, finished_at: null }, NOW)).toBe("unfinished");
    expect(displayRunStatus({ status: "running", started_at: fresh, finished_at: null }, NOW)).toBe("running");
    expect(displayRunStatus({ status: "ok", started_at: started, finished_at: fresh }, NOW)).toBe("ok");
    expect(isStaleRun({ status: "error", started_at: started }, NOW)).toBe(false);
    expect(runDurationLabel({ status: "running", started_at: started, finished_at: null }, NOW)).toBe("Didn't finish");
    expect(runDurationLabel({ status: "running", started_at: fresh, finished_at: null }, NOW)).toBe("running");
  });

  it("the digest reports it as a run that didn't finish, never as still running or as nothing", () => {
    const digest = buildRunDigest(
      [{ agent: "morning-brief", status: "running", started_at: started, finished_at: null, items_in: 0, drafts_out: 0, summary: null, error: null }],
      new Date(NOW),
    );
    expect(digest.status).toBe("ok");
    if (digest.status !== "ok") return;
    expect(digest.failures).toHaveLength(1);
    expect(digest.failures[0]).toMatchObject({ agent: "morning-brief", text: "Morning brief didn't finish its last run", reason: DID_NOT_FINISH_ERROR });
    expect(digest.failures[0].action.label).toBe("Try Run now later");
  });

  it("a row that is genuinely running (under 15 minutes) is not a failure", () => {
    const digest = buildRunDigest(
      [{ agent: "morning-brief", status: "running", started_at: fresh, finished_at: null, items_in: 0, drafts_out: 0, summary: null, error: null }],
      new Date(NOW),
    );
    expect(digest.status === "ok" && digest.failures).toEqual([]);
  });

  it("Run now is never blocked by a run row: only this card's own request in flight blocks it", () => {
    const base = { agent: "morning-brief" as const, role: "owner" as const, enabled: true, autopilot: "clear" as const, aiConfigured: true, databaseUpdate: "applied" as const };
    expect(decideRunNow(base)).toEqual({ canRun: true });
    expect(decideRunNow({ ...base, running: true })).toMatchObject({ canRun: false, block: "running" });
  });
});

describe("intake triage: one unusable answer skips that lead, never the run (2026-10-22)", () => {
  it("asks for 16000 tokens, matching callClaude's default", async () => {
    const { llm } = fakeLlm(triage);
    const seen: Array<number | undefined> = [];
    const spy = (async (req) => {
      seen.push(req.maxTokens);
      return llm(req);
    }) as StructuredCall;
    const { ctx } = agentCtx((q) => (q.table === "crm_lead" && q.action === "select" ? { data: [leadRow("a")], error: null } : undefined), { autonomy: "draft", llm: spy });
    await runIntakeTriage(ctx);
    expect(TRIAGE_MAX_TOKENS).toBe(16_000);
    expect(seen).toEqual([16_000]);
  });

  for (const [label, err] of [
    ["cut off at max_tokens (AiOutputError)", Object.assign(new Error("The answer was cut off before it finished. Nothing was written."), { name: "AiOutputError" })],
    ["the SDK's own parse failure", new Error("Failed to parse structured output: SyntaxError: Unterminated string in JSON at position 8155")],
  ] as const) {
    it(`${label}: that lead is left unscored and counted, the next lead is scored`, async () => {
      let n = 0;
      const { llm: good } = fakeLlm(triage);
      const flaky = (async (req) => {
        n += 1;
        if (n === 1) throw err;
        return good(req);
      }) as StructuredCall;
      const { ctx, log } = agentCtx(
        (q) => (q.table === "crm_lead" && q.action === "select" ? { data: [leadRow("bad"), leadRow("good")], error: null } : undefined),
        { autonomy: "draft", llm: flaky },
      );
      const result = await runIntakeTriage(ctx);
      expect(result.summary).toBe("1 lead(s) scored, 0 hot. 1 lead couldn't be scored, will retry.");
      expect(result.itemsIn).toBe(1);
      const updated = log.filter((q) => q.table === "crm_lead" && q.action === "update").map((q) => q.filters.find((f) => f.column === "id")?.value);
      // The bad lead keeps ai_enriched_at null, so the next run tries it again.
      expect(updated).toEqual(["good"]);
    });
  }

  it("a failure that isn't the model's answer (no key, the network) still fails the run", async () => {
    const broken = (async () => {
      throw new Error("ANTHROPIC_API_KEY is not set, so the agents cannot run.");
    }) as StructuredCall;
    const { ctx } = agentCtx((q) => (q.table === "crm_lead" && q.action === "select" ? { data: [leadRow("a")], error: null } : undefined), { autonomy: "draft", llm: broken });
    await expect(runIntakeTriage(ctx)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("with the run's budget nearly spent it scores nothing more and says the rest wait for the next run", async () => {
    const { llm, calls } = fakeLlm(triage);
    const { ctx } = agentCtx((q) => (q.table === "crm_lead" && q.action === "select" ? { data: [leadRow("a"), leadRow("b")], error: null } : undefined), { autonomy: "draft", llm });
    const result = await runIntakeTriage({ ...ctx, timeLeftMs: () => 1_000 });
    expect(calls).toHaveLength(0);
    expect(result.summary).toBe("0 lead(s) scored, 0 hot. 2 leads were left for the next run (time limit).");
    expect(triageSummary({ found: 0, scored: 0, hot: 0, unscored: 0, deferred: 0 })).toBe("No new leads to score.");
  });
});

describe("morning brief: follow-ups stop before the budget runs out", () => {
  const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
  const stalled = (id: string, days: number): Row => ({
    id,
    org_id: ORG,
    first_name: "Dana",
    last_name: id,
    business_name: null,
    email: `${id}@client.example`,
    practice_area: "Trademark",
    mark_text: null,
    current_stage_id: "s-open",
    stage_entered_at: ago(days),
    last_activity_at: ago(days),
    last_inbound_at: null,
    last_outbound_at: null,
    created_at: ago(30),
  });
  const followUp = { subject: "Checking in", body: "Hello, just checking in.\n\nBest,\n[Attorney name]", internal_summary: "No contact for a while." };

  function setup(timeLeft: () => number) {
    const db = memDb({
      crm_stage: [{ id: "s-open", org_id: ORG, name: "Discovery", category: "open", aging_threshold_days: 14 }],
      crm_lead: [stalled("s1", 12), stalled("s2", 11), stalled("s3", 10)],
      crm_activity: [],
      crm_calendar_event: [],
      crm_matter_deadline: [],
      crm_matter: [],
    });
    const { llm, calls } = fakeLlm(followUp);
    const { ctx, createDraft } = agentCtx(db.handler, { autonomy: "draft", queue: true, llm, listPending: async () => [] });
    return { ctx: { ...ctx, timeLeftMs: timeLeft }, createDraft, calls };
  }
  const briefBody = (createDraft: { mock: { calls: unknown[][] } }) =>
    ((createDraft.mock.calls.map((c) => c[0]) as Array<{ type: string; draftBody: string }>).find((d) => d.type === "BRIEFING") as { draftBody: string }).draftBody;

  it("drafts until the budget is near, then writes the brief anyway and says how many were left", async () => {
    // Plenty of time for the first follow-up, then the budget reads as nearly spent.
    let left = FOLLOW_UP_RESERVE_MS + 120_000;
    const { ctx, createDraft, calls } = setup(() => left);
    const llm = ctx.llm;
    ctx.llm = (async (req) => {
      const res = await llm(req);
      left = FOLLOW_UP_RESERVE_MS - 1;
      return res;
    }) as StructuredCall;
    const result = await runMorningBrief(ctx);
    expect(calls).toHaveLength(1);
    expect(result.draftsOut).toBe(2); // the brief and one follow-up
    expect(result.summary).toContain("2 follow-ups were left for the next run (time limit).");
    expect(briefBody(createDraft)).toContain("2 more were not drafted because this run reached its time limit");
  });

  it("with no budget given (a direct call) it drafts as before", async () => {
    const { ctx, calls } = setup(() => Number.POSITIVE_INFINITY);
    const result = await runMorningBrief(ctx);
    expect(calls).toHaveLength(3);
    expect(result.summary).not.toContain("time limit");
  });
});
