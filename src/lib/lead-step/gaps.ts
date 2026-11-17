import type { JobsFacts, LeadStepFacts, Read } from "./facts";
import { addCivilDays, firmDate } from "./schedule";

/**
 * The drafts the page would show that NO assistant produces today. Where the lead is at such a step, the card says so
 * by name ("Lectual hasn't prepared this yet") instead of inventing a draft or promising one. Each gap names the
 * sprint that fills it, for the record (never drawn).
 *
 *   payment-nudge  accepted, not marked paid: a reminder with the pay link            -> Sprint 5 (signed-and-paid chain;
 *                                                                                         Sprint 4's routine reminder kind)
 *   follow-up      the link is live and not accepted: the Day 1/2/4/6/7 follow-ups,    -> Sprint 7
 *                  or, past the last day, what comes next (Long-Term Nurture)
 *   outcome-read   a consult was recorded, no outcome logged and no proposal: reading   -> Sprint 9 Part 2
 *                  the recording to propose the outcome
 *   first-reply    a new enquiry nobody has written to yet: the first reply             -> no sprint builds it yet
 *                                                                                         (Sprint 9 Part 2 to decide)
 *
 * The morning brief's stalled-lead follow-up (up to five leads a run, chosen by its own rules) is not a day-by-day
 * proposal follow-up, so it is not promised; when it is switched on the follow-up gap says it may still draft one.
 *
 * Order is the furthest step first. No database and no server-only import (tests/lead-step/hygiene.test.ts).
 */
export type GapId = "payment-nudge" | "follow-up" | "outcome-read" | "first-reply";

export const GAP_FILLED_BY: Readonly<Record<GapId, string>> = {
  "payment-nudge": "Sprint 5",
  "follow-up": "Sprint 7",
  "outcome-read": "Sprint 9 Part 2",
  "first-reply": "Sprint 9 Part 2 (no sprint builds it yet)",
};

/** The proposal's 7-day follow-up schedule (decision 7: Day 1, 2, 4, 6 and 7). */
export const FOLLOW_UP_LAST_DAY = 7;

export type StalledFollowUp = "on" | "off" | "unknown";

export type Gap =
  | { id: "payment-nudge"; acceptedAt: string | null }
  | { id: "follow-up"; day: number; expiresOn: string | null; windowPassed: boolean; stalledFollowUp: StalledFollowUp }
  | { id: "outcome-read"; meetingStartedAt: string | null }
  | { id: "first-reply" };

/** `unknown`: a read this rule needs failed, so the page must not say either "a gap" or "nothing". */
export type GapResult = { status: "gap"; gap: Gap } | { status: "none" } | { status: "unknown" };

/** Calendar days since the link went live, on the firm's calendar: Day 0 is the day it went live. */
export function proposalDay(sentAt: string, now: Date, timeZone: string): number {
  const sent = firmDate(sentAt, timeZone);
  const today = firmDate(now.getTime(), timeZone);
  let day = 0;
  while (day < 400 && addCivilDays(sent, day) < today) day += 1;
  return day;
}

/** Is the morning brief's stalled-lead follow-up switched on (it may still draft a nudge for this lead)? */
export function stalledFollowUpState(jobs: Read<JobsFacts>): StalledFollowUp {
  if (jobs.status !== "ok") return "unknown";
  const j = jobs.value;
  if (!j.agentsOn || !j.aiOn || j.autopilot === "paused") return "off";
  if (j.autopilot === "unknown" || j.settings === null) return "unknown";
  const s = j.settings["morning-brief"];
  return s && s.enabled && s.autonomy !== "suggest" ? "on" : "off";
}

export function gapFor(facts: Pick<LeadStepFacts, "now" | "timeZone" | "lead" | "proposal" | "meetings" | "consult" | "markers" | "jobs">): GapResult {
  const now = new Date(facts.now);
  const { proposal, meetings, consult, markers, lead } = facts;
  if (proposal.status === "unavailable") return { status: "unknown" };
  const p = proposal.status === "ok" ? proposal.value : null;

  if (p && p.status === "accepted") {
    if (p.paid.status === "unavailable") return { status: "unknown" };
    if (p.paid.status === "ok" && !p.paid.paid) return { status: "gap", gap: { id: "payment-nudge", acceptedAt: p.acceptedAt } };
    return { status: "none" };
  }
  if (p && p.status === "sent") {
    const day = p.sentAt ? proposalDay(p.sentAt, now, facts.timeZone) : 0;
    const expired = p.expiresOn !== null && p.expiresOn < firmDate(now.getTime(), facts.timeZone);
    return {
      status: "gap",
      gap: { id: "follow-up", day, expiresOn: p.expiresOn, windowPassed: expired || day > FOLLOW_UP_LAST_DAY, stalledFollowUp: stalledFollowUpState(facts.jobs) },
    };
  }
  if (p) return { status: "none" };

  if (meetings.status === "unavailable" || markers.status !== "ok") return { status: "unknown" };
  const held = meetings.status === "ok" ? meetings.value.filter((m) => m.startedAt && Date.parse(m.startedAt) <= now.getTime()) : [];
  const logged = markers.value.outcomeLogged;
  if (held.length > 0) {
    if (logged) return { status: "none" };
    const newest = [...held].sort((a, b) => Date.parse(b.startedAt ?? "") - Date.parse(a.startedAt ?? ""))[0];
    return { status: "gap", gap: { id: "outcome-read", meetingStartedAt: newest.startedAt } };
  }

  if (consult.status === "unavailable") return { status: "unknown" };
  const booked = consult.status === "ok" && consult.value !== null;
  if (!booked && !logged && !lead.lastOutboundAt) return { status: "gap", gap: { id: "first-reply" } };
  return { status: "none" };
}
