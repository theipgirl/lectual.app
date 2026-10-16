/**
 * The report views' period selector (design/Matters_Prototype.dc.html's
 * `rpRanges`): 7 / 30 / 90 days, default 30, chosen via `?range=`.
 *
 * Pure — no server imports — so the page and its tests can both compute a
 * period's boundaries without a database. `now` is always injected rather
 * than read here, same convention as summarizeDocket and buildPriorities.
 */

export const REPORT_RANGES = [7, 30, 90] as const;
export type ReportRange = (typeof REPORT_RANGES)[number];
export const DEFAULT_REPORT_RANGE: ReportRange = 30;

export function isReportRange(value: unknown): value is ReportRange {
  return (REPORT_RANGES as readonly unknown[]).includes(value);
}

/** Reads `?range=` — anything not exactly 7/30/90 falls back to the default. */
export function parseReportRange(raw: string | string[] | undefined): ReportRange {
  const n = Number(Array.isArray(raw) ? raw[0] : raw);
  return isReportRange(n) ? n : DEFAULT_REPORT_RANGE;
}

export type ReportPeriod = {
  range: ReportRange;
  /** The period being reported: [start, end). `end` is `now`. */
  start: Date;
  end: Date;
  /** The immediately preceding, equal-length period, for the delta. */
  prevStart: Date;
  prevEnd: Date;
};

/** The current period and its equal-length predecessor, anchored on `now`. */
export function reportPeriod(range: ReportRange, now: Date = new Date()): ReportPeriod {
  const end = now;
  const start = new Date(end.getTime() - range * 86_400_000);
  const prevEnd = start;
  const prevStart = new Date(start.getTime() - range * 86_400_000);
  return { range, start, end, prevStart, prevEnd };
}

/** Whether an ISO timestamp falls in `[start, end)`. Null/unparseable is never "in". */
export function isInWindow(iso: string | null | undefined, start: Date, end: Date): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return !Number.isNaN(t) && t >= start.getTime() && t < end.getTime();
}

export function isInPeriod(iso: string | null | undefined, period: ReportPeriod): boolean {
  return isInWindow(iso, period.start, period.end);
}

export function isInPreviousPeriod(iso: string | null | undefined, period: ReportPeriod): boolean {
  return isInWindow(iso, period.prevStart, period.prevEnd);
}
