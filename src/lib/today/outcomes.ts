/**
 * The small outcome figures on Today: matters opened this month, deadlines
 * met this month, and the labelled Hours saved (est.). "This month" is the
 * firm's calendar month in its own time zone. Pure; `now` is injected.
 */

/** YYYY-MM-DD of `at` on the firm's clock. */
export function civilInZone(at: Date, tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
    return parts; // en-CA formats as YYYY-MM-DD
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** First day of the firm's current month, as a civil date. */
export function monthStartCivil(now: Date, tz: string): string {
  return `${civilInZone(now, tz).slice(0, 7)}-01`;
}

/** An instant safely before the firm's month start in any zone, for a coarse DB filter refined in memory. */
export function monthQueryFloor(now: Date, tz: string): string {
  return new Date(Date.parse(`${monthStartCivil(now, tz)}T00:00:00Z`) - 86_400_000).toISOString();
}

export function mattersOpenedThisMonth(matters: ReadonlyArray<{ opened_at: string | null; created_at: string }>, now: Date, tz: string): number {
  const start = monthStartCivil(now, tz);
  return matters.filter((m) => civilInZone(new Date(m.opened_at ?? m.created_at), tz) >= start).length;
}

/**
 * Deadlines closed as satisfied this month, and how many of those were
 * satisfied on or before their due date (on the firm's clock). A deadline
 * waived or superseded is not "met" and is not counted either way.
 */
export function deadlinesMetThisMonth(
  rows: ReadonlyArray<{ due_date: string; satisfied_at: string | null; status: string }>,
  now: Date,
  tz: string,
): { met: number; closed: number } {
  const start = monthStartCivil(now, tz);
  let met = 0;
  let closed = 0;
  for (const r of rows) {
    if (r.status !== "satisfied" || !r.satisfied_at) continue;
    const on = civilInZone(new Date(r.satisfied_at), tz);
    if (on < start) continue;
    closed += 1;
    if (on <= r.due_date) met += 1;
  }
  return { met, closed };
}
