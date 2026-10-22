/**
 * How an agent_run row reads to a person. Pure.
 *
 * A row is written "running" when a run starts and closed when it ends. If the function running it is
 * killed first (the platform's time limit), nothing closes it, and a row that says "running" forever
 * reads as an agent that is still working. No run can legitimately take longer than the function that
 * hosts it (300 seconds), so a row still "running" STALE_RUN_MS after it started is shown as "Didn't
 * finish", wherever runs are shown: the Recent runs table, the agent card, the digest. It also never
 * counts as "running" for anything that waits on a run.
 */

export const STALE_RUN_MS = 15 * 60_000;

/** The error a run row is closed with when the runner stops waiting for the agent. */
export const DID_NOT_FINISH_ERROR = "Did not finish within the time limit";

export type RunStatusRow = { status: string; started_at: string; finished_at?: string | null };

/** `unfinished` is a "running" row past STALE_RUN_MS. Every other status is passed through. */
export type DisplayRunStatus = "running" | "unfinished" | "ok" | "error" | "skipped" | (string & {});

export function isStaleRun(row: RunStatusRow, nowMs: number): boolean {
  if (row.status !== "running") return false;
  const started = Date.parse(row.started_at);
  // A start time that can't be read can't be shown as still going either.
  return !Number.isFinite(started) || nowMs - started > STALE_RUN_MS;
}

export function displayRunStatus(row: RunStatusRow, nowMs: number): DisplayRunStatus {
  return isStaleRun(row, nowMs) ? "unfinished" : row.status;
}

export const RUN_STATUS_LABEL: Record<string, string> = {
  running: "Running",
  unfinished: "Didn't finish",
  ok: "Done",
  error: "Failed",
  skipped: "Skipped",
};

/** What the Recent runs table prints in its duration column. */
export function runDurationLabel(row: RunStatusRow, nowMs: number): string {
  const status = displayRunStatus(row, nowMs);
  if (status === "unfinished") return "Didn't finish";
  if (!row.finished_at) return status === "running" ? "running" : "—";
  const s = Math.max(0, Math.round((Date.parse(row.finished_at) - Date.parse(row.started_at)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
