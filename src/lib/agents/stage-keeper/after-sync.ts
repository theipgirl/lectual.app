import { bumpHeldConsults, type HeldConsultResult } from "@/lib/stage-keeper/held-consult";
import { loadAgentSettings, runOneAgent, type RunnerDeps, type RunOutcome } from "../runner";

/**
 * The step that runs right after a mailbox and calendar sync (the mailbox-sync cron calls it
 * once the sync is done). For each firm the sync touched:
 *   1. a consult that has taken place bumps its lead's last touch (always, whatever the agent
 *      switch says: it records a fact);
 *   2. the Stage Keeper runs if the firm holds the `agents` module and has switched it on, as an
 *      `event` run with the autonomy the firm chose. It needs no AI key. A paused Autopilot stops
 *      it exactly as it stops every agent (`runOneAgent` checks that itself).
 *
 * It never throws and never changes the sync's outcome: a failure here is a skipped or errored
 * entry in the result, nothing more. The result carries counts, never a name or a subject.
 */

export type AfterSyncResult = { held: HeldConsultResult[]; runs: RunOutcome[] };

export async function runStageKeeperAfterSync(deps: RunnerDeps, orgIds: readonly string[]): Promise<AfterSyncResult> {
  const result: AfterSyncResult = { held: [], runs: [] };
  const now = deps.now ?? Date.now;

  for (const orgId of [...new Set(orgIds)]) {
    result.held.push(await bumpHeldConsults(deps.admin, orgId, now()));
  }

  for (const orgId of [...new Set(orgIds)]) {
    try {
      const { data: org, error } = await deps.admin
        .from("crm_org")
        .select("id")
        .eq("id", orgId)
        .contains("modules", ["agents"])
        .maybeSingle();
      if (error || !org) continue;
      const setting = (await loadAgentSettings(deps.admin, orgId)).get("stage-keeper");
      if (!setting?.enabled) continue;
      result.runs.push(await runOneAgent(deps, { orgId, agent: "stage-keeper", autonomy: setting.autonomy, trigger: "event" }));
    } catch {
      // One firm's failure never stops the next, and never reaches the cron's response.
    }
  }
  return result;
}
