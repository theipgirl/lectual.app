import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";
// @/lib/matters does NOT import automation or pipeline, so this is cycle-free
// (pipeline → automation → matters; matters is a leaf).
import { ensureMatterForLead } from "@/lib/matters";

type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;
type AutomationTrigger = Database["public"]["Enums"]["crm_automation_trigger"];
type RuleRow = Database["public"]["Tables"]["crm_automation_rule"]["Row"];

// ── Condition language ───────────────────────────────────────────────────────

export type ConditionOp = "eq" | "neq" | "contains" | "exists";

export type Condition = {
  field: string;
  op: ConditionOp;
  value?: unknown;
};

// ── Action language ──────────────────────────────────────────────────────────
// NOTE: these actions operate directly via getScopedClient (apply_tag inserts
// crm_lead_tag itself, change_stage updates crm_lead itself, ...) rather than
// calling into @/lib/pipeline's moveLeadStage/applyTag — see the no-import-
// cycle note in the module doc below.

export type ApplyTagAction = {
  type: "apply_tag";
  tagId: string;
  source?: Database["public"]["Enums"]["crm_tag_source"];
};
export type ChangeStageAction = { type: "change_stage"; stageId: string };
export type AssignTaskAction = {
  type: "assign_task";
  title: string;
  taskType?: Database["public"]["Enums"]["crm_task_type"];
  assigneeId?: string | null;
  dueAt?: string | null;
};
export type EnrollDripAction = { type: "enroll_drip"; sequenceId: string };
export type LogAction = { type: "log"; note?: string };

export type AutomationAction =
  | ApplyTagAction
  | ChangeStageAction
  | AssignTaskAction
  | EnrollDripAction
  | LogAction;

export type RunRulesContext = {
  leadId?: string;
  stageId?: string;
  [key: string]: unknown;
};

type ActionResult = { type: string; ok: boolean; error?: string };

/**
 * Reads a (possibly dot-nested) field out of a plain context object.
 * Missing/non-object intermediate values resolve to `undefined` rather than
 * throwing, so a typo'd condition field just fails to match instead of
 * blowing up the whole rule evaluation.
 */
function getField(ctx: Record<string, unknown>, field: string): unknown {
  return field.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, ctx);
}

function evaluateCondition(ctx: RunRulesContext, condition: Condition): boolean {
  const actual = getField(ctx, condition.field);
  switch (condition.op) {
    case "eq":
      return actual === condition.value;
    case "neq":
      return actual !== condition.value;
    case "exists":
      return actual !== undefined && actual !== null;
    case "contains":
      if (Array.isArray(actual)) return actual.includes(condition.value);
      if (typeof actual === "string" && typeof condition.value === "string") {
        return actual.includes(condition.value);
      }
      return false;
    default:
      return false;
  }
}

/**
 * AND-list evaluation: every condition must pass. An empty/missing list is
 * vacuously true (a rule with no conditions matches every firing of its
 * trigger). Malformed condition entries (missing field/op) fail closed —
 * they count as a non-match rather than throwing.
 */
function evaluateConditions(ctx: RunRulesContext, conditions: unknown): boolean {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  return conditions.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const condition = entry as Partial<Condition>;
    if (typeof condition.field !== "string" || !condition.op) return false;
    try {
      return evaluateCondition(ctx, condition as Condition);
    } catch {
      return false;
    }
  });
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && (error as { code?: string }).code === "23505";
}

/**
 * Executes one automation action, best-effort. Never throws — a bad or
 * unrecognized action type resolves to `{ ok: false, error }` so a single
 * malformed action in a rule's actions array doesn't stop the rest, and
 * doesn't propagate out of runRules.
 */
async function executeAction(
  supabase: ScopedClient,
  orgId: string,
  ctx: RunRulesContext,
  action: unknown,
): Promise<ActionResult> {
  const raw = action as { type?: unknown } & Record<string, unknown>;
  const type = typeof raw?.type === "string" ? raw.type : "unknown";

  try {
    switch (type) {
      case "apply_tag": {
        const a = raw as unknown as ApplyTagAction;
        if (!ctx.leadId || !a.tagId) {
          throw new Error("apply_tag requires a leadId in context and a tagId");
        }
        const { error } = await supabase.from("crm_lead_tag").insert({
          org_id: orgId,
          lead_id: ctx.leadId,
          tag_id: a.tagId,
          source: a.source ?? "auto",
          needs_review: false,
        });
        if (error) throw error;
        return { type, ok: true };
      }

      case "change_stage": {
        const a = raw as unknown as ChangeStageAction;
        if (!ctx.leadId || !a.stageId) {
          throw new Error("change_stage requires a leadId in context and a stageId");
        }
        const now = new Date().toISOString();
        const { error } = await supabase
          .from("crm_lead")
          .update({ current_stage_id: a.stageId, stage_entered_at: now, last_activity_at: now })
          .eq("id", ctx.leadId);
        if (error) throw error;
        // Parity with a user-driven move (src/lib/pipeline/leads.ts): a "won"
        // target stage fires the pipeline→matter handoff, so an automated move
        // can't land a lead in "won" with no matter. Best-effort — the stage
        // change already committed.
        try {
          const { data: destStage } = await supabase
            .from("crm_stage")
            .select("category")
            .eq("id", a.stageId)
            .maybeSingle();
          if (destStage?.category === "won") {
            await ensureMatterForLead(ctx.leadId);
          }
        } catch {
          // swallow: the stage change succeeded; the matter can be opened later.
        }
        return { type, ok: true };
      }

      case "assign_task": {
        const a = raw as unknown as AssignTaskAction;
        if (!a.title) throw new Error("assign_task requires a title");
        const { error } = await supabase.from("crm_task").insert({
          org_id: orgId,
          lead_id: ctx.leadId ?? null,
          title: a.title,
          type: a.taskType ?? "custom",
          assignee_id: a.assigneeId ?? null,
          due_at: a.dueAt ?? null,
        });
        if (error) throw error;
        return { type, ok: true };
      }

      case "enroll_drip": {
        const a = raw as unknown as EnrollDripAction;
        if (!ctx.leadId || !a.sequenceId) {
          throw new Error("enroll_drip requires a leadId in context and a sequenceId");
        }
        const { error } = await supabase.from("crm_drip_enrollment").insert({
          org_id: orgId,
          lead_id: ctx.leadId,
          sequence_id: a.sequenceId,
        });
        // unique(lead_id, sequence_id): the lead is already enrolled — that's
        // idempotent success from the rule's point of view, not a failure.
        if (error && !isUniqueViolation(error)) throw error;
        return { type, ok: true };
      }

      case "log": {
        const a = raw as unknown as LogAction;
        const { error } = await supabase.from("crm_activity").insert({
          org_id: orgId,
          lead_id: ctx.leadId ?? null,
          type: "automation_fired",
          actor_type: "automation",
          payload: { note: a.note ?? null, ctx: ctx as unknown as Database["public"]["Tables"]["crm_activity"]["Insert"]["payload"] },
        });
        if (error) throw error;
        return { type, ok: true };
      }

      default:
        throw new Error(`Unknown automation action type: ${type}`);
    }
  } catch (err) {
    return { type, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * The automation engine's single entry point. Loads the active org's active
 * rules for `trigger`, evaluates each rule's `conditions` (AND-list) against
 * `ctx`, and — for a match — either takes no action (dry_run) or executes the
 * rule's `actions` array best-effort. Every rule considered (matched or not)
 * logs a `crm_automation_run` row, so the automation dashboard's "recent
 * runs" reflects near-misses as well as fires.
 *
 * Deliberately does NOT import from "@/lib/pipeline" — pipeline imports this
 * module for its post-stage-change trigger, so the reverse would cycle.
 * Actions that mutate a lead (apply_tag/change_stage/enroll_drip) write
 * directly via getScopedClient instead of calling into pipeline's helpers.
 *
 * Never throws: this is called from moveLeadStage's hot path, and a broken
 * rule or a transient DB hiccup here must never fail the caller's action.
 */
export async function runRules(trigger: AutomationTrigger, ctx: RunRulesContext): Promise<void> {
  try {
    const supabase = await getScopedClient();

    const { data: orgId, error: orgError } = await supabase.rpc("current_org_id");
    if (orgError || !orgId) return;

    const { data: rules, error: rulesError } = await supabase
      .from("crm_automation_rule")
      .select("*")
      .eq("trigger_type", trigger)
      .eq("active", true);
    if (rulesError || !rules) return;

    for (const rule of rules as RuleRow[]) {
      let matched = false;
      let actionsTaken: ActionResult[] = [];

      try {
        matched = evaluateConditions(ctx, rule.conditions);
        if (matched && !rule.dry_run) {
          const actions = Array.isArray(rule.actions) ? rule.actions : [];
          for (const action of actions) {
            actionsTaken.push(await executeAction(supabase, orgId, ctx, action));
          }
        }
      } catch {
        // A broken rule (bad conditions shape, etc.) must never block the
        // loop — treat it as a non-match and still log the attempt below.
        matched = false;
        actionsTaken = [];
      }

      try {
        await supabase.from("crm_automation_run").insert({
          org_id: orgId,
          rule_id: rule.id,
          trigger_type: trigger,
          lead_id: ctx.leadId ?? null,
          matched,
          dry_run: rule.dry_run,
          actions_taken: actionsTaken as unknown as Database["public"]["Tables"]["crm_automation_run"]["Insert"]["actions_taken"],
        });
      } catch {
        // Logging failure must not surface — this is a best-effort audit trail.
      }
    }
  } catch {
    // runRules must never throw — see the doc comment above.
  }
}
