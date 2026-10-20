import type { Lead, Stage } from "@/lib/pipeline";
import { replyState } from "./reply";

/**
 * Pure temperature derivation (blueprint §4.3). No getScopedClient, no
 * server-only imports — see scope.ts's header for why that matters here.
 * `now` is always injected by the caller; never call Date.now()/`new Date()`
 * in here, so this stays deterministic and testable.
 */

export type Temperature = "hot" | "warm" | "cold";

export type TemperatureResult = {
  level: Temperature;
  reason: string;
  overridden: boolean;
  /**
   * Set only by the "unbooked by day 10" rule. It is a SUGGESTION shown as text
   * and a link: nothing here changes a stage or a lane (lanes are a person's act).
   */
  suggestion?: "long_term_nurture";
};

/**
 * Recorded facts the lead row alone can't tell us, read by
 * src/lib/intake/facts.ts. Every one is optional and absent means "not known":
 * a failed read omits the whole object and the original rules run unchanged.
 */
export type TemperatureFacts = {
  /** When the standard 3-email sequence completed with no inbound since enrolment. */
  sequenceEndedNoReplyAt?: string | null;
  /** The newest sign the lead is booked: a linked meeting, a booked_lss session, or a won stage. */
  bookedAt?: string | null;
  /** Earliest recorded outreach (email sent, call logged, or sequence enrolment). */
  firstTouchAt?: string | null;
};

// PLACEHOLDERS: the 3 / 10 day numbers below are RPB's ops spec from the Fri 10/16
// call (SOP: day 10 unbooked -> Long-Term Nurture), but the real cutoffs depend on
// the spacing of Amor's email sequence. Caitlyn is following up on that; change
// these two constants when she does and nothing else needs to move.
/** A touch this recent, on a lead that has ever written to us, keeps it hot. */
export const HOT_AFTER_EXCHANGE_DAYS = 3;
/** No touch for this long and the lead goes cold (SOP: day 10 -> Long-Term Nurture). */
export const COLD_NO_TOUCH_DAYS = 10;
/** A sequence counts as the firm's "standard" one when it has at least this many email steps (also a placeholder). */
export const STANDARD_SEQUENCE_EMAIL_STEPS = 3;

function daysAgo(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 86_400_000;
}

function describeDays(days: number): string {
  const rounded = Math.floor(days);
  if (rounded <= 0) return "today";
  if (rounded === 1) return "1 day ago";
  return `${rounded} days ago`;
}

/** True when `inbound` is a real time later than `since`. */
function wroteAfter(inbound: string | null, since: string): boolean {
  if (inbound == null) return false;
  return new Date(inbound).getTime() > new Date(since).getTime();
}

/** Pure — greatest of the three touch timestamps a lead carries, or null if never touched. */
export function lastTouchAt(
  lead: Pick<Lead, "last_activity_at" | "last_outbound_at" | "last_inbound_at">,
): string | null {
  const candidates = [lead.last_activity_at, lead.last_outbound_at, lead.last_inbound_at].filter(
    (v): v is string => v != null,
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, current) =>
    new Date(current).getTime() > new Date(latest).getTime() ? current : latest,
  );
}

/**
 * First-match-wins rule table (RPB ops spec, Fri 10/16):
 *   0. `temperature` column set                  -> that value, overridden: true
 *   1. unanswered client reply (last inbound is newer than our last outbound,
 *      or we never wrote)                         -> hot, with NO time cap: it stays
 *      hot until we respond
 *   2. nurture-category stage                     -> cold
 *   2a. (facts) the standard 3-email sequence ended with no reply -> cold
 *   2b. (facts) first touch COLD_NO_TOUCH_DAYS or more ago and not booked -> cold,
 *      with a Long-Term Nurture suggestion (never an automatic move)
 *   3. never touched                              -> cold
 *   4. last touch within HOT_AFTER_EXCHANGE_DAYS and the lead has written to us
 *      at some point                              -> hot
 *   5. no touch in COLD_NO_TOUCH_DAYS or more     -> cold
 *   6. otherwise                                  -> warm
 *
 * `facts` is optional. Without it (or with the fields absent) rules 2a and 2b are
 * skipped and the result is exactly what it was before they existed.
 */
export function deriveTemperature(
  lead: Pick<
    Lead,
    "temperature" | "current_stage_id" | "last_activity_at" | "last_outbound_at" | "last_inbound_at"
  >,
  stages: Stage[],
  now: Date,
  facts?: TemperatureFacts,
): TemperatureResult {
  if (lead.temperature != null) {
    return { level: lead.temperature, reason: "Manually set", overridden: true };
  }

  // Rule 1: they spoke last. Same definition as the Reply column (reply.ts).
  if (lead.last_inbound_at != null && replyState(lead) === "replied") {
    return {
      level: "hot",
      reason: `Replied ${describeDays(daysAgo(lead.last_inbound_at, now))} — waiting on us`,
      overridden: false,
    };
  }

  // Rule 2: a nurture stage is cold regardless of recent activity.
  const stage = stages.find((s) => s.id === lead.current_stage_id) ?? null;
  if (stage?.category === "nurture") {
    return { level: "cold", reason: "Nurture stage", overridden: false };
  }

  // Rule 2a. Ignored when the lead has written since: a stale fact must never turn a
  // lead that replied cold (the loader checks this too; both guard the same hole).
  const sequenceEnded = facts?.sequenceEndedNoReplyAt ?? null;
  if (sequenceEnded != null && !wroteAfter(lead.last_inbound_at, sequenceEnded)) {
    return { level: "cold", reason: "3-email sequence ended, no reply", overridden: false };
  }

  // Rule 2b. The suggestion is the point; where the lead goes is a person's call.
  const firstTouch = facts?.firstTouchAt ?? null;
  if (firstTouch != null && !facts?.bookedAt && daysAgo(firstTouch, now) >= COLD_NO_TOUCH_DAYS) {
    return {
      level: "cold",
      reason: `Unbooked by day ${COLD_NO_TOUCH_DAYS} · Long-Term Nurture suggested`,
      overridden: false,
      suggestion: "long_term_nurture",
    };
  }

  // Rule 3.
  const touch = lastTouchAt(lead);
  if (touch == null) {
    return { level: "cold", reason: "Never touched", overridden: false };
  }
  const daysSinceTouch = daysAgo(touch, now);

  // Rule 4: a live exchange. "Ever written to us" is what separates a
  // conversation from a lead we have only been emailing into silence.
  if (lead.last_inbound_at != null && daysSinceTouch <= HOT_AFTER_EXCHANGE_DAYS) {
    return {
      level: "hot",
      reason: `Active — touched ${describeDays(daysSinceTouch)}`,
      overridden: false,
    };
  }

  // Rule 5.
  if (daysSinceTouch >= COLD_NO_TOUCH_DAYS) {
    return {
      level: "cold",
      reason: `No touch in ${Math.floor(daysSinceTouch)} days`,
      overridden: false,
    };
  }

  // Rule 6.
  return { level: "warm", reason: `Last touch ${describeDays(daysSinceTouch)}`, overridden: false };
}
