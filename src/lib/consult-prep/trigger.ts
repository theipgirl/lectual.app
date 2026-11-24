import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { leadRead } from "@/lib/leads/live";
import { parseStageMapping, type StageMapping } from "@/lib/agents/stage-keeper/mapping";
import { AGENT_RUN_BUDGET_MS, CRON_AGENT_CAP_MS } from "@/lib/agents/budget";
import { productionRunnerDeps } from "@/lib/agents/deps";
import { loadAgentSettings, runOneAgent, type RunnerDeps, type RunOutcome } from "@/lib/agents/runner";
import type { RunScope } from "@/lib/agents/types";
import type { StageOpt } from "@/lib/reconcile/types";
import { isConsultScheduledStage } from "./stage";

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
    admin.from("crm_stage").select("id, name, category, order_index").eq("org_id", orgId),
    admin.from("crm_firm_brain_entry").select("key, body, data").eq("org_id", orgId).eq("category", "stage_mapping"),
  ]);
  if (stages.error || notes.error) return null;
  return {
    stages: ((stages.data ?? []) as Array<{ id: string; name: string; category: string; order_index: number }>).map((s) => ({ id: s.id, name: s.name, category: String(s.category), orderIndex: s.order_index })),
    mapping: parseStageMapping((notes.data ?? []) as Array<{ key?: unknown; body?: unknown; data?: unknown }>),
  };
}

/**
 * A lead was just moved to `toStageId` (by a person or by the Stage Keeper). When that is the firm's consult stage, prep
 * THIS lead. The org is the lead row's own. A lead that has already moved on (the stage on the row is not `toStageId`
 * any more) starts nothing, and a merged lead is never read.
 */
export async function startPrepOnStageEntry(deps: RunnerDeps, move: { leadId: string; toStageId: string }): Promise<RunOutcome | null> {
  try {
    const { admin } = deps;
    const lead = await leadRead(({ live }) => live(admin.from("crm_lead").select("id, org_id, current_stage_id")).eq("id", move.leadId).maybeSingle());
    const row = lead.error ? null : (lead.data as { id: string; org_id: string; current_stage_id: string } | null);
    if (!row || row.current_stage_id !== move.toStageId) return null;
    const ctx = await readStagesAndMapping(admin, row.org_id);
    if (!ctx || !isConsultScheduledStage(move.toStageId, ctx.stages, ctx.mapping)) return null;
    return await runConsultPrepScoped(deps, { orgId: row.org_id, scope: { leadIds: [row.id], reason: "stage" } });
  } catch {
    return null;
  }
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
