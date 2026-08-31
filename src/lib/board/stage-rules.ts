/**
 * Pure docket-stage rules — no database, no `server-only`, safe to import from
 * a `"use client"` component.
 *
 * Ported from lectual/src/lib/matters/stage-rules.ts. It lives apart from any
 * read layer for the same mechanical reason it does there: a board renders a
 * stale badge and a day count in the browser, so the rules that decide them
 * have to be reachable from the browser.
 */

export type MatterWaitingOn = "firm" | "client" | "uspto" | "court";

/**
 * Days a matter has sat in its current stage, or null when it isn't on the
 * docket (or carries an unparseable timestamp). Floored, so "0" means today.
 */
export function daysInStage(
  stageEnteredAt: string | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!stageEnteredAt) return null;
  const enteredMs = new Date(stageEnteredAt).getTime();
  if (Number.isNaN(enteredMs)) return null;
  return Math.floor((now.getTime() - enteredMs) / 86_400_000);
}

/**
 * Stall thresholds, in days, by who is holding the matter. One number per
 * waiting_on value — deliberately not a per-stage column:
 *
 *   firm   — the ball is with the firm. Quiet is bad, fast.
 *   client — waiting on specimens/consent/payment. Longer fuse, still nags.
 *   uspto  — waiting on the office. Months of silence is normal.
 *   court  — waiting on a judge. Between the two: longer than the firm's own
 *            fuse because a set hearing is genuinely quiet until the date, far
 *            shorter than the USPTO's because a county civil docket silent for
 *            four months is a case going wrong, not a case proceeding.
 *
 * `court` is deliberately NOT the value for "a motion is pending and nobody
 * has set it for hearing" — that is the firm's move (call the JA), it is the
 * most common stall in a debt-defense practice, and giving it the longer fuse
 * would render exactly the wrong matters healthy. Those stages carry `firm`.
 */
export const STALE_THRESHOLD_DAYS: Record<MatterWaitingOn, number> = {
  firm: 30,
  client: 30,
  uspto: 120,
  court: 60,
};

/**
 * Is this matter overdue a nudge? True once it has sat in its stage strictly
 * LONGER than its stage's threshold, so a matter at exactly 30 (or exactly
 * 120) days is not yet stale and tips over on the following day.
 *
 * Fails toward nagging, never toward silence: an unstaged matter (no
 * stage_entered_at) has no clock and is not stale, but a staged matter whose
 * stage has no waiting_on falls back to 'firm' — the shortest threshold —
 * matching the column's own database default.
 */
export function matterIsStale(
  input: { stage_entered_at: string | null | undefined; waiting_on: MatterWaitingOn | null | undefined },
  now: Date = new Date(),
): boolean {
  const days = daysInStage(input.stage_entered_at, now);
  if (days === null) return false;
  return days > STALE_THRESHOLD_DAYS[input.waiting_on ?? "firm"];
}
