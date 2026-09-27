/**
 * Month and week grids for the Calendar page. Pure: dates in, days out, so
 * the arithmetic is tested without a database (tests/calendar/grid.test.ts).
 *
 * Everything works on CIVIL dates ("YYYY-MM-DD") so a deadline due on the 9th
 * lands on the 9th whatever the server's clock zone is. Timed events are
 * turned into civil date + time in the FIRM's time zone (crm_org_profile)
 * before they get here.
 */

export type CalendarView = "month" | "week" | "agenda";

export type CalendarItem = {
  key: string;
  /** Civil date the item belongs to. */
  date: string;
  /** "09:30" in the firm's zone for timed events; null for all-day items. */
  time: string | null;
  title: string;
  detail: string | null;
  href: string | null;
  kind: "deadline" | "task" | "event";
  overdue: boolean;
  unconfirmed: boolean;
};

export type GridDay = {
  date: string;
  /** Day of the month, for the cell label. */
  day: number;
  inMonth: boolean;
  isToday: boolean;
  items: CalendarItem[];
};

const DAY_MS = 86_400_000;

export function parseCivil(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function toCivil(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return toCivil(new Date(parseCivil(date).getTime() + n * DAY_MS));
}

export function addMonths(date: string, n: number): string {
  const d = parseCivil(date);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  return toCivil(target);
}

/** Sunday on or before `date` (US week, as the firm's own calendars show it). */
export function startOfWeek(date: string): string {
  return addDays(date, -parseCivil(date).getUTCDay());
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function isCivilDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return toCivil(parseCivil(value)) === value;
}

export function parseCalendarView(value: unknown): CalendarView {
  return value === "week" || value === "agenda" ? value : "month";
}

/** Timed items first by time, then all-day items by kind (deadlines lead), then title. */
function sortItems(items: CalendarItem[]): CalendarItem[] {
  const kindRank = { deadline: 0, event: 1, task: 2 } as const;
  return items.slice().sort((a, b) => {
    if (a.time && b.time) return a.time.localeCompare(b.time);
    if (a.time !== b.time) return a.time ? -1 : 1;
    return kindRank[a.kind] - kindRank[b.kind] || a.title.localeCompare(b.title);
  });
}

function bucket(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const byDate = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const list = byDate.get(item.date) ?? [];
    list.push(item);
    byDate.set(item.date, list);
  }
  return byDate;
}

function days(start: string, count: number, month: string | null, today: string, items: CalendarItem[]): GridDay[] {
  const byDate = bucket(items);
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(start, i);
    return {
      date,
      day: Number(date.slice(8)),
      inMonth: month === null || date.slice(0, 7) === month,
      isToday: date === today,
      items: sortItems(byDate.get(date) ?? []),
    };
  });
}

/** Whole weeks covering the anchor's month: 4 to 6 rows of 7 days, Sunday first. */
export function monthGrid(anchor: string, today: string, items: CalendarItem[]): GridDay[][] {
  const first = startOfMonth(anchor);
  const gridStart = startOfWeek(first);
  const nextMonth = addMonths(first, 1);
  const weeks = Math.ceil((parseCivil(nextMonth).getTime() - parseCivil(gridStart).getTime()) / (7 * DAY_MS));
  const flat = days(gridStart, weeks * 7, anchor.slice(0, 7), today, items);
  return Array.from({ length: weeks }, (_, w) => flat.slice(w * 7, w * 7 + 7));
}

/** The seven days of the anchor's week, Sunday first. */
export function weekGrid(anchor: string, today: string, items: CalendarItem[]): GridDay[] {
  return days(startOfWeek(anchor), 7, null, today, items);
}

/** First and last civil date a view shows, for querying. */
export function viewRange(view: CalendarView, anchor: string): { from: string; to: string } {
  if (view === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  const from = startOfWeek(startOfMonth(anchor));
  const lastOfMonth = addDays(addMonths(startOfMonth(anchor), 1), -1);
  return { from, to: addDays(startOfWeek(lastOfMonth), 6) };
}

/** Previous / next anchors for the view's arrows. */
export function stepAnchor(view: CalendarView, anchor: string, dir: -1 | 1): string {
  return view === "week" ? addDays(startOfWeek(anchor), 7 * dir) : addMonths(startOfMonth(anchor), dir);
}

/** "September 2026" or "Sep 20 – 26, 2026". */
export function viewTitle(view: CalendarView, anchor: string): string {
  if (view === "week") {
    const from = parseCivil(startOfWeek(anchor));
    const to = parseCivil(addDays(startOfWeek(anchor), 6));
    const md = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const sameMonth = from.getUTCMonth() === to.getUTCMonth();
    return `${md(from)} – ${sameMonth ? to.getUTCDate() : md(to)}, ${to.getUTCFullYear()}`;
  }
  return parseCivil(startOfMonth(anchor)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Civil date and "HH:MM" of an instant in `timeZone`. */
export function zonedParts(iso: string, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** "9:30a" style label for a "HH:MM" time. */
export function shortTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "a" : "p";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${hour}${suffix}` : `${hour}:${String(m).padStart(2, "0")}${suffix}`;
}
