import type { Lead, Stage } from "@/lib/pipeline";
import { intakeStages } from "./scope";

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

const DEFAULT_AGING_THRESHOLD_DAYS = 7;
const HOT_REPLY_WINDOW_DAYS = 7;
const COLD_NO_TOUCH_DAYS = 30;

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
 * First-match-wins rule table from §4.3:
 *   0. `temperature` column set               → that value, overridden: true
 *   1. inbound reply in the last 7 days        → hot
 *   2. not the first intake stage AND last touch within the stage's aging
 *      threshold (default 7)                   → hot
 *   3. nurture-category stage, OR no touch in 30+ days, OR never touched → cold
 *   4. otherwise                                → warm
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

  const stage = stages.find((s) => s.id === lead.current_stage_id) ?? null;
  const intake = intakeStages(stages);
  const firstIntakeStage =
    intake.length > 0
      ? intake.reduce((first, s) => (s.order_index < first.order_index ? s : first))
      : null;

  // Rule 1: inbound reply in the last HOT_REPLY_WINDOW_DAYS days.
  if (lead.last_inbound_at != null) {
    const days = daysAgo(lead.last_inbound_at, now);
    if (days <= HOT_REPLY_WINDOW_DAYS) {
      return { level: "hot", reason: `Replied ${describeDays(days)}`, overridden: false };
    }
  }

  const touch = lastTouchAt(lead);
  const isFirstIntakeStage = firstIntakeStage != null && stage?.id === firstIntakeStage.id;

  // Rule 2: not the first intake stage AND within the stage's aging window.
  if (stage != null && !isFirstIntakeStage && touch != null) {
    const threshold = stage.aging_threshold_days ?? DEFAULT_AGING_THRESHOLD_DAYS;
    const days = daysAgo(touch, now);
    if (days <= threshold) {
      return { level: "hot", reason: `Active in stage, touched ${describeDays(days)}`, overridden: false };
    }
  }

  // Rule 3: nurture stage, or stale/never touched.
  if (stage?.category === "nurture") {
    return { level: "cold", reason: "Nurture stage", overridden: false };
  }
  if (touch == null) {
    return { level: "cold", reason: "Never touched", overridden: false };
  }
  const daysSinceTouch = daysAgo(touch, now);
  if (daysSinceTouch >= COLD_NO_TOUCH_DAYS) {
    return {
      level: "cold",
      reason: `No touch in ${Math.floor(daysSinceTouch)} days`,
      overridden: false,
    };
  }

  // Rule 4: otherwise.
  return { level: "warm", reason: `Last touch ${describeDays(daysSinceTouch)}`, overridden: false };
}
