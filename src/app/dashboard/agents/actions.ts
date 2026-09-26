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

export type AgentActionState = { ok?: boolean; error?: string; message?: string };

const AUTONOMIES: readonly Autonomy[] = ["suggest", "draft", "act"];
const isAgent = (v: unknown): v is AgentId => typeof v === "string" && (AGENT_IDS as readonly string[]).includes(v);

/**
 * Each action is its own POST entry point, so each repeats the gates the page
 * applies: the module (fail closed), and the role. The database enforces the
 * role again on agent_setting (0058 RLS: owner/admin/senior_admin only).
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

  const outcome = await runOneAgent(productionRunnerDeps(), {
    orgId: session.org.id,
    agent,
    autonomy: setting.autonomy as Autonomy,
    trigger: "manual",
    triggeredBy: session.user.id,
  });
  refresh();
  if (outcome.status === "error") return { error: `The run failed: ${outcome.error}` };
  return { ok: true, message: outcome.result?.summary };
}
