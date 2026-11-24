/**
 * One guard for the scheduled jobs (no dependency, pure).
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
 *
 * A job may have several hours a day (the Lawmatics daily sync: 4 AM, 12 PM and 4 PM), one pair of entries
 * per hour. The hours of one job must be at least 2 apart: with adjacent hours the summer entry of the later
 * hour and the winter entry of the earlier one would be the same UTC hour, and both pairs would let it through.
 */
export type CronJob = "lawmatics-matters" | "meetings-import" | "mailbox-sync" | "agents";

/** The New York hours (0 to 23) each job is meant to run in, earliest first. */
export const INTENDED_NY_HOUR: Readonly<Record<CronJob, readonly number[]>> = {
  // 4 AM: hired matters, new prospects, consults. 12 PM and 4 PM: new prospects and consults only.
  "lawmatics-matters": [4, 12, 16],
  "meetings-import": [4],
  "mailbox-sync": [4],
  agents: [5],
};

/** The daily sync's full run (hired matters included) is the first hour of `lawmatics-matters`. */
export const LAWMATICS_FULL_RUN_HOUR = 4;

const NY_HOUR = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" });

/** The hour of day (0 to 23) in New York at this instant. */
export function newYorkHour(now: Date): number {
  if (Number.isNaN(now.getTime())) return Number.NaN;
  const part = NY_HOUR.formatToParts(now).find((p) => p.type === "hour");
  return part ? Number(part.value) % 24 : Number.NaN;
}

/**
 * The intended New York hour `now` falls in, or null when it falls in none of the job's hours (an unreadable
 * clock is null). Callers compare with `=== null`, never truthiness: the answer is an hour number.
 */
export function shouldRunNow(job: CronJob, now: Date): number | null {
  const hour = newYorkHour(now);
  return Number.isInteger(hour) && INTENDED_NY_HOUR[job].includes(hour) ? hour : null;
}

/** The body a skipped tick answers with (HTTP 200, nothing else done). */
export const NOT_THIS_HOUR = { skipped: "not this hour" } as const;
