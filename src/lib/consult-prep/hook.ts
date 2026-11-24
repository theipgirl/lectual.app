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

/**
 * Leads moved during ONE request are collected and started together, once the response has gone: ONE scoped run of at most five
 * leads (see trigger.ts), so a Stage Keeper run or a bulk move that puts many leads into the stage never starts many runs. The rest
 * are left to the next sweep. A move into a lost or nurture stage rides the same hook (the run cancels that lead's reminders).
 */
let pending = new Map<string, string>();
let armed = false;

export function scheduleConsultPrepOnEntry(move: { leadId: string; toStageId: string }): void {
  const first = !armed;
  try {
    pending.set(move.leadId, move.toStageId);
    if (!first) return;
    armed = true;
    after(() => {
      const moves = [...pending].map(([leadId, toStageId]) => ({ leadId, toStageId }));
      pending = new Map();
      armed = false;
      chain = chain
        .catch(() => undefined)
        .then(async () => {
          try {
            const { startPrepOnStageEntries } = await import("./trigger");
            const { productionRunnerDeps } = await import("@/lib/agents/deps");
            await startPrepOnStageEntries(productionRunnerDeps(), moves);
          } catch {
            // Never into the move.
          }
        });
      return chain;
    });
  } catch {
    // No request scope: nothing is started.
    if (first) {
      pending = new Map();
      armed = false;
    }
  }
}
