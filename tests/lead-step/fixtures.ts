import type { JobsFacts, LeadStepFacts, PendingDraft, ProposalFact } from "@/lib/lead-step/facts";
import { classifyQueueItem, isAttorneyOnly } from "@/lib/queue/routing";
import { parseReviewerSummary } from "@/lib/queue/reviewer-summary";
import type { ActivityRow } from "@/lib/stage-keeper/moves";

/** Tue Nov 17, 2026, 10:00 AM in New York (the mockup's "today"). */
export const NOW = "2026-11-17T15:00:00.000Z";
export const TZ = "America/New_York";
export const LEAD = "11111111-1111-4111-8111-111111111111";
export const MERGED = "22222222-2222-4222-8222-222222222222";
export const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const RAYN = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export function jobsOn(over: Partial<JobsFacts> = {}): JobsFacts {
  return {
    agentsOn: true,
    aiOn: true,
    autopilot: "running",
    settings: {
      "consult-prep": { enabled: true, autonomy: "draft" },
      "post-consult": { enabled: true, autonomy: "draft" },
      "stage-keeper": { enabled: true, autonomy: "act" },
    },
    modules: { mailbox: true, proposals: true, agentToolkit: true },
    proposalApprovers: true,
    meetingSourceActive: true,
    ...over,
  };
}

/** A lead with nothing going on: every read worked and found nothing. */
export function facts(over: Partial<LeadStepFacts> = {}): LeadStepFacts {
  return {
    now: NOW,
    timeZone: TZ,
    lead: {
      id: LEAD,
      mergedIds: [LEAD],
      mergedPartial: false,
      name: "Maya Okafor",
      email: "maya@brightline.example",
      lastInboundAt: "2026-11-17T14:12:00.000Z",
      lastOutboundAt: null,
      stageId: "stage-new",
      stageName: "Potential New Client",
      assignedTo: null,
    },
    viewer: { userId: ME, role: "attorney", actingAsStaff: false, canMoveStage: true },
    routing: { status: "ok", routing: {}, members: [] },
    approvals: { status: "ok", value: { items: [], total: 0 } },
    tasks: { status: "ok", value: [] },
    consult: { status: "ok", value: null },
    meetings: { status: "ok", value: [] },
    proposal: { status: "ok", value: null },
    activity: { status: "ok", value: { rows: [], truncated: false } },
    markers: { status: "ok", value: { preppedEventIds: [], handledMeetingIds: [], outcomeLogged: false } },
    jobs: { status: "ok", value: jobsOn() },
    ...over,
  };
}

export function draft(over: Partial<PendingDraft> & { id?: string } = {}): PendingDraft {
  const base = {
    id: over.id ?? "q-1",
    type: "CLIENT_EMAIL",
    agent: "morning-brief",
    headline: "Follow-up for a stalled lead: Maya Okafor",
    summary: null as string | null,
    recipient: "maya@brightline.example",
    subject: "Your Brightline Studio proposal",
    draftBody: "Hi Maya,\n\nI wanted to check that the proposal link reached you.\n\nWarm regards,\nRebecca",
    finalBody: null as string | null,
  };
  const merged = { ...base, ...over };
  const item = { type: merged.type, agent: merged.agent, headline: merged.headline, recipient: merged.recipient, summary: merged.summary, draft_body: merged.draftBody, final_body: merged.finalBody };
  return {
    body: merged.finalBody ?? merged.draftBody,
    createdAt: "2026-11-17T13:05:00.000Z",
    clientName: "Maya Okafor",
    payloadKind: null,
    kind: classifyQueueItem(item),
    attorneyOnly: isAttorneyOnly(item),
    reviewer: parseReviewerSummary(merged.summary),
    closerLook: { reasons: [], linkNotLive: false },
    linked: { status: "none" },
    handoff: { status: "unknown" },
    ...merged,
  } as PendingDraft;
}

export function proposal(over: Partial<ProposalFact> = {}): ProposalFact {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    familyId: "44444444-4444-4444-8444-444444444444",
    version: 1,
    status: "sent",
    expiresOn: "2026-11-22",
    sentAt: "2026-11-15T16:02:00.000Z",
    acceptedAt: null,
    signed: false,
    legalCents: 547000,
    opens: { status: "ok", count: 2, lastAt: "2026-11-16T23:40:00.000Z" },
    paid: { status: "n/a" },
    ...over,
  };
}

export function row(over: Partial<ActivityRow> & { id: string; type: string }): ActivityRow {
  return { lead_id: LEAD, actor_type: "ai", created_at: "2026-11-16T12:00:00.000Z", payload: {}, ...over };
}

/** Thu Nov 19, 2:00 PM to 2:45 PM New York. */
export const THURSDAY_CONSULT = { eventId: "evt-1", title: "Strategy session: Maya Okafor", startsAt: "2026-11-19T19:00:00.000Z", endsAt: "2026-11-19T19:45:00.000Z", joinUrl: null };

/** The approvals read as the loader returns it: the items given, `total` all of them. */
export const pending = (...items: PendingDraft[]) => ({ status: "ok" as const, value: { items, total: items.length } });
export const timeline = (...rows: ActivityRow[]) => ({ status: "ok" as const, value: { rows, truncated: false } });
