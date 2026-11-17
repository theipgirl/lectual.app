import { INTENDED_NY_HOUR, newYorkHour, type CronJob } from "@/lib/cron/ny-hour";
import { PREP_WINDOW_HOURS } from "@/lib/agents/consult-prep/run";

/**
 * WHEN the scheduled jobs run, read from the code that schedules them, never written down a second time:
 * `INTENDED_NY_HOUR` (`src/lib/cron/ny-hour.ts`) is the New York hour each daily job is let through in (the
 * two vercel.json entries per job and the hour guard make it that hour all year). A job may fire anywhere in
 * its hour (Vercel moves the minute), so a promise names the WHOLE hour, never a minute.
 *
 * Pure. Every New York hour is one whole UTC hour (the zone's offsets are whole hours), so the hour's start is
 * a UTC hour boundary and stepping by one UTC hour visits every New York hour once.
 */

const HOUR_MS = 3_600_000;
/** How far ahead a window is looked for: two days and a margin for a clock change. */
const SEARCH_HOURS = 24 * 3;

export type RunWindow = { job: CronJob; start: string; end: string };

/** The first window of `job` whose start is strictly after `after`. Null on an unreadable clock. */
export function nextRunWindow(job: CronJob, after: Date): RunWindow | null {
  const t0 = after.getTime();
  if (!Number.isFinite(t0)) return null;
  let t = Math.floor(t0 / HOUR_MS) * HOUR_MS;
  if (t <= t0) t += HOUR_MS;
  const hour = INTENDED_NY_HOUR[job];
  for (let i = 0; i < SEARCH_HOURS; i += 1, t += HOUR_MS) {
    if (newYorkHour(new Date(t)) === hour) return { job, start: new Date(t).toISOString(), end: new Date(t + HOUR_MS).toISOString() };
  }
  return null;
}

/** The next `count` windows of `job` after `after`, in order. */
export function runWindows(job: CronJob, after: Date, count: number): RunWindow[] {
  const out: RunWindow[] = [];
  let from = after;
  for (let i = 0; i < count; i += 1) {
    const w = nextRunWindow(job, from);
    if (!w) break;
    out.push(w);
    from = new Date(Date.parse(w.start));
  }
  return out;
}

/**
 * The morning run that prepares a consult: consult prep takes the consults starting in the next
 * `PREP_WINDOW_HOURS` hours of the moment it runs. A window qualifies only when EVERY moment in it would pick the
 * consult up: the consult starts no earlier than the window's end and no more than 24 hours after its start. Null
 * when no run before the consult can (a consult early in the morning that the run before it cannot reach): the card
 * then promises nothing for it.
 */
export function prepRunFor(consultStartsAt: string, now: Date): RunWindow | null {
  const starts = Date.parse(consultStartsAt);
  if (!Number.isFinite(starts) || starts <= now.getTime()) return null;
  for (const w of runWindows("agents", now, 4)) {
    const ws = Date.parse(w.start);
    const we = Date.parse(w.end);
    if (ws >= starts) return null;
    if (starts >= we && starts - ws <= PREP_WINDOW_HOURS * HOUR_MS) return w;
  }
  return null;
}

/**
 * The earliest morning run that can draft from a call's recording: the meetings import (its own hour) must run
 * after the call ends, then the assistants' run after it. "Earliest" because a recording can take longer to reach
 * the provider than that.
 */
export function firstRunAfterImport(callEndsAt: string): RunWindow | null {
  const ends = Date.parse(callEndsAt);
  if (!Number.isFinite(ends)) return null;
  const imp = nextRunWindow("meetings-import", new Date(ends - 1));
  if (!imp) return null;
  return nextRunWindow("agents", new Date(Date.parse(imp.start)));
}

/* ─────────────────────────── words for a window ─────────────────────────── */

export type WindowWords = {
  /** "Today", "Tomorrow" or "Thu Nov 19", in the firm's zone. */
  day: string;
  /** "5 AM" in the firm's zone. */
  from: string;
  /** "6 AM" in the firm's zone. */
  to: string;
};

function civilDate(iso: string | number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** "Today" / "Tomorrow" / "Thu Nov 19" for an instant, judged on the firm's calendar. */
export function dayWord(iso: string, now: Date, timeZone: string): string {
  const day = civilDate(iso, timeZone);
  const today = civilDate(now.getTime(), timeZone);
  if (day === today) return "Today";
  // Tomorrow by the calendar, not by adding 24 hours (a day with a clock change is 23 or 25 hours long).
  if (day === addCivilDays(today, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
}

/** YYYY-MM-DD plus `n` calendar days. */
export function addCivilDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function hourWord(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  const period = (parts.find((p) => p.type === "dayPeriod")?.value ?? "").toUpperCase();
  return minute === "00" ? `${hour} ${period}` : `${hour}:${minute} ${period}`;
}

export function windowWords(w: RunWindow, now: Date, timeZone: string): WindowWords {
  return { day: dayWord(w.start, now, timeZone), from: hourWord(w.start, timeZone), to: hourWord(w.end, timeZone) };
}

/** "Thu Nov 19, 2:00 PM" (or "Today, 2:00 PM") for a consult start, in the firm's zone. */
export function whenWords(iso: string, now: Date, timeZone: string): string {
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
  return `${dayWord(iso, now, timeZone)}, ${time}`;
}

/** "Nov 19" in the firm's zone. */
export function shortDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(new Date(iso));
}

/** The firm-calendar date (YYYY-MM-DD) of an instant. */
export function firmDate(iso: string | number, timeZone: string): string {
  return civilDate(iso, timeZone);
}
