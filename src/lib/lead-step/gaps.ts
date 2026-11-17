import type { ActivityRow } from "@/lib/stage-keeper/moves";
import type { LeadStepFacts } from "./facts";
import { addCivilDays, firmDate } from "./schedule";

/**
 * The drafts the page would show that NO assistant produces today. Where the lead is at such a step, the card says so
 * by name ("Lectual hasn't prepared this yet") instead of inventing a draft or promising one. Each gap names the
 * sprint that fills it, for the record (never drawn).
 *
 *   payment-nudge  accepted, not marked paid: a reminder with the pay link            -> Sprint 5 (signed-and-paid chain;
 *                                                                                         Sprint 4's routine reminder kind)
 *   follow-up      the link is live and not accepted: the Day 1/2/4/6/7 follow-ups      -> Sprint 7
 *   outcome-read   a consult was recorded, no outcome logged and no proposal: reading   -> Sprint 9 Part 2
 *                  the recording to propose the outcome
 *   first-reply    a new enquiry nobody has written to yet: the first reply             -> no sprint builds it yet
 *                                                                                         (Sprint 9 Part 2 to decide)
 *
 * Order is the furthest step first. Pure.
 */
export type GapId = "payment-nudge" | "follow-up" | "outcome-read" | "first-reply";

export const GAP_FILLED_BY: Readonly<Record<GapId, string>> = {
  "payment-nudge": "Sprint 5",
  "follow-up": "Sprint 7",
  "outcome-read": "Sprint 9 Part 2",
  "first-reply": "Sprint 9 Part 2 (no sprint builds it yet)",
};

export type Gap =
  | { id: "payment-nudge"; acceptedAt: string | null }
  | { id: "follow-up"; day: number; expiresOn: string | null }
  | { id: "outcome-read"; meetingStartedAt: string | null }
  | { id: "first-reply" };

/** `unknown`: a read this rule needs failed, so the page must not say either "a gap" or "nothing". */
export type GapResult = { status: "gap"; gap: Gap } | { status: "none" } | { status: "unknown" };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** A consult outcome a person logged (`logConsultOutcome` writes a `call_logged` row with `consult_outcome`). */
export function outcomeLogged(rows: readonly ActivityRow[]): boolean {
  return rows.some((r) => r.type === "call_logged" && typeof obj(r.payload).consult_outcome === "string");
}

/** Calendar days since the link went live, on the firm's calendar: Day 0 is the day it went live. */
export function proposalDay(sentAt: string, now: Date, timeZone: string): number {
  const sent = firmDate(sentAt, timeZone);
  const today = firmDate(now.getTime(), timeZone);
  let day = 0;
  while (day < 400 && addCivilDays(sent, day) < today) day += 1;
  return day;
}

export function gapFor(facts: Pick<LeadStepFacts, "now" | "timeZone" | "lead" | "proposal" | "meetings" | "consult" | "activity">): GapResult {
  const now = new Date(facts.now);
  const { proposal, meetings, consult, activity, lead } = facts;
  if (proposal.status === "unavailable") return { status: "unknown" };
  const p = proposal.status === "ok" ? proposal.value : null;

  if (p && p.status === "accepted") {
    if (p.paid.status === "unavailable") return { status: "unknown" };
    if (p.paid.status === "ok" && !p.paid.paid) return { status: "gap", gap: { id: "payment-nudge", acceptedAt: p.acceptedAt } };
    return { status: "none" };
  }
  if (p && p.status === "sent") {
    return { status: "gap", gap: { id: "follow-up", day: p.sentAt ? proposalDay(p.sentAt, now, facts.timeZone) : 0, expiresOn: p.expiresOn } };
  }
  if (p) return { status: "none" };

  if (meetings.status === "unavailable" || activity.status === "unavailable") return { status: "unknown" };
  const held = meetings.status === "ok" ? meetings.value.filter((m) => m.startedAt && Date.parse(m.startedAt) <= now.getTime()) : [];
  const logged = activity.status === "ok" && outcomeLogged(activity.value);
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
