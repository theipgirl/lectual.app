import type { AgentId } from "./types";

/**
 * The agents' time budgets, in one place (pure: the runner, the Run now action and the tests read them).
 * Both entry points live in functions with `maxDuration = 300`: the cron route and the Agents page,
 * whose server action runs Run now. See runner.ts for how they are enforced.
 */

/** Run now: one agent, inside the Agents page's 300 seconds, with room left to close the row and answer. */
export const AGENT_RUN_BUDGET_MS = 240_000;
/** The cron's budget for all of it, inside the route's 300 seconds; the rest is for closing rows and answering. */
export const CRON_WALL_BUDGET_MS = 270_000;
/** No one agent may take more than this of the cron's budget, so one slow agent cannot starve its track. */
export const CRON_AGENT_CAP_MS = 150_000;
/** An agent is not started with less than this left: it could not do anything useful and would only be cut off. */
export const MIN_AGENT_START_MS = 20_000;

/**
 * The cron runs a firm's agents on two tracks at once; within a track, in order.
 *
 * Why tracks and not one queue or full concurrency: one queue of seven agents, several of which call a
 * model per item, does not fit in 300 seconds (that is what cut off RPB's 2026-10-22 cron, see runner.ts), and running all seven at once
 * would let agents whose results feed each other race. The dependencies are all in track A, in the order
 * they feed each other: the Stage Keeper's suggestion cards go into the morning brief; post-consult's
 * client drafts must already be in the queue when the brief checks which stalled leads have a draft
 * waiting (otherwise it could draft a second email to the same person); consult-prep comes last because
 * it looks a day ahead and is the cheapest to defer. Track B's agents read only mail and new leads and
 * are incremental (anything not reached is picked up next run), so they run beside track A.
 */
export const CRON_TRACKS: readonly (readonly AgentId[])[] = [
  ["stage-keeper", "post-consult", "morning-brief", "consult-prep"],
  ["inbox-summary", "email-intel", "intake-triage"],
];

