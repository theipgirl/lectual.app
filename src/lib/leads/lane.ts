/**
 * A lead's routing lane (intake SOP, 9 Sep, Stage 2) — pure.
 *
 *   Hot   has a mark in use or filed, revenue, named urgency → a paid strategy
 *         session with the attorney (the firm's booking link)
 *   Warm  building something, no filing yet → a discovery call
 *   Cold  exploring, pre-revenue → the firm's nurture campaign, no call link
 *
 * "Routing is a SUGGESTION, not a status. It shows as 'suggested lane' with the
 * reason, and Taylor can override." Two sources, never merged into one field:
 *
 *   crm_lead.lane        the lane a PERSON set (lectual 0085; a trigger refuses
 *                        a write without a session, so triage can't set it)
 *   crm_lead.ai_summary  the triage agent's suggestion, "HOT — reason"
 *
 * The person's lane always wins. A suggestion is always shown as one
 * ("Suggested: Hot — reason"), including when a person has set a different
 * lane, so the disagreement is visible rather than overwritten.
 *
 * NOT crm_lead.temperature: that is the intake board's activity-derived
 * temperature with its own override, and the sheet importer and (formerly) the
 * triage agent wrote it too — so it can't say who routed the lead.
 */
export type Lane = "hot" | "warm" | "cold";
export const LANES: readonly Lane[] = ["hot", "warm", "cold"];

export function isLane(value: unknown): value is Lane {
  return value === "hot" || value === "warm" || value === "cold";
}

export const LANE_LABEL: Record<Lane, string> = { hot: "Hot", warm: "Warm", cold: "Cold" };

type LaneSource = { lane?: string | null; lane_set_by?: string | null; lane_set_at?: string | null; ai_summary: string | null };

/** The triage agent's suggestion, read off ai_summary ("HOT — reason"). */
export function suggestedLane(aiSummary: string | null): Lane | null {
  const m = aiSummary?.match(/^(HOT|WARM|COLD)\b/);
  return m ? (m[1].toLowerCase() as Lane) : null;
}

/** The triage reason without its "HOT — " prefix. */
export function laneReason(aiSummary: string | null): string | null {
  if (!suggestedLane(aiSummary)) return null;
  return aiSummary?.replace(/^(HOT|WARM|COLD)\s*[—-]\s*/, "").trim() || null;
}

export type LaneView = {
  /** The lane a person set, or null. */
  lane: Lane | null;
  setBy: string | null;
  setAt: string | null;
  /** The triage agent's suggestion and its reason, or null. */
  suggested: Lane | null;
  reason: string | null;
  /** What routing goes by: the person's lane, else the suggestion. */
  effective: Lane | null;
  source: "person" | "suggestion" | null;
};

export function laneView(lead: LaneSource): LaneView {
  const lane = isLane(lead.lane) ? lead.lane : null;
  const suggested = suggestedLane(lead.ai_summary);
  return {
    lane,
    setBy: lane ? (lead.lane_set_by ?? null) : null,
    setAt: lane ? (lead.lane_set_at ?? null) : null,
    suggested,
    reason: laneReason(lead.ai_summary),
    effective: lane ?? suggested,
    source: lane ? "person" : suggested ? "suggestion" : null,
  };
}

/** The lane routing goes by: a person's, otherwise the triage suggestion. */
export function laneOf(lead: LaneSource): Lane | null {
  return laneView(lead).effective;
}

/** "Suggested: Hot — reason". Always says "Suggested". */
export function suggestionLine(view: Pick<LaneView, "suggested" | "reason">): string | null {
  if (!view.suggested) return null;
  return `Suggested: ${LANE_LABEL[view.suggested]}${view.reason ? ` — ${view.reason}` : ""}`;
}

/* ─────────────────────────── the next step ─────────────────────────────── */

/** The firm's settings each lane's next step points at (crm_org_profile, 0085). */
export type LaneLinks = {
  strategySessionUrl: string | null;
  discoveryCallUrl: string | null;
  nurtureSequenceId: string | null;
};

export const NO_LANE_LINKS: LaneLinks = { strategySessionUrl: null, discoveryCallUrl: null, nurtureSequenceId: null };

export type NextStep =
  | { kind: "strategy_session"; label: string; url: string | null; missing: string | null }
  | { kind: "discovery_call"; label: string; url: string | null; missing: string | null }
  | { kind: "nurture"; label: string; sequenceId: string | null; missing: string | null };

/**
 * What the lane says to do next. A link or a button for STAFF — nothing is
 * sent: the booking link is opened or copied by a person, and "Add to nurture"
 * only enrolls (every campaign email still drafts into the approval queue).
 * `missing` names the firm setting that isn't filled in yet.
 */
export function nextStepForLane(lane: Lane | null, links: LaneLinks): NextStep | null {
  switch (lane) {
    case "hot":
      return {
        kind: "strategy_session",
        label: "Book a strategy session",
        url: links.strategySessionUrl,
        missing: links.strategySessionUrl ? null : "No strategy-session booking link is set (Settings → Firm profile).",
      };
    case "warm":
      return {
        kind: "discovery_call",
        label: "Discovery call",
        url: links.discoveryCallUrl,
        missing: links.discoveryCallUrl ? null : "No discovery-call booking link is set (Settings → Firm profile).",
      };
    case "cold":
      return {
        kind: "nurture",
        label: "Add to nurture",
        sequenceId: links.nurtureSequenceId,
        missing: links.nurtureSequenceId ? null : "No nurture campaign is chosen (Settings → Firm profile).",
      };
    default:
      return null;
  }
}

/** Sort rank: hot first. A lane nobody set or suggested sorts last. */
export const LANE_RANK: Record<Lane, number> = { cold: 0, warm: 1, hot: 2 };
