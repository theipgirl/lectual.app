import type { SupabaseClient } from "@supabase/supabase-js";
import type { StructuredCall } from "@/lib/ai/claude";
import type { NewQueueDraft } from "@/lib/queue/api";
import type { SyncDeps } from "@/lib/mailbox/sync";
import { runEmailIntel } from "./email-intel";
import { runIntakeTriage } from "./intake-triage";
import { runPostConsult } from "./post-consult";
import { AGENT_DEFS, AGENT_IDS, type AgentContext, type AgentId, type AgentResult, type AgentTrigger, type Autonomy } from "./types";

/**
 * Runs the in-app agents.
 *
 * FAIL CLOSED, twice over: a firm must hold the `agents` module, AND each
 * agent must have an agent_setting row with enabled = true. No row means off.
 *
 * Runs as the service role (the cron has nobody signed in), so every agent is
 * handed the orgId and fences every statement with it; see the tests.
 *
 * Each run is one agent_run row: counts, a one-line summary, cost, and the
 * error if it failed. One agent failing never stops the next.
 */

const RUNNERS: Record<AgentId, (ctx: AgentContext) => Promise<AgentResult>> = {
  "email-intel": runEmailIntel,
  "intake-triage": runIntakeTriage,
  "post-consult": runPostConsult,
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
  mailbox?: SyncDeps;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type RunOutcome = { agent: AgentId; orgId: string; status: "ok" | "error" | "skipped"; runId: string | null; result?: AgentResult; error?: string };

/** One agent, one firm, one agent_run row. */
export async function runOneAgent(
  deps: RunnerDeps,
  args: { orgId: string; agent: AgentId; autonomy: Autonomy; trigger: AgentTrigger; triggeredBy?: string | null },
): Promise<RunOutcome> {
  const { admin } = deps;
  const now = deps.now ?? Date.now;
  const { orgId, agent } = args;

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

  const { data: org } = await admin.from("crm_org").select("queue_org_key").eq("id", orgId).maybeSingle();

  // Wrap the model call to total the run's cost.
  let cost = 0;
  let costKnown = true;
  const llm: StructuredCall = async (req) => {
    const res = await deps.llm(req);
    if (res.costUsd == null) costKnown = false;
    else cost += res.costUsd;
    return res;
  };

  const ctx: AgentContext = {
    admin,
    orgId,
    autonomy: args.autonomy,
    llm,
    queueOrgKey: (org?.queue_org_key as string | null) ?? null,
    createDraft: deps.createDraft,
    now,
    fetchImpl: deps.fetchImpl,
    mailbox: deps.mailbox,
  };

  let outcome: RunOutcome;
  try {
    const result = await RUNNERS[agent](ctx);
    outcome = { agent, orgId, status: result.skipped ? "skipped" : "ok", runId, result };
  } catch (err) {
    outcome = { agent, orgId, status: "error", runId, error: err instanceof Error ? err.message : String(err) };
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

/** The cron: every enabled agent in every firm that holds the `agents` module. */
export async function runAllAgents(deps: RunnerDeps): Promise<RunOutcome[]> {
  const { data: orgs, error } = await deps.admin.from("crm_org").select("id").contains("modules", ["agents"]);
  if (error) throw new Error(`org read failed: ${error.message}`);
  const outcomes: RunOutcome[] = [];
  for (const { id: orgId } of (orgs ?? []) as { id: string }[]) {
    let settings: Map<AgentId, AgentSetting>;
    try {
      settings = await loadAgentSettings(deps.admin, orgId);
    } catch {
      continue;
    }
    for (const agent of AGENT_IDS) {
      const s = settings.get(agent);
      if (!s?.enabled) continue;
      outcomes.push(await runOneAgent(deps, { orgId, agent, autonomy: s.autonomy, trigger: "cron" }));
    }
  }
  return outcomes;
}

export { AGENT_DEFS };
