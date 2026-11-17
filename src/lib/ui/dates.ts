// THE date and time formatter. Pure. `tz` is always the firm's time zone (getFirmTimeZone() on the
// server, passed down as a prop to client components), never the browser's or the server's.
// A "YYYY-MM-DD" string is a civil date and is never shifted by a zone; anything else is an instant.

export type DateInput = string | number | Date;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/;

type Civil = { y: number; m: number; d: number };

const dayFormats = new Map<string, Intl.DateTimeFormat>();
const timeFormats = new Map<string, Intl.DateTimeFormat>();

function toDate(input: DateInput | null | undefined): Date | null {
  if (input === null || input === undefined || input === "") return null;
  const date = input instanceof Date ? input : new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseCivil(input: DateInput | null | undefined): Civil | null {
  if (typeof input !== "string") return null;
  const m = CIVIL.exec(input.trim());
  if (!m) return null;
  const civil = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  if (civil.m < 1 || civil.m > 12 || civil.d < 1 || civil.d > 31) return null;
  return civil;
}

function dayFormat(tz: string): Intl.DateTimeFormat | null {
  let f = dayFormats.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "numeric", day: "numeric" });
    } catch {
      return null;
    }
    dayFormats.set(tz, f);
  }
  return f;
}

function timeFormat(tz: string): Intl.DateTimeFormat | null {
  let f = timeFormats.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hourCycle: "h23" });
    } catch {
      return null;
    }
    timeFormats.set(tz, f);
  }
  return f;
}

function civilOfInstant(date: Date, tz: string): Civil | null {
  const f = dayFormat(tz);
  if (!f) return null;
  const parts = f.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const civil = { y: get("year"), m: get("month"), d: get("day") };
  return Number.isFinite(civil.y) && Number.isFinite(civil.m) && Number.isFinite(civil.d) ? civil : null;
}

function civilOf(input: DateInput | null | undefined, tz: string): Civil | null {
  const civil = parseCivil(input);
  if (civil) return civil;
  const date = toDate(input);
  return date ? civilOfInstant(date, tz) : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The civil day ("2026-11-16") an input falls on in the firm's zone. */
export function civilDay(input: DateInput, tz: string): string | null {
  const c = civilOf(input, tz);
  return c ? `${c.y}-${pad(c.m)}-${pad(c.d)}` : null;
}

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/**
 * "Nov 16"; "Nov 16, 2025" when that year is not the current year in the firm's zone.
 * With `weekday` the day name leads: "Mon, Nov 16" ("short") or "Monday, Nov 16" ("long").
 */
export function formatDay(
  input: DateInput | null | undefined,
  opts: { tz: string; now?: Date; civil?: boolean; weekday?: "short" | "long" },
): string | null {
  // civil: a stored UTC-midnight civil date (a sheet date); read its day in UTC so no zone moves it back a day.
  const tz = opts.civil ? "UTC" : opts.tz;
  const c = civilOf(input, tz);
  if (!c) return null;
  const nowCivil = civilOfInstant(opts.now ?? new Date(), tz);
  const label = `${MONTHS[c.m - 1]} ${c.d}`;
  const day = nowCivil && nowCivil.y === c.y ? label : `${label}, ${c.y}`;
  if (!opts.weekday) return day;
  const dow = new Date(Date.UTC(c.y, c.m - 1, c.d)).getUTCDay();
  return `${(opts.weekday === "long" ? WEEKDAYS_LONG : WEEKDAYS_SHORT)[dow]}, ${day}`;
}

/** "2:30 PM", in the firm's zone, with a plain space. A civil date has no time, so it gives null. */
export function formatTime(input: DateInput | null | undefined, opts: { tz: string }): string | null {
  if (parseCivil(input)) return null;
  const date = toDate(input);
  const f = timeFormat(opts.tz);
  if (!date || !f) return null;
  const parts = f.formatToParts(date);
  const h = Number(parts.find((p) => p.type === "hour")?.value);
  const mm = parts.find((p) => p.type === "minute")?.value;
  if (!Number.isFinite(h) || !mm) return null;
  const h24 = h % 24;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${mm} ${h24 < 12 ? "AM" : "PM"}`;
}

/** "Nov 16, 2:30 PM" (the year follows the day rule). A civil date gives just the day. */
export function formatDayTime(input: DateInput | null | undefined, opts: { tz: string; now?: Date }): string | null {
  const day = formatDay(input, opts);
  if (!day) return null;
  const time = formatTime(input, opts);
  return time ? `${day}, ${time}` : day;
}

/** Relative words only under a week ("just now", "5 min ago", "3 h ago", "2 days ago"); past that, or in the future, the day. */
export function formatRelative(input: DateInput | null | undefined, opts: { tz: string; now?: Date }): string | null {
  const date = toDate(input);
  if (!date || parseCivil(input)) return formatDay(input, opts);
  const now = opts.now ?? new Date();
  const s = Math.round((now.getTime() - date.getTime()) / 1000);
  if (s < 0) return formatDay(input, opts);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) {
    const days = Math.floor(s / 86400);
    return `${days} ${days === 1 ? "day" : "days"} ago`;
  }
  return formatDay(input, opts);
}

const LONG_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

/** "September 2026" for a civil day ("YYYY-MM-DD"); null for anything else. */
export function formatMonthYear(civil: string): string | null {
  const c = parseCivil(civil);
  return c ? `${LONG_MONTHS[c.m - 1]} ${c.y}` : null;
}

/** "Sep 20" for a civil day, never with a year; null for anything else. */
export function formatMonthDay(civil: string): string | null {
  const c = parseCivil(civil);
  return c ? `${MONTHS[c.m - 1]} ${c.d}` : null;
}
