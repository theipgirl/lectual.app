/**
 * One guard for the four morning crons (no dependency, pure).
 *
 * Vercel crons are UTC only, so each job has TWO entries in vercel.json, one UTC hour apart: the
 * winter entry (EST, UTC-5) and a summer entry one hour earlier (EDT, UTC-4). Both fire every day;
 * `shouldRunNow` lets through only the one whose tick lands in the job's intended New York HOUR, so
 * the jobs run at the same New York clock time all year.
 *
 * It is the HOUR, never the minute: a tick scheduled at :23 may fire anywhere in :00 to :59 of its
 * UTC hour, and a New York hour is one whole UTC hour, so the answer is the same for the whole tick.
 * The two entries are exactly one UTC hour apart, so at any instant of a day exactly one of the pair's
 * UTC hours falls in the intended New York hour (tests/cron/ny-hour.test.ts walks 2026 and 2027).
 */
export type CronJob = "lawmatics-matters" | "meetings-import" | "mailbox-sync" | "agents";

/** The New York hour (0 to 23) each job is meant to run in. */
export const INTENDED_NY_HOUR: Readonly<Record<CronJob, number>> = {
  "lawmatics-matters": 4,
  "meetings-import": 4,
  "mailbox-sync": 4,
  agents: 5,
};

const NY_HOUR = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" });

/** The hour of day (0 to 23) in New York at this instant. */
export function newYorkHour(now: Date): number {
  if (Number.isNaN(now.getTime())) return Number.NaN;
  const part = NY_HOUR.formatToParts(now).find((p) => p.type === "hour");
  return part ? Number(part.value) % 24 : Number.NaN;
}

/** True only when `now` falls in the job's intended New York hour. An unreadable clock is false. */
export function shouldRunNow(job: CronJob, now: Date): boolean {
  const hour = newYorkHour(now);
  return Number.isInteger(hour) && hour === INTENDED_NY_HOUR[job];
}

/** The body a skipped tick answers with (HTTP 200, nothing else done). */
export const NOT_THIS_HOUR = { skipped: "not this hour" } as const;
