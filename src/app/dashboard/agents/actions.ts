"use server";

import { refresh } from "next/cache";
import { hasRole } from "@/lib/auth/roles";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { orgHasModule } from "@/lib/org/modules";
import { aiConfigured } from "@/lib/ai/claude";
import { runOneAgent } from "@/lib/agents/runner";
import { productionRunnerDeps } from "@/lib/agents/deps";
import { AGENT_IDS, type AgentId, type Autonomy } from "@/lib/agents/types";
import { canPauseAutopilot, canResumeAutopilot, parseMinutesForm } from "@/lib/agents/autopilot-rules";
import { loadAutopilot } from "@/lib/agents/autopilot";

export type AgentActionState = { ok?: boolean; error?: string; message?: string };

const AUTONOMIES: readonly Autonomy[] = ["suggest", "draft", "act"];
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
  if (error) return { error: `Couldn't save: ${error.message}` };
  refresh();
  return { ok: true };
}

export async function runAgentNowAction(_prev: AgentActionState, formData: FormData): Promise<AgentActionState> {
  const session = await adminSession();
  if (!session) return { error: "Only an owner, admin or senior admin can run agents." };
  const agent = formData.get("agent");
  if (!isAgent(agent)) return { error: "Unknown agent." };
  if (!aiConfigured()) return { error: "The AI key isn't configured on this deployment." };

  // Read the setting as the caller, through RLS: the firm is the caller's own.
  const supabase = await getScopedClient();
  const { data: setting } = await supabase
    .from("agent_setting")
    .select("enabled, autonomy")
    .eq("agent", agent)
    .maybeSingle();
  if (!setting?.enabled) return { error: "Switch the agent on first." };

  // The firm-wide pause, read as the caller for a clear message. runOneAgent
  // checks it again with the service role, so this is not the only guard.
  const autopilot = await loadAutopilot();
  if (autopilot.status === "unavailable") {
    return { error: "We couldn't check whether Autopilot is paused, so nothing ran. Try again shortly." };
  }
  if (autopilot.status === "ok" && autopilot.state.paused) {
    return { error: "Autopilot is paused for the firm, so no agent runs, including Run now. Resume Autopilot first." };
  }

  const outcome = await runOneAgent(productionRunnerDeps(), {
    orgId: session.org.id,
    agent,
    autonomy: setting.autonomy as Autonomy,
    trigger: "manual",
    triggeredBy: session.user.id,
  });
  refresh();
  if (outcome.reason === "paused") {
    return { error: "Autopilot is paused for the firm (or its state couldn't be read), so nothing ran." };
  }
  if (outcome.status === "error") return { error: `The run failed: ${outcome.error}` };
  return { ok: true, message: outcome.result?.summary };
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
