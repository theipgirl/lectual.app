/**
 * Pure docket-stage rules — no database, no server-only imports, safe to import
 * from a `"use client"` component.
 *
 * These live apart from stages.ts for one mechanical reason: that module imports
 * the scoped Supabase client, so anything importing it is server-only. The board
 * needs to render a stale badge and a day count in the browser, so the rules that
 * decide them have to be reachable from there. stages.ts re-exports everything
 * below, so server code can keep importing from one place.
 */

export type MatterWaitingOn = "firm" | "client" | "uspto" | "court";

/**
 * Days a matter has sat in its current stage, or null when it isn't on the
 * docket (or carries an unparseable timestamp). Floored, so "0" means today.
 */
export function daysInStage(stageEnteredAt: string | null, now: Date = new Date()): number | null {
  if (!stageEnteredAt) return null;
  const enteredMs = new Date(stageEnteredAt).getTime();
  if (Number.isNaN(enteredMs)) return null;
  return Math.floor((now.getTime() - enteredMs) / 86_400_000);
}

/**
 * Stall thresholds, in days, by who is holding the matter. One number per
 * waiting_on value — deliberately NOT a per-stage column (0042's own note):
 *
 *   firm   — the ball is with the firm. Quiet is bad, fast.
 *   client — waiting on specimens/consent/payment. Longer fuse, still nags.
 *   uspto  — waiting on the office. Months of silence is normal.
 *   court  — waiting on a judge (0054). Between the two: longer than the firm's
 *            own fuse because a set hearing is genuinely quiet until the date,
 *            far shorter than the USPTO's because a county civil docket that
 *            has gone silent for four months is a case going wrong, not a case
 *            proceeding normally.
 *
 * `court` is deliberately NOT the value for "a motion is pending and nobody has
 * set it for hearing" — that is the firm's move (call the JA), it is the most
 * common stall in a debt-defense practice, and giving it the longer fuse would
 * render exactly the wrong matters healthy. Those stages carry `firm`.
 *
 * 60 is a starting figure, not a rule of procedure: the attorney's own tracker
 * flags a motion pending three months with no setting as urgent, so the nudge
 * needs to arrive well before that.
 */
export const STALE_THRESHOLD_DAYS: Record<MatterWaitingOn, number> = {
  firm: 30,
  client: 30,
  uspto: 120,
  court: 60,
};

/**
 * Is this matter overdue a nudge? True once it has sat in its stage strictly
 * LONGER than its stage's threshold, so a matter at exactly 30 (or exactly 120)
 * days is not yet stale and tips over on the following day.
 *
 * Fails toward nagging, never toward silence: an unstaged matter (no
 * stage_entered_at) has no clock and is not stale, but a staged matter whose
 * stage has no waiting_on falls back to 'firm' — the shortest threshold —
 * matching the column's own DB default. A stall rule that fails to "everything
 * is fine" is the same class of defect as the approval queue rendering "All
 * caught up" when it cannot reach the queue (AGENTS.md).
 */
export function matterIsStale(
  input: { stage_entered_at: string | null; waiting_on: MatterWaitingOn | null },
  now: Date = new Date(),
): boolean {
  const days = daysInStage(input.stage_entered_at, now);
  if (days === null) return false;
  return days > STALE_THRESHOLD_DAYS[input.waiting_on ?? "firm"];
}
