import type { AgentId } from "@/lib/agents/types";
import { PREP_SOURCE } from "@/lib/agents/consult-prep/run";
import { CONSULT_PROPOSAL_SOURCE } from "@/lib/consult-proposal/shared";
import type { ActivityRow } from "@/lib/stage-keeper/moves";
import type { BookedConsult, JobsFacts, LeadStepFacts, MeetingFact, Read } from "./facts";
import { firstRunAfterImport, nextRunWindow, prepRunFor, type RunWindow } from "./schedule";

/**
 * "What Lectual will do next, and when": the ONE rule the "Lectual has it" card and the tests share. It promises an
 * action only when a real, switched-on scheduled job will take it:
 *
 *   consult prep      (`src/lib/agents/consult-prep/run.ts`) at the morning run that has the consult inside its next
 *                     24 hours, for a consult on the Outlook calendar linked to this lead with no prep recorded yet.
 *                     Needs the Mailboxes feature. The client prep email only with the Agent toolkit.
 *   post-consult      (`src/lib/agents/post-consult.ts`, `runMeetingProposals`) at the morning run after a recorded call
 *                     linked to this lead is imported: a DRAFT proposal and its email, for a yes. Needs the Proposals
 *                     feature, a named proposal approver, autonomy draft/act and, for a call still to come, an active
 *                     Fathom or Zoom connection.
 *
 * Every job also needs: the Assistants feature, AI configured, Autopilot not paused (unknown counts as paused, the
 * runner's own rule), the assistant's own setting on (no row = off), and a connected approval queue (both drafters
 * write nothing without one). Anything not known is not promised. The Stage Keeper moves stages on its own after the
 * mail sync, but it makes nothing for a yes, so it is never the card's promise.
 */

/** Why a job can't be promised. Each maps to a sentence saying what a person should do instead. */
export type JobOffWhy =
  | "assistants-off"
  | "ai-off"
  | "paused"
  | "assistant-off"
  | "suggest-only"
  | "approvals-off"
  | "mailbox-off"
  | "proposals-off"
  | "no-approvers"
  | "no-recordings";

export type JobGate = { on: true } | { on: false; why: JobOffWhy } | { on: "unknown" };

/** The gate every drafting assistant shares. */
function common(agent: AgentId, jobs: JobsFacts, approvalsOk: boolean, approvalsKnown: boolean): JobGate {
  if (!jobs.agentsOn) return { on: false, why: "assistants-off" };
  if (!jobs.aiOn) return { on: false, why: "ai-off" };
  if (jobs.autopilot === "unknown") return { on: "unknown" };
  if (jobs.autopilot === "paused") return { on: false, why: "paused" };
  const setting = jobs.settings[agent];
  if (!setting || !setting.enabled) return { on: false, why: "assistant-off" };
  if (setting.autonomy === "suggest") return { on: false, why: "suggest-only" };
  if (!approvalsKnown) return { on: "unknown" };
  if (!approvalsOk) return { on: false, why: "approvals-off" };
  return { on: true };
}

export function consultPrepGate(jobs: JobsFacts, approvals: Read<unknown>): JobGate {
  const base = common("consult-prep", jobs, approvals.status === "ok", approvals.status !== "unavailable");
  if (base.on !== true) return base;
  return jobs.modules.mailbox ? { on: true } : { on: false, why: "mailbox-off" };
}

export function postConsultGate(jobs: JobsFacts, approvals: Read<unknown>, opts: { callStillToCome: boolean }): JobGate {
  const base = common("post-consult", jobs, approvals.status === "ok", approvals.status !== "unavailable");
  if (base.on !== true) return base;
  if (!jobs.modules.proposals) return { on: false, why: "proposals-off" };
  if (jobs.proposalApprovers === null) return { on: "unknown" };
  if (!jobs.proposalApprovers) return { on: false, why: "no-approvers" };
  if (opts.callStillToCome) {
    if (jobs.meetingSourceActive === null) return { on: "unknown" };
    if (!jobs.meetingSourceActive) return { on: false, why: "no-recordings" };
  }
  return { on: true };
}

/* ─────────────────────────── what has been done already ─────────────────────────── */

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Consult prep recorded its drafts for this calendar event (its own marker on the timeline). */
export function prepRecorded(rows: readonly ActivityRow[], eventId: string): boolean {
  return rows.some((r) => r.type === "queue_drafted" && obj(r.payload).source === PREP_SOURCE && obj(r.payload).event_id === eventId);
}

/** The consult drafter already handled this recorded call (drafted, or decided not to). The post-consult drafter's own test. */
export function meetingHandled(rows: readonly ActivityRow[], meetingId: string): boolean {
  return rows.some((r) => (r.type === "queue_drafted" || r.type === "ai_insight") && obj(r.payload).source === CONSULT_PROPOSAL_SOURCE && obj(r.payload).meeting_id === meetingId);
}

/** How far back the post-consult drafter looks for recorded calls (its LOOKBACK_DAYS). */
export const POST_CONSULT_LOOKBACK_DAYS = 14;
const DAY_MS = 86_400_000;

/** A recorded call the post-consult drafter will pick up on its next run: linked here, in its window, with material, not handled. */
export function recordingWaiting(meetings: readonly MeetingFact[], rows: readonly ActivityRow[], now: Date): MeetingFact | null {
  const floor = now.getTime() - POST_CONSULT_LOOKBACK_DAYS * DAY_MS;
  const candidates = meetings
    .filter((m) => m.hasMaterial && m.startedAt && Date.parse(m.startedAt) >= floor && Date.parse(m.startedAt) <= now.getTime())
    .filter((m) => !meetingHandled(rows, m.id))
    .sort((a, b) => Date.parse(b.startedAt ?? "") - Date.parse(a.startedAt ?? ""));
  return candidates[0] ?? null;
}

/* ─────────────────────────── the promise ─────────────────────────── */

export type NextPromise =
  | { job: "consult-prep"; withClientEmail: boolean; window: RunWindow; consult: BookedConsult }
  | { job: "post-consult"; source: "recording"; window: RunWindow; meeting: MeetingFact }
  | { job: "post-consult"; source: "after-consult"; window: RunWindow; earliest: true; consult: BookedConsult };

export type NextAction =
  /** A job that is on will take this action at this time. */
  | { status: "promise"; promise: NextPromise }
  /** There is something a job could do here, but the job is off: nothing is promised, and why. */
  | { status: "off"; for: "consult-prep" | "post-consult"; why: JobOffWhy; consult: BookedConsult | null }
  /** Nothing here for any job to do. */
  | { status: "none" }
  /** A read the rule needs failed: "Can't show what Lectual will do next." */
  | { status: "unknown" };

function callEnd(c: BookedConsult): string {
  return c.endsAt ?? c.startsAt;
}

/**
 * The next promised action for this lead. Order: a consult still to come (prep, else the proposal after it), then a
 * recorded call waiting for the drafter. A read that would decide it and failed is `unknown`, never "nothing".
 */
export function nextAction(facts: Pick<LeadStepFacts, "now" | "approvals" | "consult" | "meetings" | "activity" | "jobs">): NextAction {
  const now = new Date(facts.now);
  const { consult, meetings, activity, jobs } = facts;

  // A consult on the calendar (Mailboxes feature). Not set up = no Outlook consult to speak of.
  if (consult.status === "unavailable") return { status: "unknown" };
  const booked = consult.status === "ok" && consult.value && Date.parse(consult.value.startsAt) > now.getTime() ? consult.value : null;

  if (booked) {
    if (activity.status !== "ok" || jobs.status !== "ok") return { status: "unknown" };
    const prepGate = consultPrepGate(jobs.value, facts.approvals);
    if (prepGate.on === "unknown") return { status: "unknown" };
    const prepped = prepRecorded(activity.value, booked.eventId);
    if (!prepped && prepGate.on === true) {
      const window = prepRunFor(booked.startsAt, now);
      if (window) return { status: "promise", promise: { job: "consult-prep", withClientEmail: jobs.value.modules.agentToolkit, window, consult: booked } };
    }
    const postGate = postConsultGate(jobs.value, facts.approvals, { callStillToCome: true });
    if (postGate.on === "unknown") return { status: "unknown" };
    if (postGate.on === true) {
      const window = firstRunAfterImport(callEnd(booked));
      if (window) return { status: "promise", promise: { job: "post-consult", source: "after-consult", window, earliest: true, consult: booked } };
    }
    // Something could be done for this consult, but the job is off: say why (prep first while it is still to do).
    if (!prepped && prepGate.on === false) return { status: "off", for: "consult-prep", why: prepGate.why, consult: booked };
    if (postGate.on === false) return { status: "off", for: "post-consult", why: postGate.why, consult: booked };
    return { status: "none" };
  }

  // A recorded call waiting for the post-consult drafter.
  if (meetings.status === "unavailable") return { status: "unknown" };
  if (meetings.status === "ok" && meetings.value.length > 0) {
    if (activity.status !== "ok") return { status: "unknown" };
    const waiting = recordingWaiting(meetings.value, activity.value, now);
    if (waiting) {
      if (jobs.status !== "ok") return { status: "unknown" };
      const gate = postConsultGate(jobs.value, facts.approvals, { callStillToCome: false });
      if (gate.on === "unknown") return { status: "unknown" };
      if (gate.on === false) return { status: "off", for: "post-consult", why: gate.why, consult: null };
      const window = nextRunWindow("agents", now);
      if (!window) return { status: "unknown" };
      return { status: "promise", promise: { job: "post-consult", source: "recording", window, meeting: waiting } };
    }
  }
  return { status: "none" };
}
