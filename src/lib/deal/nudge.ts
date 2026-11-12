import { DEFAULT_DEAL_TIMES, dealFor } from "@/lib/deal/times";

/**
 * The deal-ready nudge. Pure: the clock, the firm's zone, the person's two deal times and one read of their deck come in.
 *
 * Rule: the person's CURRENT deal (the latest of today's two times at or before `now`) must exist, and the person must
 * have at least one undecided card in their deck right now. The deck (`buildDeck`) holds only the viewer's own cards that
 * are in the current deal: not yet decided, not put off with Later, not a later arrival, and not handed away. So the
 * count is exactly the cards the deck would show. Before today's first deal there is no current deal, so there is no
 * nudge, even if cards were carried over from yesterday: the next deal has not opened. A read that failed, or a queue
 * that isn't connected, gives no nudge, never a 0 and never a guess.
 */
export type NudgeRead = { status: "ok"; undecided: number } | { status: "unconfigured" } | { status: "unavailable" };
export type DealNudge = { ready: true; label: string; count: number } | { ready: false };

export const NO_NUDGE: DealNudge = { ready: false };

export function dealNudge(input: { now: Date; timeZone: string; times?: readonly string[]; read: NudgeRead }): DealNudge {
  const { read } = input;
  if (read.status !== "ok") return NO_NUDGE;
  if (!Number.isFinite(read.undecided) || read.undecided < 1) return NO_NUDGE;
  const deal = dealFor(input.now, input.timeZone, input.times ?? DEFAULT_DEAL_TIMES);
  if (!deal.current) return NO_NUDGE;
  return { ready: true, label: deal.current.label, count: Math.floor(read.undecided) };
}
