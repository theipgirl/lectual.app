import "server-only";
import { after } from "next/server";

/**
 * The stage-entry hook the two move paths call (`moveLeadStage`, the person's, and `moveAsAgent`, the Stage Keeper's).
 *
 * It schedules the prep with Next's `after()` so the move's response never waits for it. It NEVER throws into, delays or
 * changes the move: a failure to schedule, or any failure in the prep, is swallowed. Outside a request (a test, a
 * script) there is no `after()` and nothing is started.
 *
 * Preps started this way run ONE AT A TIME inside a server instance (a chain), so a Stage Keeper run that moves many
 * leads into the stage in one go does not start many runs at once. Each is still an ordinary runner run: the
 * Assistants feature, the setting, Autopilot, the `agent_run` row and the budget all apply (see trigger.ts).
 */

let chain: Promise<unknown> = Promise.resolve();

export function scheduleConsultPrepOnEntry(move: { leadId: string; toStageId: string }): void {
  try {
    after(() => {
      chain = chain
        .catch(() => undefined)
        .then(async () => {
          try {
            const { startPrepOnStageEntry } = await import("./trigger");
            const { productionRunnerDeps } = await import("@/lib/agents/deps");
            await startPrepOnStageEntry(productionRunnerDeps(), move);
          } catch {
            // Never into the move.
          }
        });
      return chain;
    });
  } catch {
    // No request scope: nothing is started.
  }
}
