import type { Role } from "@/lib/auth/roles";
import { AGENT_IDS, type AgentId } from "./types";

/**
 * Autopilot: the firm-wide pause over every in-app agent (lectual 0082,
 * `agent_autopilot`). Pure, so the rules are tested without a database and
 * can be imported by client components.
 *
 * WHO MAY PAUSE / RESUME. Pausing only ever makes the software do LESS, so the
 * practising attorney can stop it without first finding an admin: owner,
 * admin, senior_admin and attorney may pause. Resuming turns automation back
 * on, which is the same administrative act as switching an agent on (0076's
 * agent_setting gate), so only owner/admin/senior_admin may resume. The
 * database enforces the same split (0082's policies + trigger); these lists
 * only decide which buttons to draw.
 */

export const AUTOPILOT_PAUSE_ROLES: readonly Role[] = ["owner", "admin", "senior_admin", "attorney"];
export const AUTOPILOT_RESUME_ROLES: readonly Role[] = ["owner", "admin", "senior_admin"];

export const canPauseAutopilot = (role: Role): boolean => AUTOPILOT_PAUSE_ROLES.includes(role);
export const canResumeAutopilot = (role: Role): boolean => AUTOPILOT_RESUME_ROLES.includes(role);

export type AutopilotState = {
  paused: boolean;
  pausedBy: string | null;
  pausedAt: string | null;
  reason: string | null;
  minutesPerTask: Record<AgentId, number>;
  /** True when the firm has set its own minutes for at least one agent. */
  minutesCustomised: boolean;
};

/**
 * The visible defaults for "minutes one completed task would have taken by
 * hand". Deliberately conservative. They are an ESTIMATE the firm can change
 * (Agents → Hours saved), never a measurement and never billing: Lectual's fee
 * is flat and includes model usage (lectual brain/decisions.md 2026-07-17-02).
 */
export const DEFAULT_MINUTES_PER_TASK: Record<AgentId, number> = {
  "intake-triage": 10,
  "email-intel": 5,
  "post-consult": 20,
};

/** What one "task" is for each agent, for the footnote and the settings form. */
export const TASK_UNIT: Record<AgentId, { singular: string; plural: string }> = {
  "intake-triage": { singular: "lead screened", plural: "leads screened" },
  "email-intel": { singular: "client email read", plural: "client emails read" },
  "post-consult": { singular: "follow-up drafted", plural: "follow-ups drafted" },
};

export const MAX_MINUTES_PER_TASK = 240;

/** The stored jsonb, cleaned: unknown keys and out-of-range values fall back to the default. */
export function resolveMinutes(raw: unknown): { minutes: Record<AgentId, number>; customised: boolean } {
  const obj = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  let customised = false;
  const minutes = { ...DEFAULT_MINUTES_PER_TASK };
  for (const agent of AGENT_IDS) {
    const v = obj[agent];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_MINUTES_PER_TASK) {
      minutes[agent] = v;
      customised = true;
    }
  }
  return { minutes, customised };
}

/** Parses the Hours-saved settings form. Blank means "use the default" (key omitted). */
export function parseMinutesForm(form: FormData): { ok: true; value: Partial<Record<AgentId, number>> } | { ok: false; reason: string } {
  const value: Partial<Record<AgentId, number>> = {};
  for (const agent of AGENT_IDS) {
    const raw = form.get(`minutes-${agent}`);
    if (raw == null || String(raw).trim() === "") continue;
    const n = Number(String(raw).trim());
    if (!Number.isFinite(n) || n < 0 || n > MAX_MINUTES_PER_TASK) {
      return { ok: false, reason: `Minutes must be a number from 0 to ${MAX_MINUTES_PER_TASK}.` };
    }
    value[agent] = Math.round(n * 10) / 10;
  }
  return { ok: true, value };
}

export function autopilotFromRow(row: {
  paused: boolean;
  paused_by: string | null;
  paused_at: string | null;
  reason: string | null;
  minutes_per_task: unknown;
} | null): AutopilotState {
  const { minutes, customised } = resolveMinutes(row?.minutes_per_task);
  return {
    paused: Boolean(row?.paused),
    pausedBy: row?.paused_by ?? null,
    pausedAt: row?.paused_at ?? null,
    reason: row?.reason ?? null,
    minutesPerTask: minutes,
    minutesCustomised: customised,
  };
}

// ── Hours saved (est.) ───────────────────────────────────────────────────────

export type RunForEstimate = { agent: string; status: string; items_in: number; drafts_out: number; started_at: string };

/**
 * How many completed tasks a run represents. Only finished, successful runs
 * count. The unit is the one TASK_UNIT names, read from the run's own counts:
 * triage screens every lead it reads (items_in), email intel reads every
 * email it counts (items_in), and the post-consult drafter's task is the
 * follow-up it drafted (drafts_out). A skipped or failed run saved nothing.
 */
export function tasksInRun(run: RunForEstimate): number {
  if (run.status !== "ok") return 0;
  switch (run.agent) {
    case "intake-triage":
    case "email-intel":
      return Math.max(0, run.items_in ?? 0);
    case "post-consult":
      return Math.max(0, run.drafts_out ?? 0);
    default:
      return 0;
  }
}

export type HoursSavedEstimate = {
  hours: number;
  tasks: Record<AgentId, number>;
  minutes: Record<AgentId, number>;
};

/** Σ tasks × the firm's minutes per task, in hours to one decimal. An estimate, labelled as one. */
export function estimateHoursSaved(runs: readonly RunForEstimate[], minutes: Record<AgentId, number>): HoursSavedEstimate {
  const tasks: Record<AgentId, number> = { "intake-triage": 0, "email-intel": 0, "post-consult": 0 };
  for (const r of runs) {
    if ((AGENT_IDS as readonly string[]).includes(r.agent)) tasks[r.agent as AgentId] += tasksInRun(r);
  }
  const totalMinutes = AGENT_IDS.reduce((sum, a) => sum + tasks[a] * minutes[a], 0);
  return { hours: Math.round((totalMinutes / 60) * 10) / 10, tasks, minutes };
}

/** "est. using 10 min per lead screened, 5 min per client email read, 20 min per follow-up drafted" */
export function estimateAssumption(minutes: Record<AgentId, number>): string {
  return AGENT_IDS.map((a) => `${minutes[a]} min per ${TASK_UNIT[a].singular}`).join(", ");
}

/** A time on the firm's clock: "6:02 AM" today, else "Sep 28, 6:02 AM". */
export function firmClock(iso: string, now: Date, tz: string): string {
  const at = new Date(iso);
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at);
  if (day(at) === day(now)) return time;
  return `${new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(at)}, ${time}`;
}

/**
 * The one-line state beside the Pause/Resume control:
 *   "Autopilot on · last run 6:02 AM"
 *   "Paused by Dana Ruiz at 9:14 AM"
 */
export function autopilotStateLine(
  state: Pick<AutopilotState, "paused" | "pausedAt">,
  opts: { lastRunAt: string | null; pausedByName: string | null; now: Date; tz: string },
): string {
  if (state.paused) {
    const who = opts.pausedByName ? `Paused by ${opts.pausedByName}` : "Paused";
    return state.pausedAt ? `${who} at ${firmClock(state.pausedAt, opts.now, opts.tz)}` : who;
  }
  return opts.lastRunAt ? `Autopilot on · last run ${firmClock(opts.lastRunAt, opts.now, opts.tz)}` : "Autopilot on · no runs yet";
}
