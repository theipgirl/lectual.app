import type { Lead, Stage } from "@/lib/pipeline";
import { NOT_RATED } from "@/lib/ui/words";
import { LANE_LABEL, isLane, laneReason } from "@/lib/leads/lane";
import {
  NEVER_TOUCHED_REASON,
  deriveTemperature,
  lastTouchAt,
  type Temperature,
  type TemperatureFacts,
} from "./temperature";

/**
 * The ONE temperature a lead shows (Sprint 7): the table chip, the board card,
 * the filter, the sort, the counts and the lead page all read this.
 *
 * Pure, like temperature.ts: no client, no server-only imports, `now` injected.
 * Two sources, never blended into one field:
 *
 *   person     crm_lead.lane, the lane a PERSON set (a trigger refuses a write
 *              without a session, so triage can't set it)
 *   suggested  deriveTemperature(): the activity rules, with the triage agent's
 *              reason from ai_summary appended when it left one
 *
 * crm_lead.temperature (the old hand-set override, also written by importers) is
 * deliberately IGNORED: nothing can clear it any more, so honouring a leftover
 * value would pin a lead hot forever. The column is left in the database.
 */
export type EffectiveTemperature = {
  /** null = "Not rated": no person's lane and nothing recorded to derive from. */
  value: Temperature | null;
  source: "person" | "suggested";
  reason: string;
  /**
   * Set only when a person's lane is older than the lead's newest touch AND the
   * activity rules now say something different ("Activity: hot · Replied 2 days
   * ago — waiting on us"). The lane still wins; this just says what changed.
   */
  activityHint?: string;
  /** The Long-Term Nurture suggestion, passed through from the derivation unchanged. */
  suggestion?: "long_term_nurture";
};

export type EffectiveTemperatureLead = Pick<
  Lead,
  "current_stage_id" | "last_activity_at" | "last_outbound_at" | "last_inbound_at" | "ai_summary"
> &
  Partial<Pick<Lead, "temperature" | "lane" | "lane_set_at">>;

/**
 * Setting a lane writes its own timeline row, and every timeline row stamps a
 * touch a moment after `lane_set_at`. That touch is the lane change itself, not
 * new activity, so a touch has to be later than the lane by more than this to
 * count as newer.
 */
const OWN_TOUCH_GRACE_MS = 60_000;

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function effectiveTemperature(
  lead: EffectiveTemperatureLead,
  stages: Stage[],
  now: Date,
  facts?: TemperatureFacts,
): EffectiveTemperature {
  const derived = deriveTemperature({ ...lead, temperature: null }, stages, now, facts);
  const suggestion = derived.suggestion ? { suggestion: derived.suggestion } : {};

  const lane = isLane(lead.lane) ? lead.lane : null;
  if (lane) {
    const touchedAt = time(lastTouchAt(lead));
    const setAt = time(lead.lane_set_at);
    // A lane with no set time can't be shown to be newer than the touch, so the
    // touch counts as newer: better a hint that turns out redundant than a
    // lane that quietly hides a reply.
    const touchedSince = touchedAt != null && (setAt == null || touchedAt > setAt + OWN_TOUCH_GRACE_MS);
    const neverTouched = derived.reason === NEVER_TOUCHED_REASON;
    const differs = derived.level !== lane;
    return {
      value: lane,
      source: "person",
      reason: "Set by a person",
      ...(touchedSince && differs && !neverTouched
        ? { activityHint: `Activity: ${derived.level} · ${derived.reason}` }
        : {}),
      ...suggestion,
    };
  }

  const triage = laneReason(lead.ai_summary);
  const reason = triage ? `${derived.reason} · Triage: ${triage}` : derived.reason;
  // No touch, no recorded fact, no nurture stage: the derivation's last-resort
  // "cold" says nothing about the lead, so it is shown as Not rated instead.
  const nothingKnown = lastTouchAt(lead) == null && derived.reason === NEVER_TOUCHED_REASON;
  return {
    value: nothingKnown ? null : derived.level,
    source: "suggested",
    reason,
    ...suggestion,
  };
}

/** The chip text: "Hot" for a person's, "Suggested: Hot" for a derived one, "Not rated" for neither. */
export function temperatureLabel(temperature: Pick<EffectiveTemperature, "value" | "source">): string {
  if (temperature.value === null) return NOT_RATED;
  const level = LANE_LABEL[temperature.value];
  return temperature.source === "person" ? level : `Suggested: ${level}`;
}

/** The tooltip: why the chip says what it says, plus what the activity says now when a lane disagrees. */
export function temperatureTitle(temperature: Pick<EffectiveTemperature, "reason" | "activityHint">): string {
  return temperature.activityHint ? `${temperature.reason}\n${temperature.activityHint}` : temperature.reason;
}
