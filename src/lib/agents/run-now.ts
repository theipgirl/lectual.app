import { ASSISTANTS_PAUSED, NOT_SWITCHED_ON } from "@/lib/ui/words";
import { hasRole, type Role } from "@/lib/auth/roles";
import { agentNeedsAi, type AgentId } from "./types";
import { agentNeedsDatabaseUpdate, type DatabaseUpdate } from "./readiness";
import { ADMIN_TIER_PHRASE } from "@/lib/setup/roles";

/**
 * Whether "Run now" can run, and if not, the exact sentence to say. Pure: the Agents page and the run
 * action both build the inputs and both call `decideRunNow`, so the page can never offer a run the
 * action would refuse, or the other way round. The button is always drawn; this is its reason.
 *
 * What the firm's Autopilot row said, collapsed to what a run cares about:
 *   `clear`        no row, or a row that is not paused
 *   `paused`       the firm paused it
 *   `unreadable`   the read failed, so it is not known (a run would be refused too: the runner fails closed)
 *   `not-set-up`   the table is missing (lectual 0082), so no firm can have paused and nothing is blocked
 */
export type AutopilotForRun = "clear" | "paused" | "unreadable" | "not-set-up";

export type RunNowInput = {
  agent: AgentId;
  role: Role | null;
  enabled: boolean;
  autopilot: AutopilotForRun;
  aiConfigured: boolean;
  databaseUpdate: DatabaseUpdate;
  /** True while this card's run is in flight (a page-only fact). */
  running?: boolean;
};

export type RunNowBlock = "running" | "role" | "database-update" | "off" | "autopilot-paused" | "autopilot-unreadable" | "ai-key";

export type RunNowDecision =
  | { canRun: true }
  | { canRun: false; block: RunNowBlock; reason: string; tone: "note" | "warn" };

export const RUN_NOW_REASON: Record<RunNowBlock, string> = {
  running: "Running. This can take a minute.",
  role: `${ADMIN_TIER_PHRASE} can run assistants.`,
  "database-update": NOT_SWITCHED_ON,
  off: "Switch the assistant on first.",
  "autopilot-paused": `${ASSISTANTS_PAUSED} for your firm, so none of them run. Resume them first.`,
  "autopilot-unreadable": "We couldn't check whether assistants are paused, so nothing will run.",
  "ai-key": "AI isn't switched on for your firm yet. Lectual will turn it on.",
};

/** A Run now that reached its time budget. Anything queued before that stays queued. */
export const RUN_NOW_TIME_LIMIT =
  "The run didn't finish within the time limit, so it was stopped. Anything it drafted before that is in the queue; the next run picks up the rest.";

/** The action never answered (the request failed or the function was stopped). Said on the card instead of nothing. */
export const RUN_NOW_NO_ANSWER =
  "The run didn't report back. Check Recent runs below: a run that never finishes shows there as Didn't finish.";

/** Who may press Run now. The one place the role is named for it. */
export const canRunAgents = (role: Role | null | undefined): boolean => !!role && hasRole(role, "senior_admin");

const blocked = (block: RunNowBlock): RunNowDecision => ({
  canRun: false,
  block,
  reason: RUN_NOW_REASON[block],
  tone: block === "autopilot-unreadable" ? "warn" : "note",
});

/**
 * First cause that applies wins: running, role, the pending database update, the agent being off,
 * Autopilot (paused, or unreadable), then the AI key. The Stage Keeper calls no model, so a missing
 * key never stops it.
 */
export function decideRunNow(input: RunNowInput): RunNowDecision {
  if (input.running) return blocked("running");
  if (!canRunAgents(input.role)) return blocked("role");
  if (agentNeedsDatabaseUpdate(input.agent) && input.databaseUpdate === "pending") return blocked("database-update");
  if (!input.enabled) return blocked("off");
  if (input.autopilot === "paused") return blocked("autopilot-paused");
  if (input.autopilot === "unreadable") return blocked("autopilot-unreadable");
  if (agentNeedsAi(input.agent) && !input.aiConfigured) return blocked("ai-key");
  return { canRun: true };
}

/** An Autopilot read, as `loadAutopilot` returns it, in the terms `decideRunNow` takes. */
export function autopilotForRun(load: { status: "ok"; state: { paused: boolean } } | { status: "missing" } | { status: "unavailable" }): AutopilotForRun {
  if (load.status === "unavailable") return "unreadable";
  if (load.status === "missing") return "not-set-up";
  return load.state.paused ? "paused" : "clear";
}

/** What a finished (or refused) run leaves on the card. Structural, so the action's state type fits it as it is. */
export type RunResultState = {
  ok?: boolean;
  error?: string;
  message?: string;
  skipped?: boolean;
  itemsIn?: number;
  draftsOut?: number;
};

/**
 * The line a card shows after a run, without a reload. An error is the only thing drawn as an alert;
 * a skipped run says it was skipped (it did nothing, for a reason worth reading) and carries no counts.
 */
export function runResultLine(state: RunResultState): { text: string; alert: boolean } | null {
  if (state.error) return { text: state.error, alert: true };
  if (!state.ok) return null;
  const summary = state.message?.trim() || "Done.";
  if (state.skipped) return { text: `Skipped. ${summary}`, alert: false };
  if (state.itemsIn === undefined || state.draftsOut === undefined) return { text: summary, alert: false };
  const drafts = `${state.draftsOut} ${state.draftsOut === 1 ? "draft" : "drafts"} written`;
  return { text: `${summary} · ${state.itemsIn} read, ${drafts}`, alert: false };
}
