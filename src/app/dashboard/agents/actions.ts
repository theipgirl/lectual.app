"use server";

import { refresh } from "next/cache";
import { hasRole } from "@/lib/auth/roles";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { orgHasModule } from "@/lib/org/modules";
import { aiConfigured } from "@/lib/ai/claude";
import { runOneAgent } from "@/lib/agents/runner";
import { AGENT_RUN_BUDGET_MS } from "@/lib/agents/budget";
import { productionRunnerDeps } from "@/lib/agents/deps";
import { AGENT_IDS, type AgentId, type Autonomy } from "@/lib/agents/types";
import { agentNeedsDatabaseUpdate, type DatabaseUpdate } from "@/lib/agents/readiness";
import { autopilotForRun, canRunAgents, decideRunNow, RUN_NOW_REASON, RUN_NOW_TIME_LIMIT } from "@/lib/agents/run-now";
import { readCalendarProbe } from "@/lib/stage-keeper/readiness-read";
import { canPauseAutopilot, canResumeAutopilot, parseMinutesForm } from "@/lib/agents/autopilot-rules";
import { loadAutopilot } from "@/lib/agents/autopilot";

export type AgentActionState = {
  ok?: boolean;
  error?: string;
  message?: string;
  /** A finished run that did nothing for a reason worth showing (see AgentResult.skipped). */
  skipped?: boolean;
  /** Counts for the "N read, M drafts written" line. Only a run that finished carries them. */
  itemsIn?: number;
  draftsOut?: number;
};

const AUTONOMIES: readonly Autonomy[] = ["suggest", "draft", "act"];
/** The agents the database's settings CHECK only accepts once lectual 0098 is applied, as the refusal names them. */
const UPDATE_AGENT_NAME: Partial<Record<AgentId, string>> = {
  "stage-keeper": "The Stage Keeper",
  "morning-brief": "The Morning brief",
  "consult-prep": "Consult prep",
  "inbox-summary": "The Inbox summary",
};
const isAgent = (v: unknown): v is AgentId => typeof v === "string" && (AGENT_IDS as readonly string[]).includes(v);

/**
 * Each action is its own POST entry point, so each repeats the gates the page
 * applies: the module (fail closed), and the role. The database enforces the
 * role again on agent_setting (0076 RLS: owner/admin/senior_admin only).
 */
async function adminSession() {
  if (!(await orgHasModule("agents"))) return null;
  const session = await resolveFirmSession();
  if (session.kind !== "ok" || !hasRole(session.role, "senior_admin")) return null;
  return session;
}

export async function saveAgentSettingAction(_prev: AgentActionState, formData: FormData): Promise<AgentActionState> {
  const session = await adminSession();
  if (!session) return { error: "Only an owner, admin or senior admin can change agents." };
  const agent = formData.get("agent");
  const autonomy = formData.get("autonomy");
  const enabled = formData.get("enabled") === "true";
  if (!isAgent(agent) || !AUTONOMIES.includes(autonomy as Autonomy)) return { error: "Unknown setting." };

  const supabase = await getScopedClient();
  const { error } = await supabase.from("agent_setting").upsert(
    {
      org_id: session.org.id,
      agent,
      enabled,
      autonomy: autonomy as Autonomy,
      updated_by: session.user.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,agent" },
  );
  if (error) {
    // The database's agent list (a CHECK) doesn't name the Stage Keeper or the three newest agents until
    // lectual 0098 is applied. Say that, not a raw Postgres message. Other agents' messages are unchanged.
    const waitingOnUpdate = UPDATE_AGENT_NAME[agent];
    if (waitingOnUpdate && (error.code === "23514" || /agent_setting_agent|check constraint/i.test(error.message ?? ""))) {
      return { error: `${waitingOnUpdate} isn't available until the database update (lectual 0098) is applied. Nothing was changed.` };
    }
    return { error: `Couldn't save: ${error.message}` };
  }
  refresh();
  return { ok: true };
}

export async function runAgentNowAction(_prev: AgentActionState, formData: FormData): Promise<AgentActionState> {
  // A forged request is refused with the same sentence the page prints beside the button: both ask decideRunNow.
  if (!(await orgHasModule("agents"))) return { error: RUN_NOW_REASON.role };
  const session = await resolveFirmSession();
  if (session.kind !== "ok" || !canRunAgents(session.role)) return { error: RUN_NOW_REASON.role };
  const agent = formData.get("agent");
  if (!isAgent(agent)) return { error: "Unknown agent." };

  // Read the setting as the caller, through RLS: the firm is the caller's own.
  const supabase = await getScopedClient();
  const { data: setting, error: settingError } = await supabase
    .from("agent_setting")
    .select("enabled, autonomy")
    .eq("agent", agent)
    .maybeSingle();
  // A failed read is not "off": the page draws no Run now for it either.
  if (settingError) return { error: "We couldn't read this agent's setting, so nothing ran. Try again shortly." };

  // The firm-wide pause, read as the caller for a clear message. runOneAgent
  // checks it again with the service role, so this is not the only guard.
  const autopilot = await loadAutopilot();
  // The page probes the calendar only for a firm with the Mailboxes module; the same rule here.
  let databaseUpdate: DatabaseUpdate = "unknown";
  if (agentNeedsDatabaseUpdate(agent) && (await orgHasModule("mailbox"))) databaseUpdate = (await readCalendarProbe()).databaseUpdate;

  const decision = decideRunNow({
    agent,
    role: session.role,
    enabled: Boolean(setting?.enabled),
    autopilot: autopilotForRun(autopilot),
    aiConfigured: aiConfigured(),
    databaseUpdate,
  });
  if (!decision.canRun) return { error: decision.reason };

  const outcome = await runOneAgent(productionRunnerDeps(), {
    orgId: session.org.id,
    agent,
    autonomy: (setting?.autonomy ?? "draft") as Autonomy,
    trigger: "manual",
    triggeredBy: session.user.id,
    // Inside the page's maxDuration (300 s), with room to close the row and answer. Past it, the row is
    // closed as "Did not finish within the time limit" and the card says so; it never hangs.
    budgetMs: AGENT_RUN_BUDGET_MS,
  });
  refresh();
  if (outcome.reason === "paused") {
    return { error: "Autopilot is paused for the firm (or its state couldn't be read), so nothing ran." };
  }
  if (outcome.reason === "time-limit") return { error: RUN_NOW_TIME_LIMIT };
  if (outcome.status === "error") return { error: `The run failed: ${outcome.error}` };
  return {
    ok: true,
    skipped: outcome.status === "skipped",
    message: outcome.result?.summary,
    itemsIn: outcome.result?.itemsIn,
    draftsOut: outcome.result?.draftsOut,
  };
}

// ── Autopilot (lectual 0082) ─────────────────────────────────────────────────

/** Module gate + a signed-in firm session. The role checks differ per action. */
async function autopilotSession() {
  if (!(await orgHasModule("agents"))) return null;
  const session = await resolveFirmSession();
  return session.kind === "ok" ? session : null;
}

/**
 * Pause: owner/admin/senior_admin/attorney. Resume: owner/admin/senior_admin.
 * The database enforces the same split (0082 policies + trigger) and stamps
 * who paused from the session, so the form cannot name someone else.
 */
export async function setAutopilotAction(_prev: AgentActionState, formData: FormData): Promise<AgentActionState> {
  const session = await autopilotSession();
  if (!session) return { error: "Agents aren't available for this firm." };
  const pause = formData.get("paused") === "true";
  if (pause && !canPauseAutopilot(session.role)) return { error: "Only an attorney or an admin can pause Autopilot." };
  if (!pause && !canResumeAutopilot(session.role)) return { error: "Only an owner, admin or senior admin can resume Autopilot." };
  const reasonRaw = String(formData.get("reason") ?? "").trim().slice(0, 280);

  const supabase = await getScopedClient();
  const { error } = await supabase.from("agent_autopilot").upsert(
    { org_id: session.org.id, paused: pause, reason: pause ? reasonRaw || null : null },
    { onConflict: "org_id" },
  );
  if (error) return { error: `Couldn't ${pause ? "pause" : "resume"} Autopilot: ${error.message}` };
  refresh();
  return { ok: true, message: pause ? "Autopilot paused. No agent will run until it is resumed." : "Autopilot resumed." };
}

/** The firm's minutes-per-task estimate behind "Hours saved (est.)". Admins only. */
export async function saveMinutesPerTaskAction(_prev: AgentActionState, formData: FormData): Promise<AgentActionState> {
  const session = await adminSession();
  if (!session) return { error: "Only an owner, admin or senior admin can change this." };
  const parsed = parseMinutesForm(formData);
  if (!parsed.ok) return { error: parsed.reason };

  // Update only the minutes, never the pause: a read-then-write of `paused`
  // could quietly undo a pause made a moment ago.
  const supabase = await getScopedClient();
  const { data: updated, error: updateError } = await supabase
    .from("agent_autopilot")
    .update({ minutes_per_task: parsed.value })
    .eq("org_id", session.org.id)
    .select("org_id");
  let error = updateError;
  if (!error && (updated ?? []).length === 0) {
    ({ error } = await supabase.from("agent_autopilot").insert({ org_id: session.org.id, minutes_per_task: parsed.value }));
  }
  if (error) return { error: `Couldn't save: ${error.message}` };
  refresh();
  return { ok: true, message: "Saved." };
}
