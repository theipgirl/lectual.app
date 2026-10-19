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
};

// PLACEHOLDERS: the 3 / 10 day numbers below are RPB's ops spec from the Fri 10/16
// call (SOP: day 10 unbooked -> Long-Term Nurture), but the real cutoffs depend on
// the spacing of Amor's email sequence. Caitlyn is following up on that; change
// these two constants when she does and nothing else needs to move.
/** A touch this recent, on a lead that has ever written to us, keeps it hot. */
export const HOT_AFTER_EXCHANGE_DAYS = 3;
/** No touch for this long and the lead goes cold (SOP: day 10 -> Long-Term Nurture). */
export const COLD_NO_TOUCH_DAYS = 10;

function daysAgo(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / 86_400_000;
}

function describeDays(days: number): string {
  const rounded = Math.floor(days);
  if (rounded <= 0) return "today";
  if (rounded === 1) return "1 day ago";
  return `${rounded} days ago`;
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
 *   3. never touched                              -> cold
 *   4. last touch within HOT_AFTER_EXCHANGE_DAYS and the lead has written to us
 *      at some point                              -> hot
 *   5. no touch in COLD_NO_TOUCH_DAYS or more     -> cold
 *   6. otherwise                                  -> warm
 */
export function deriveTemperature(
  lead: Pick<
    Lead,
    "temperature" | "current_stage_id" | "last_activity_at" | "last_outbound_at" | "last_inbound_at"
  >,
  stages: Stage[],
  now: Date,
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
