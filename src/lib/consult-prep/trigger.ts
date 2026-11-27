import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leadRead } from "@/lib/leads/live";
import { parseStageMapping, type StageMapping } from "@/lib/agents/stage-keeper/mapping";
import { IN_CHUNK, chunk } from "@/lib/agents/shared";
import { AGENT_RUN_BUDGET_MS, CRON_AGENT_CAP_MS } from "@/lib/agents/budget";
import { productionRunnerDeps } from "@/lib/agents/deps";
import { loadAgentSettings, runOneAgent, type RunnerDeps, type RunOutcome } from "@/lib/agents/runner";
import type { RunScope } from "@/lib/agents/types";
import type { StageOpt } from "@/lib/reconcile/types";
import { isConsultScheduledStage } from "./stage";
import { withRoleFallback } from "@/lib/stages/roles";

/**
 * Starting a consult prep run from somewhere other than the 5 AM run: a lead entering the consult stage, a firm's
 * Lawmatics sync finishing, a person pressing Re-run. Every one goes through the agent runner, so EVERY gate holds:
 * the Assistants feature, the `consult-prep` setting switched on, Autopilot not paused, the `agent_run` row and the
 * time budget. The org always comes from a database row (the lead's own, or the firm the sync was working on).
 *
 * Nothing here throws. A start that is refused is simply not a run (`null`).
 */

type Admin = SupabaseClient;

/** True when the firm holds the Assistants feature and has switched consult prep on; its autonomy when so. A failed read is "not on". */
async function gate(admin: Admin, orgId: string): Promise<{ autonomy: "suggest" | "draft" | "act" } | null> {
  try {
    const { data, error } = await admin.from("crm_org").select("id").eq("id", orgId).contains("modules", ["agents"]).maybeSingle();
    if (error || !data) return null;
    const setting = (await loadAgentSettings(admin, orgId)).get("consult-prep");
    if (!setting?.enabled) return null;
    return { autonomy: setting.autonomy };
  } catch {
    return null;
  }
}

/** Runs consult prep for one firm, narrowed by `scope`. `null` = not started (the assistant is off for the firm, or anything threw). */
export async function runConsultPrepScoped(deps: RunnerDeps, args: { orgId: string; scope: RunScope; budgetMs?: number; triggeredBy?: string | null; trigger?: "event" | "manual" }): Promise<RunOutcome | null> {
  try {
    const on = await gate(deps.admin, args.orgId);
    if (!on) return null;
    return await runOneAgent(deps, {
      orgId: args.orgId,
      agent: "consult-prep",
      autonomy: on.autonomy,
      trigger: args.trigger ?? "event",
      triggeredBy: args.triggeredBy ?? null,
      budgetMs: args.budgetMs ?? AGENT_RUN_BUDGET_MS,
      scope: args.scope,
    });
  } catch {
    return null;
  }
}

async function readStagesAndMapping(admin: Admin, orgId: string): Promise<{ stages: StageOpt[]; mapping: StageMapping } | null> {
  const [stages, notes] = await Promise.all([
    withRoleFallback((r) => admin.from("crm_stage").select(r ? "id, name, category, order_index, role" : "id, name, category, order_index").eq("org_id", orgId)),
    admin.from("crm_firm_brain_entry").select("key, body, data").eq("org_id", orgId).eq("category", "stage_mapping"),
  ]);
  if (stages.error || notes.error) return null;
  return {
    stages: ((stages.data ?? []) as unknown as Array<{ id: string; name: string; category: string; order_index: number; role?: string | null }>).map((s) => ({
      id: s.id,
      name: s.name,
      category: String(s.category),
      orderIndex: s.order_index,
      ...(s.role !== undefined ? { role: s.role } : {}),
    })),
    mapping: parseStageMapping((notes.data ?? []) as Array<{ key?: unknown; body?: unknown; data?: unknown }>),
  };
}

/** The most leads one scoped run takes. A request that moves more leads into the stage leaves the rest to the next sweep (counted). */
export const STAGE_BATCH_MAX = 5;

export type EntriesResult = { outcomes: RunOutcome[]; /** leads left for the next sweep because the batch was full */ over: number };

/**
 * Leads were just moved (by a person or by the Stage Keeper), all in ONE request. For each firm, the ones now in the consult stage
 * (to be prepped) and the ones now in a lost or nurture stage (their scheduled reminders are cancelled) go to ONE scoped run of at
 * most STAGE_BATCH_MAX leads. The org is the lead row's own. A lead that has already moved on (the stage on the row is not the one
 * it was moved to) starts nothing, and a merged lead is never read. Anything beyond the batch is left to the next sweep and counted.
 */
export async function startPrepOnStageEntries(deps: RunnerDeps, moves: ReadonlyArray<{ leadId: string; toStageId: string }>): Promise<EntriesResult> {
  const result: EntriesResult = { outcomes: [], over: 0 };
  try {
    const { admin } = deps;
    const toStage = new Map(moves.map((m) => [m.leadId, m.toStageId]));
    const rows: Array<{ id: string; org_id: string; current_stage_id: string }> = [];
    for (const batch of chunk([...toStage.keys()], IN_CHUNK)) {
      const lead = await leadRead(({ live }) => live(admin.from("crm_lead").select("id, org_id, current_stage_id")).in("id", batch));
      if (lead.error) return result;
      rows.push(...((lead.data ?? []) as typeof rows));
    }
    const byOrg = new Map<string, typeof rows>();
    for (const r of rows) if (r.current_stage_id === toStage.get(r.id)) byOrg.set(r.org_id, [...(byOrg.get(r.org_id) ?? []), r]);
    for (const [orgId, leads] of byOrg) {
      const ctx = await readStagesAndMapping(admin, orgId);
      if (!ctx) continue;
      const category = new Map(ctx.stages.map((s) => [s.id, s.category]));
      const wanted = leads.filter((l) => isConsultScheduledStage(l.current_stage_id, ctx.stages, ctx.mapping) || ["lost", "nurture"].includes(category.get(l.current_stage_id) ?? ""));
      if (wanted.length === 0) continue;
      const take = wanted.slice(0, STAGE_BATCH_MAX);
      result.over += wanted.length - take.length;
      const outcome = await runConsultPrepScoped(deps, { orgId, scope: { leadIds: take.map((l) => l.id), reason: "stage", over: wanted.length - take.length } });
      if (outcome) result.outcomes.push(outcome);
    }
  } catch {
    // Never into the move.
  }
  return result;
}

/** One lead moved. The same path as a batch of one; kept for callers (and tests) that move a single lead. */
export async function startPrepOnStageEntry(deps: RunnerDeps, move: { leadId: string; toStageId: string }): Promise<RunOutcome | null> {
  const r = await startPrepOnStageEntries(deps, [move]);
  return r.outcomes[0] ?? null;
}

/** The Lawmatics sync's hook: prep the firm's candidates with the wall budget that is left (never more than one agent's cap). */
export async function consultPrepAfterSync(orgId: string, info: { timeLeftMs: number }): Promise<"ran" | "not-on"> {
  const deps = productionRunnerDeps();
  const outcome = await runConsultPrepScoped(deps, {
    orgId,
    scope: { reason: "sync" },
    budgetMs: Math.max(0, Math.min(info.timeLeftMs - 10_000, CRON_AGENT_CAP_MS)),
  });
  return outcome ? "ran" : "not-on";
}
