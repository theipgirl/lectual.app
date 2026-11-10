/**
 * When the approval deck is dealt. Pure: the clock and the firm's time zone come in.
 *
 * A firm's cards are dealt at fixed times of the firm's day (default 7:00 AM and 2:00 PM). The deal that is "current"
 * is the latest of today's times at or before now (none before the first); the next is the first time after now, which
 * after the last one is tomorrow's first. Times live in code for now (`DEFAULT_DEAL_TIMES`, 24-hour "HH:MM", firm time).
 */

export const DEFAULT_DEAL_TIMES: readonly string[] = ["07:00", "14:00"];

export type DealTime = { label: string; at: Date };
export type Deal = { current: DealTime | null; next: DealTime };

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function partsIn(at: Date, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(at)) if (p.type !== "literal") out[p.type] = Number.parseInt(p.value, 10);
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second };
}

/** Milliseconds the zone is ahead of UTC at `at`. */
function offsetAt(at: Date, timeZone: string): number {
  const p = partsIn(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (at.getTime() - at.getUTCMilliseconds());
}

/** The instant a wall-clock time on a calendar date in `timeZone` happens. A time skipped by a DST jump lands just after it. */
function zonedInstant(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall - offsetAt(new Date(wall), timeZone);
  // A second pass settles the offset when the guess crossed a DST change.
  guess = wall - offsetAt(new Date(guess), timeZone);
  return new Date(guess);
}

export function dealLabel(time: string): string {
  const m = HHMM.exec(time);
  if (!m) return time;
  const h = Number(m[1]);
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m[2]} ${suffix}`;
}

function cleanTimes(times: readonly string[]): string[] {
  const valid = times.filter((t) => HHMM.test(t));
  const list = valid.length > 0 ? valid : [...DEFAULT_DEAL_TIMES];
  const minutes = (t: string) => {
    const [h, mi] = t.split(":").map(Number);
    return h * 60 + mi;
  };
  return [...new Set(list)].sort((a, b) => minutes(a) - minutes(b));
}

function safeZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return "UTC";
  }
}

export function dealFor(now: Date, timeZone: string, times: readonly string[] = DEFAULT_DEAL_TIMES): Deal {
  const tz = safeZone(timeZone);
  const list = cleanTimes(times);
  const today = partsIn(now, tz);
  const on = (y: number, mo: number, d: number, t: string): DealTime => {
    const [h, mi] = t.split(":").map(Number);
    return { label: dealLabel(t), at: zonedInstant(y, mo, d, h, mi, tz) };
  };
  const todays = list.map((t) => on(today.year, today.month, today.day, t));
  const past = todays.filter((d) => d.at.getTime() <= now.getTime());
  const current = past.length > 0 ? past[past.length - 1] : null;
  const upcoming = todays.find((d) => d.at.getTime() > now.getTime());
  if (upcoming) return { current, next: upcoming };
  // Tomorrow's first: step a calendar day forward from today's date (noon UTC keeps it clear of the date line).
  const tomorrow = new Date(Date.UTC(today.year, today.month - 1, today.day + 1, 12));
  return { current, next: on(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth() + 1, tomorrow.getUTCDate(), list[0]) };
}

/**
 * The instant the cards on the table were dealt: today's current deal, or before the first one, yesterday's last.
 * Anything queued after it is a later arrival, counted and dealt at the next time (or by "Deal them now").
 */
export function dealtAt(now: Date, timeZone: string, times: readonly string[] = DEFAULT_DEAL_TIMES): Date {
  const deal = dealFor(now, timeZone, times);
  if (deal.current) return deal.current.at;
  const tz = safeZone(timeZone);
  const list = cleanTimes(times);
  const today = partsIn(now, tz);
  const y = new Date(Date.UTC(today.year, today.month - 1, today.day - 1, 12));
  const [h, mi] = list[list.length - 1].split(":").map(Number);
  return zonedInstant(y.getUTCFullYear(), y.getUTCMonth() + 1, y.getUTCDate(), h, mi, tz);
}

/** True when `at` falls on the same calendar day as `now` in the firm's zone. */
export function sameFirmDay(at: Date, now: Date, timeZone: string): boolean {
  const tz = safeZone(timeZone);
  const a = partsIn(at, tz);
  const b = partsIn(now, tz);
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * When a moment falls, said from `now` in the firm's day: "today at 7:00 AM", "tomorrow at 7:00 AM", else
 * "Wed, Nov 12 at 7:00 AM". Used where a card comes back after Later, which can run past the next deal.
 */
export function whenLabel(at: Date, now: Date, timeZone: string): string {
  const tz = safeZone(timeZone);
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(at);
  const a = partsIn(at, tz);
  const n = partsIn(now, tz);
  const dayNumber = (p: { year: number; month: number; day: number }) => Date.UTC(p.year, p.month - 1, p.day) / 86_400_000;
  const diff = dayNumber(a) - dayNumber(n);
  if (diff === 0) return `today at ${time}`;
  if (diff === 1) return `tomorrow at ${time}`;
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(at);
  return `${day} at ${time}`;
}
