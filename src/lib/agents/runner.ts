import type { SupabaseClient } from "@supabase/supabase-js";
import type { StructuredCall } from "@/lib/ai/claude";
import type { NewQueueDraft, QueueItem } from "@/lib/queue/api";
import type { SyncDeps } from "@/lib/mailbox/sync";
import { runEmailIntel } from "./email-intel";
import { runIntakeTriage } from "./intake-triage";
import { runPostConsult } from "./post-consult";
import { runStageKeeper } from "./stage-keeper/run";
import { runMorningBrief } from "./morning-brief/run";
import { runConsultPrep } from "./consult-prep/run";
import { runInboxSummary } from "./inbox-summary/run";
import { AGENT_DEFS, AGENT_IDS, type AgentContext, type AgentId, type AgentResult, type AgentTrigger, type Autonomy } from "./types";
import { DID_NOT_FINISH_ERROR } from "./run-status";
import { AGENT_RUN_BUDGET_MS, CRON_AGENT_CAP_MS, CRON_TRACKS, CRON_WALL_BUDGET_MS, MIN_AGENT_START_MS } from "./budget";

/**
 * Runs the in-app agents.
 *
 * FAIL CLOSED, twice over: a firm must hold the `agents` module, AND each
 * agent must have an agent_setting row with enabled = true. No row means off.
 *
 * Runs as the service role (the cron has nobody signed in), so every agent is
 * handed the orgId and fences every statement with it; see the tests.
 *
 * Above both sits the firm-wide Autopilot pause (0082): a paused firm runs
 * nothing, and "paused" is also what an unreadable pause state means.
 *
 * Each run is one agent_run row: counts, a one-line summary, cost, and the
 * error if it failed. One agent failing never stops the next.
 *
 * TIME. Both entry points live in functions with `maxDuration = 300`: the cron
 * route and the Agents page (Run now runs inside its server action). A function
 * killed at its limit leaves its run row "running" forever and every agent after
 * it unrun, which is what happened to RPB on 2026-10-22 (morning-brief started
 * with the cron nearly spent; consult-prep and inbox-summary never ran). So:
 *   - every run has a budget. When it is spent the runner stops waiting, aborts
 *     the agent's in-flight model and HTTP calls, and closes the row as
 *     "Did not finish within the time limit". The agent's late result is ignored.
 *   - agents see the budget (`ctx.timeLeftMs`) and stop starting new items
 *     before it runs out, so most runs end on their own with a summary.
 *   - the cron has one wall-clock budget for everything (see runAllAgents).
 */

const NOT_STARTED_SUMMARY = "The scheduled run ran out of time before this agent's turn. It runs again at the next scheduled run.";

const RUNNERS: Record<AgentId, (ctx: AgentContext) => Promise<AgentResult>> = {
  "email-intel": runEmailIntel,
  "intake-triage": runIntakeTriage,
  "post-consult": runPostConsult,
  "stage-keeper": runStageKeeper,
  "morning-brief": runMorningBrief,
  "consult-prep": runConsultPrep,
  "inbox-summary": runInboxSummary,
};

export type AgentSetting = { enabled: boolean; autonomy: Autonomy };

export async function loadAgentSettings(admin: SupabaseClient, orgId: string): Promise<Map<AgentId, AgentSetting>> {
  const { data, error } = await admin.from("agent_setting").select("agent, enabled, autonomy").eq("org_id", orgId);
  if (error) throw new Error(`agent settings read failed: ${error.message}`);
  const out = new Map<AgentId, AgentSetting>();
  for (const row of data ?? []) {
    if ((AGENT_IDS as readonly string[]).includes(row.agent as string)) {
      out.set(row.agent as AgentId, { enabled: Boolean(row.enabled), autonomy: row.autonomy as Autonomy });
    }
  }
  return out;
}

export type RunnerDeps = {
  admin: SupabaseClient;
  llm: StructuredCall;
  createDraft: (input: NewQueueDraft) => Promise<{ id: string }>;
  /** Lists a firm's pending queue items by its queue key. Absent in tests that do not need it. */
  listPending?: (orgKey: string) => Promise<QueueItem[]>;
  mailbox?: SyncDeps;
  fetchImpl?: typeof fetch;
  /** The time stamped on rows and handed to agents as `ctx.now` (tests fix it). */
  now?: () => number;
  /** The real clock the time budgets are measured on. Default Date.now; separate from `now` so a fixed test clock never reads as "no time left". */
  clock?: () => number;
  /** The cron's wall budget, for tests. Default CRON_WALL_BUDGET_MS. */
  cronBudgetMs?: number;
  siteOrigin?: () => Promise<string | null>;
};

export type RunOutcome = {
  agent: AgentId;
  orgId: string;
  status: "ok" | "error" | "skipped";
  runId: string | null;
  result?: AgentResult;
  error?: string;
  /**
   * `paused`      never started: the firm's Autopilot is paused (or its state couldn't be read).
   * `time-limit`  started, and was still going when its budget ran out; the row is closed as an error.
   * `no-time`     the cron never started it: too little of the cron's budget was left (a skipped row says so).
   */
  reason?: "paused" | "time-limit" | "no-time";
};

/**
 * Whether the firm's Autopilot (lectual 0082) lets agents run. FAIL CLOSED: a
 * read that errors counts as paused, because a firm that pressed Pause must
 * never have an agent run on it because a read failed. The one exception is
 * the table not existing in this environment (0082 not applied yet): then no
 * firm can have paused, and stopping every firm's agents would be an outage
 * with no switch to undo it.
 */
export async function autopilotAllowsRuns(admin: SupabaseClient, orgId: string): Promise<boolean> {
  try {
    const { data, error } = await admin.from("agent_autopilot").select("paused").eq("org_id", orgId).maybeSingle();
    if (error) {
      const code = (error as { code?: string }).code;
      return code === "PGRST205" || code === "42P01";
    }
    return !(data as { paused?: boolean } | null)?.paused;
  } catch {
    return false;
  }
}

/** One agent, one firm, one agent_run row. */
/** Wraps a queue call so it is refused once the run's signal has aborted (the run is already closed as "Did not finish"). */
export function refuseAfterAbort<A extends unknown[], R>(signal: AbortSignal, fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return (...args: A) => (signal.aborted ? Promise.reject(new Error(DID_NOT_FINISH_ERROR)) : fn(...args));
}

export async function runOneAgent(
  deps: RunnerDeps,
  args: {
    orgId: string;
    agent: AgentId;
    autonomy: Autonomy;
    trigger: AgentTrigger;
    triggeredBy?: string | null;
    /** How long the agent may take. Default AGENT_RUN_BUDGET_MS. */
    budgetMs?: number;
  },
): Promise<RunOutcome> {
  const { admin } = deps;
  const now = deps.now ?? Date.now;
  const clock = deps.clock ?? Date.now;
  // The budget counts from here, so the pause check, the row insert and the org read are inside it too.
  const deadline = clock() + Math.max(0, args.budgetMs ?? AGENT_RUN_BUDGET_MS);
  const { orgId, agent } = args;

  // Checked here, not only by the callers, so every path into an agent (cron,
  // "Run now", anything added later) honours the pause. No run row is written.
  if (!(await autopilotAllowsRuns(admin, orgId))) {
    return { agent, orgId, status: "skipped", runId: null, reason: "paused" };
  }

  const { data: run } = await admin
    .from("agent_run")
    .insert({
      org_id: orgId,
      agent,
      trigger: args.trigger,
      status: "running",
      started_at: new Date(now()).toISOString(),
      triggered_by: args.triggeredBy ?? null,
    })
    .select("id")
    .single();
  const runId = (run?.id as string | undefined) ?? null;

  // One read of the firm's own row serves the queue key and the module list. A failed read, or no
  // row, leaves the module list `null` ("could not be read"), which the Mailboxes gate treats as off.
  const { data: org, error: orgError } = await admin.from("crm_org").select("queue_org_key, modules").eq("id", orgId).maybeSingle();
  const orgModules = !orgError && org && Array.isArray(org.modules) ? (org.modules as string[]) : null;
  const queueOrgKey = (org?.queue_org_key as string | null) ?? null;

  // The abort reaches every model call and every fetch the agent makes through the context, so a call in
  // flight when time runs out stops instead of running on.
  const controller = new AbortController();
  const withRunSignal = (signal: AbortSignal | null | undefined): AbortSignal =>
    signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  // Wrap the model call to total the run's cost.
  let cost = 0;
  let costKnown = true;
  const llm: StructuredCall = async (req) => {
    const res = await deps.llm({ ...req, signal: withRunSignal(req.signal) });
    if (res.costUsd == null) costKnown = false;
    else cost += res.costUsd;
    return res;
  };
  const baseFetch = deps.fetchImpl ?? fetch;
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) =>
    baseFetch(input, { ...init, signal: withRunSignal(init?.signal) })) as typeof fetch;

  const ctx: AgentContext = {
    admin,
    orgId,
    autonomy: args.autonomy,
    llm,
    queueOrgKey,
    // Once the run is past its budget the row is closed as "Did not finish"; nothing may be queued after that,
    // or a run recorded as unfinished would still leave a draft (and a retry would leave a second one).
    createDraft: refuseAfterAbort(controller.signal, deps.createDraft),
    listPending:
      deps.listPending && queueOrgKey
        ? refuseAfterAbort(controller.signal, () => (deps.listPending as NonNullable<RunnerDeps["listPending"]>)(queueOrgKey))
        : undefined,
    orgModules,
    now,
    siteOrigin: deps.siteOrigin,
    fetchImpl,
    mailbox: deps.mailbox,
    timeLeftMs: () => deadline - clock(),
    signal: controller.signal,
  };

  // The agent races its budget. `work` never rejects, so a result (or a failure) that arrives after the
  // timer won is simply dropped: the row has already been closed and is not touched again.
  const work = Promise.resolve()
    .then(() => RUNNERS[agent](ctx))
    .then(
      (result) => ({ result }) as const,
      (err: unknown) => ({ error: err instanceof Error ? err.message : String(err) }) as const,
    );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeUp = new Promise<"time-up">((resolve) => {
    timer = setTimeout(() => resolve("time-up"), Math.max(0, deadline - clock()));
  });
  const settled = await Promise.race([work, timeUp]);
  clearTimeout(timer);

  let outcome: RunOutcome;
  if (settled === "time-up") {
    controller.abort(new Error(DID_NOT_FINISH_ERROR));
    outcome = { agent, orgId, status: "error", runId, error: DID_NOT_FINISH_ERROR, reason: "time-limit" };
  } else if ("result" in settled) {
    outcome = { agent, orgId, status: settled.result.skipped ? "skipped" : "ok", runId, result: settled.result };
  } else {
    outcome = { agent, orgId, status: "error", runId, error: settled.error };
  }

  if (runId) {
    await admin
      .from("agent_run")
      .update({
        status: outcome.status,
        finished_at: new Date(now()).toISOString(),
        items_in: outcome.result?.itemsIn ?? 0,
        drafts_out: outcome.result?.draftsOut ?? 0,
        summary: outcome.result?.summary ?? null,
        error: outcome.error ? outcome.error.slice(0, 500) : null,
        cost_usd: costKnown ? Math.round(cost * 10_000) / 10_000 : null,
      })
      .eq("id", runId)
      .eq("org_id", orgId);
  }
  return outcome;
}

/**
 * A row for an agent the cron had no time left to start, so the Agents page and the digest say it
 * didn't run and why, instead of saying nothing. Counts only, like every row.
 */
async function recordNotStarted(deps: RunnerDeps, orgId: string, agent: AgentId): Promise<RunOutcome> {
  const at = new Date((deps.now ?? Date.now)()).toISOString();
  const { data } = await deps.admin
    .from("agent_run")
    .insert({ org_id: orgId, agent, trigger: "cron", status: "skipped", started_at: at, finished_at: at, summary: NOT_STARTED_SUMMARY })
    .select("id")
    .single();
  return { agent, orgId, status: "skipped", runId: (data?.id as string | undefined) ?? null, reason: "no-time" };
}

/**
 * The cron: every enabled agent in every firm that holds the `agents` module, inside one wall-clock
 * budget (CRON_WALL_BUDGET_MS). Each firm's agents run on CRON_TRACKS; each agent gets the smaller of
 * CRON_AGENT_CAP_MS and what is left of the budget, and one that would get less than MIN_AGENT_START_MS
 * is not started (its row says so). Firms are taken one after another and share the budget, so a firm
 * late in the list can find it spent: today RPB is the only firm with agents on; with many firms the
 * cron should fan out per firm (or run more often) instead. Outcomes come back in AGENT_IDS order per firm.
 */
export async function runAllAgents(deps: RunnerDeps): Promise<RunOutcome[]> {
  const clock = deps.clock ?? Date.now;
  const deadline = clock() + (deps.cronBudgetMs ?? CRON_WALL_BUDGET_MS);
  const { data: orgs, error } = await deps.admin.from("crm_org").select("id").contains("modules", ["agents"]);
  if (error) throw new Error(`org read failed: ${error.message}`);
  const outcomes: RunOutcome[] = [];
  for (const { id: orgId } of (orgs ?? []) as { id: string }[]) {
    // A paused firm runs nothing. Each agent's own switch is left exactly as it is.
    if (!(await autopilotAllowsRuns(deps.admin, orgId))) continue;
    let settings: Map<AgentId, AgentSetting>;
    try {
      settings = await loadAgentSettings(deps.admin, orgId);
    } catch {
      continue;
    }
    const byAgent = new Map<AgentId, RunOutcome>();
    const runTrack = async (track: readonly AgentId[]) => {
      for (const agent of track) {
        const s = settings.get(agent);
        if (!s?.enabled) continue;
        const left = deadline - clock();
        byAgent.set(
          agent,
          left < MIN_AGENT_START_MS
            ? await recordNotStarted(deps, orgId, agent)
            : await runOneAgent(deps, { orgId, agent, autonomy: s.autonomy, trigger: "cron", budgetMs: Math.min(CRON_AGENT_CAP_MS, left) }),
        );
      }
    };
    await Promise.all(CRON_TRACKS.map(runTrack));
    for (const agent of AGENT_IDS) {
      const o = byAgent.get(agent);
      if (o) outcomes.push(o);
    }
  }
  return outcomes;
}

export { AGENT_DEFS };
