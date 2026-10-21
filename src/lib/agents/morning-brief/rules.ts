import { DAY_MS } from "../shared";

/**
 * The morning brief's pure rules: who is waiting on a reply, who is stalled, and what to say about it.
 * No database, no clock of its own: `nowMs` is passed in.
 */

/** No real contact in this many days makes an open lead stalled. */
export const NO_CONTACT_DAYS = 7;
/** A follow-up is never drafted twice for one lead inside this many days. */
export const FOLLOW_UP_COOLDOWN_DAYS = 7;
/** At most this many follow-up emails are drafted per run. */
export const FOLLOW_UP_CAP = 5;

export type BriefStage = { id: string; name: string; category: string; aging_threshold_days: number | null };

export type BriefLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  practice_area?: string | null;
  mark_text?: string | null;
  current_stage_id: string;
  stage_entered_at: string | null;
  last_activity_at: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  created_at: string | null;
};

const time = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
};

const daysBetween = (fromMs: number, nowMs: number): number => Math.max(0, Math.floor((nowMs - fromMs) / DAY_MS));

/** Leads in an `open` stage only: won, lost and nurture leads are never waiting or stalled. */
export function openLeads(leads: readonly BriefLead[], stages: ReadonlyMap<string, BriefStage>): BriefLead[] {
  return leads.filter((l) => stages.get(l.current_stage_id)?.category === "open");
}

export type WaitingLead = { lead: BriefLead; days: number };

/** Their last inbound mail is newer than our last outbound (or we have never answered). Oldest wait first. */
export function waitingOnReply(leads: readonly BriefLead[], nowMs: number): WaitingLead[] {
  const out: WaitingLead[] = [];
  for (const lead of leads) {
    const inbound = time(lead.last_inbound_at);
    if (inbound === null) continue;
    const outbound = time(lead.last_outbound_at);
    if (outbound !== null && outbound >= inbound) continue;
    out.push({ lead, days: daysBetween(inbound, nowMs) });
  }
  return out.sort((a, b) => b.days - a.days || a.lead.id.localeCompare(b.lead.id));
}

export type StalledLead = {
  lead: BriefLead;
  stage: BriefStage;
  /** Days since the last real contact (the lead's last touch). */
  idleDays: number;
  /** Days in the current stage. */
  stageDays: number;
  /** Past the stage's aging threshold. */
  overThreshold: boolean;
  /** The ranking: the larger of idle days and days past the threshold. */
  stalledDays: number;
  reason: string;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Past the stage's aging threshold, or no real contact in NO_CONTACT_DAYS. Most stalled first, ties by lead id. */
export function stalledLeads(leads: readonly BriefLead[], stages: ReadonlyMap<string, BriefStage>, nowMs: number): StalledLead[] {
  const out: StalledLead[] = [];
  for (const lead of leads) {
    const stage = stages.get(lead.current_stage_id);
    if (!stage || stage.category !== "open") continue;
    const touch = time(lead.last_activity_at) ?? time(lead.stage_entered_at) ?? time(lead.created_at);
    const entered = time(lead.stage_entered_at) ?? touch;
    if (touch === null || entered === null) continue;
    const idleDays = daysBetween(touch, nowMs);
    const stageDays = daysBetween(entered, nowMs);
    const threshold = stage.aging_threshold_days;
    const overThreshold = threshold !== null && threshold >= 0 && stageDays > threshold;
    const idle = idleDays >= NO_CONTACT_DAYS;
    if (!overThreshold && !idle) continue;
    const parts: string[] = [];
    if (overThreshold) parts.push(`${plural(stageDays, "day", "days")} in ${stage.name} (limit ${threshold})`);
    if (idle) parts.push(`no contact in ${plural(idleDays, "day", "days")}`);
    out.push({
      lead,
      stage,
      idleDays,
      stageDays,
      overThreshold,
      stalledDays: Math.max(idleDays, overThreshold ? stageDays - (threshold as number) : 0),
      reason: parts.join(", "),
    });
  }
  return out.sort((a, b) => b.stalledDays - a.stalledDays || a.lead.id.localeCompare(b.lead.id));
}
