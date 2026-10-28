import { displayRunStatus } from "./run-status";
import type { AgentId } from "./types";

/**
 * The one line at the top of the Assistants page: how the assistants that are switched on are doing.
 * Pure: it reads only what the page already loaded, with the same "Didn't finish" rule as the run log.
 *
 * A read that failed is never "all fine": an unreadable settings list or run log says so.
 */
export type HealthInput = {
  /** False when the settings read failed. */
  settingsKnown: boolean;
  /** False when the run log read failed. */
  runsKnown: boolean;
  /** The firm-wide pause, when it is known to be on. */
  paused: boolean;
  /** The assistants that are switched on. */
  enabled: readonly AgentId[];
  /** Assistants that are on but blocked (nothing to read, no queue, ...). */
  blocked: ReadonlySet<AgentId>;
  /** Each assistant's newest run, if the page has one. */
  lastRun: (agent: AgentId) => { status: string; started_at: string; finished_at?: string | null } | undefined;
  now: number;
};

export type Health = { tone: "ok" | "warn" | "risk" | "mute"; text: string };

export const HEALTH_UNREADABLE = "Can't show assistant health right now.";
export const HEALTH_ALL_OK = "All assistants ran normally today";
export const HEALTH_NONE_ON = "No assistants are switched on.";
export const HEALTH_PAUSED = "Assistants are paused for your firm.";

const DAY_MS = 86_400_000;

export function assistantHealth(input: HealthInput): Health {
  if (!input.settingsKnown || !input.runsKnown) return { tone: "mute", text: HEALTH_UNREADABLE };
  if (input.paused) return { tone: "warn", text: HEALTH_PAUSED };
  if (input.enabled.length === 0) return { tone: "mute", text: HEALTH_NONE_ON };

  let needAttention = 0;
  let notRunToday = 0;
  for (const agent of input.enabled) {
    const last = input.lastRun(agent);
    const status = last ? displayRunStatus(last, input.now) : null;
    if (input.blocked.has(agent) || status === "error" || status === "unfinished") {
      needAttention += 1;
    } else if (!last || input.now - Date.parse(last.started_at) > DAY_MS) {
      notRunToday += 1;
    }
  }
  if (needAttention > 0) return { tone: "risk", text: `${needAttention} ${needAttention === 1 ? "needs" : "need"} attention` };
  if (notRunToday > 0) return { tone: "mute", text: `No problems. ${notRunToday} ${notRunToday === 1 ? "hasn't" : "haven't"} run today.` };
  return { tone: "ok", text: HEALTH_ALL_OK };
}

/** The question asked before an assistant's autonomy changes. */
export function autonomyChangeQuestion(name: string, from: string, to: string): string {
  const word = (a: string) => a.charAt(0).toUpperCase() + a.slice(1);
  return `Change ${name} from ${word(from)} to ${word(to)}?`;
}
