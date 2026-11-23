import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveViewSession } from "@/lib/views/view-as";
import { CAN_MOVE_STAGE, getLead, listStages } from "@/lib/pipeline";
import { mergedSetFor, resolveLeadId } from "@/lib/leads/live";
import { activeOrgModulesOrNull } from "@/lib/org/modules";
import { getFirmTimeZone } from "@/lib/org/profile";
import { aiConfigured } from "@/lib/ai/claude";
import { loadAutopilot } from "@/lib/agents/autopilot";
import { AGENT_IDS, type AgentId, type Autonomy } from "@/lib/agents/types";
import { loadActiveQueue } from "@/lib/queue/load";
import { groupPendingByLead } from "@/lib/queue/lead-pending";
import type { QueueItem } from "@/lib/queue/api";
import type { StopDb } from "@/lib/campaigns/stop-db";
import { classifyQueueItem, isAttorneyOnly } from "@/lib/queue/routing";
import { loadApprovalRouting } from "@/lib/queue/routing-load";
import { parseReviewerSummary } from "@/lib/queue/reviewer-summary";
import { currentHolder, eventTrust, linkGateFlags, needsCloserLook, trustedCardState } from "@/lib/queue/deck";
import { loadCardState } from "@/lib/queue/card-state";
import { shownBodySha256 } from "@/lib/queue/shown-text";
import { PREP_SOURCE } from "@/lib/agents/consult-prep/constants";
import { CONSULT_PROPOSAL_SOURCE } from "@/lib/consult-proposal/source";
import type { Role } from "@/lib/auth/roles";
import { leadCloserLook, type LeadCloserLook } from "./closer-look";
import { checkDraftStaleness, stalenessRequiresConfirm } from "@/lib/queue/stale";
import { loadAuditContext } from "@/lib/queue/audit-context";
import { gateLinkedProposal, loadLinkedPanel } from "@/lib/consult-proposal/link";
import { listTasks } from "@/lib/matters/tasks";
import { loadBookedConsult } from "@/lib/calendar/outlook-read";
import { loadBookedLawmaticsConsult } from "@/lib/calendar/lawmatics-read";
import { mergeBookedConsults } from "@/lib/calendar/booked-merge";
import { meetingsFor } from "@/lib/meetings/read";
import { listMeetingConnections } from "@/lib/meetings/connection";
import { getProposalSettings, listProposalOpens, listProposalStepEvents, listProposals } from "@/lib/proposals/store";
import { paidStateFromEvents } from "@/lib/proposals/paid";
import type { ActivityRow } from "@/lib/stage-keeper/moves";
import {
  notSetUp,
  ok,
  unavailable,
  type BookedConsult,
  type HandoffFact,
  type MarkersFact,
  type JobsFacts,
  type LeadStepFacts,
  type LinkedProposalFact,
  type MeetingFact,
  type OpenTask,
  type PendingDraft,
  type ProposalFact,
  type QueueRef,
  type Read,
  type RoutingFacts,
} from "./facts";

/**
 * The lead page's "where Lectual does the step" facts, read on the server. Every read:
 *   · goes through the signed-in person's scoped client (RLS on the active org). No service role, no write.
 *   · reuses the reader the rest of the app already has (the queue's three-state load and its resolver, the
 *     linked-proposal gate, the stale check, the Outlook consult, meetings, proposals, tasks).
 *   · is independent and three-state: one failing never turns another into "nothing", and a failed read is never
 *     "nothing needs you". Nothing here throws to the page except an unexpected bug in the session read.
 *
 * A merged lead is followed to its keeper first. History (timeline, proposals, which drafts belong here) is read
 * across the keeper and the leads merged into it, as the lead page reads it.
 */

/** Pending drafts enriched per lead. A lead rarely has more; the rest still count in "N more waiting". */
const ENRICH_CAP = 10;
const ACTIVITY_COLUMNS = "id, lead_id, type, actor_type, created_at, payload";
/** The same cap as the lead page's timeline. */
const ACTIVITY_CAP = 100;

type Scoped = Awaited<ReturnType<typeof getScopedClient>>;

async function settle<T>(p: Promise<Read<T>>): Promise<Read<T>> {
  try {
    return await p;
  } catch {
    return unavailable();
  }
}

/* ─────────────────────────── approvals ─────────────────────────── */

function linkedFact(panel: Awaited<ReturnType<typeof loadLinkedPanel>>, gate: Awaited<ReturnType<typeof gateLinkedProposal>> | null): LinkedProposalFact {
  if (panel.status === "none") return { status: "none" };
  if (panel.status === "unavailable") return { status: "unavailable" };
  const p = panel.proposal;
  return {
    status: "ok",
    id: p.id,
    version: p.version,
    proposalStatus: p.status,
    clientName: p.clientName,
    legalCents: p.legalCents,
    govCents: p.govCents,
    errorCount: p.errorCount,
    gateRefusal: gate && !gate.ok ? gate.error : null,
  };
}

type Audit = Awaited<ReturnType<typeof loadAuditContext>>;

/**
 * Why this item needs the full approval page instead of a Yes on the lead page: the deck's own rule
 * (`needsCloserLook`) over the same server reads the deck uses (the linked-proposal gate, the stale check, the draft
 * audit). Null when any of them could not be read: Yes is then not offered, and the action refuses.
 */
export async function closerLookFor(item: QueueItem, audit?: Audit | null): Promise<{ look: LeadCloserLook | null; gate: Awaited<ReturnType<typeof gateLinkedProposal>> | null }> {
  try {
    const [gate, stale, ctx] = await Promise.all([gateLinkedProposal(item.id), checkDraftStaleness(item), audit === undefined ? loadAuditContext() : Promise.resolve(audit)]);
    const g = linkGateFlags(gate);
    const reasons = needsCloserLook(item, ctx, { stale: stalenessRequiresConfirm(stale), linkedProposal: g.failed, linkedProposalPassed: g.passedWithProposal });
    return { look: leadCloserLook(reasons, gate), gate };
  } catch {
    return { look: null, gate: null };
  }
}

/**
 * Who holds each card, folded EXACTLY as the deck folds it: `loadCardState`, then `trustedCardState` with the deck's
 * `eventTrust` (a forged hand-off never makes anyone the holder), then `currentHolder`. Not set up or unreadable is
 * `unknown`, and every card shows as it does today.
 */
export async function readHandoffs(items: readonly QueueItem[], routing: RoutingFacts): Promise<Map<string, HandoffFact>> {
  const out = new Map<string, HandoffFact>();
  try {
    const loaded = await loadCardState(items.map((i) => i.id));
    const trusted = trustedCardState(loaded, items, eventTrust(routing.status === "ok" ? { status: "ok", routing: routing.routing, members: routing.members } : { status: "failed" }));
    for (const i of items) {
      if (trusted.status !== "ok") out.set(i.id, { status: "unknown" });
      else {
        const h = currentHolder(trusted.events, i.id);
        out.set(i.id, { status: "ok", holder: h ? { userId: h.userId, by: h.by, note: h.note, at: h.at } : null });
      }
    }
  } catch {
    for (const i of items) out.set(i.id, { status: "unknown" });
  }
  return out;
}

async function enrich(item: QueueItem, payloadKind: string | null, audit: Audit | null, handoff: HandoffFact): Promise<PendingDraft> {
  const body = item.final_body ?? item.draft_body;
  const [look, panel] = await Promise.all([closerLookFor(item, audit), loadLinkedPanel(item.id).catch(() => ({ status: "unavailable" as const }))]);
  const closerLook = look.look;
  const linked: LinkedProposalFact = linkedFact(panel, look.gate);
  return {
    id: item.id,
    type: item.type,
    agent: item.agent,
    headline: item.headline,
    summary: item.summary,
    recipient: item.recipient,
    subject: item.subject,
    body,
    bodySha256: shownBodySha256(body),
    draftBody: item.draft_body,
    finalBody: item.final_body,
    createdAt: item.created_at || null,
    clientName: item.client_name,
    payloadKind,
    kind: classifyQueueItem(item),
    attorneyOnly: isAttorneyOnly(item),
    reviewer: parseReviewerSummary(item.summary),
    closerLook,
    linked,
    handoff,
  };
}

/**
 * The pending queue items linked to this lead (any id of its merged set), by the SAME grouping the lead page's
 * "waiting on" read uses (`groupPendingByLead`, over the queue's batched resolver), so the two cannot disagree.
 */
export async function readLeadApprovals(db: Scoped, leadIds: readonly string[], routing: RoutingFacts): Promise<Read<{ items: PendingDraft[]; total: number; refs?: QueueRef[]; briefings?: QueueRef[] }>> {
  const queue = await loadActiveQueue("pending");
  if (queue.status === "unconfigured") return notSetUp("queue-off");
  if (queue.status !== "ok") return unavailable();
  try {
    const byLead = await groupPendingByLead(db as unknown as StopDb, queue.items);
    const kinds = new Map<string, string>();
    for (const id of leadIds) for (const a of byLead[id] ?? []) kinds.set(a.queueId, a.kind);
    // Internal briefings are never the card, and the order is oldest first: both BEFORE the cap, so the cap never drops
    // the draft that should be on top. `total` counts all of them.
    const mine = queue.items
      .filter((i) => kinds.has(i.id) && classifyQueueItem(i) !== "internal_briefing")
      .sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || a.id.localeCompare(b.id));
    const ref = (i: QueueItem): QueueRef => ({ id: i.id, headline: i.headline, createdAt: i.created_at ?? null });
    const byAge = (a: QueueItem, b: QueueItem) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0) || a.id.localeCompare(b.id);
    const briefings = queue.items.filter((i) => kinds.has(i.id) && classifyQueueItem(i) === "internal_briefing").sort(byAge).map(ref);
    if (mine.length === 0) return ok({ items: [], total: 0, refs: [], briefings });
    const capped = mine.slice(0, ENRICH_CAP);
    const [audit, handoffs] = await Promise.all([loadAuditContext().catch(() => null), readHandoffs(capped, routing)]);
    const enriched = await Promise.all(capped.map((i) => enrich(i, kinds.get(i.id) ?? null, audit, handoffs.get(i.id) ?? { status: "unknown" })));
    return ok({ items: enriched, total: mine.length, refs: mine.map(ref), briefings });
  } catch {
    return unavailable();
  }
}

/* ─────────────────────────── the rest ─────────────────────────── */

async function readTasks(leadId: string): Promise<Read<OpenTask[]>> {
  const rows = await listTasks({ leadId, status: "open" });
  return ok(rows.map((t) => ({ id: t.id, title: t.title, type: t.type, dueAt: t.due_at, assigneeId: t.assignee_id, createdAt: t.created_at })));
}

async function readConsult(leadId: string, modules: string[] | null): Promise<Read<BookedConsult | null>> {
  // Lawmatics consults first: not behind the Mailboxes feature (null = Lawmatics isn't connected, nothing read).
  const lawmatics = await loadBookedLawmaticsConsult(leadId).catch(() => ({ status: "unavailable" as const }));
  const fact = (e: { id: string; title: string | null; starts_at: string; ends_at: string | null; join_url: string | null }) =>
    ok({ eventId: e.id, title: e.title, startsAt: e.starts_at, endsAt: e.ends_at, joinUrl: e.join_url });
  // The Mailboxes gate applies to the Outlook half only.
  const mailbox = modules === null ? "unknown" : modules.includes("mailbox") ? "on" : "off";
  const outlook = mailbox === "on" ? await loadBookedConsult(leadId) : null;
  const read = mergeBookedConsults([lawmatics, outlook]);
  if (read?.status === "ok" && read.event) return fact(read.event);
  if (mailbox === "unknown") return unavailable();
  if (read?.status === "unavailable") return unavailable();
  if (read?.status === "database-update-needed") return notSetUp("calendar-not-ready");
  if (mailbox === "off") return notSetUp("mailbox-off");
  return ok(null);
}

async function readMeetings(leadId: string): Promise<Read<MeetingFact[]>> {
  const read = await meetingsFor({ leadId });
  if (read.status !== "ok") return unavailable();
  return ok(
    read.meetings.map((m) => ({ id: m.id, provider: m.provider, title: m.title, startedAt: m.started_at, durationSeconds: m.duration_seconds, hasMaterial: m.has_summary || m.has_transcript })),
  );
}

async function readProposal(leadIds: readonly string[], modules: string[] | null): Promise<Read<ProposalFact | null>> {
  if (modules === null) return unavailable();
  if (!modules.includes("proposals")) return notSetUp("proposals-off");
  const list = await listProposals(leadIds.length > 1 ? { leadIds: [...leadIds] } : { leadId: leadIds[0] });
  // Newest family first (updated_at), each collapsed to its newest version by the store.
  const p = list[0];
  if (!p) return ok(null);
  const [opens, steps] = await Promise.all([
    listProposalOpens([p.id]).then(
      (m) => ({ status: "ok" as const, count: m.get(p.id)?.count ?? 0, lastAt: m.get(p.id)?.lastAt ?? null }),
      () => ({ status: "unavailable" as const }),
    ),
    p.status === "accepted" ? listProposalStepEvents(p.id) : Promise.resolve(null),
  ]);
  const paid: ProposalFact["paid"] =
    steps === null
      ? { status: "n/a" }
      : steps.ok
        ? (() => {
            const s = paidStateFromEvents(steps.events);
            return { status: "ok" as const, paid: s.state === "paid", at: s.state === "paid" ? s.at : null };
          })()
        : { status: "unavailable" };
  return ok({
    id: p.id,
    familyId: p.family_id,
    version: p.version,
    status: p.status,
    expiresOn: p.expires_on,
    sentAt: p.sent_at,
    acceptedAt: p.accepted_at,
    signed: p.signed === true,
    legalCents: p.legal_total_cents,
    opens,
    paid,
  });
}

/** The newest timeline rows, as the lead page reads them. One row past the cap is asked for, to know it was cut short. */
async function readActivity(db: Scoped, leadIds: readonly string[]): Promise<Read<{ rows: ActivityRow[]; truncated: boolean }>> {
  const base = db.from("crm_activity").select(ACTIVITY_COLUMNS);
  const { data, error } = await (leadIds.length > 1 ? base.in("lead_id", [...leadIds]) : base.eq("lead_id", leadIds[0])).order("created_at", { ascending: false }).limit(ACTIVITY_CAP + 1);
  if (error) return unavailable();
  const rows = (data ?? []) as ActivityRow[];
  return ok({ rows: rows.slice(0, ACTIVITY_CAP), truncated: rows.length > ACTIVITY_CAP });
}

/**
 * The assistants' markers, by targeted queries (never inferred from the capped timeline): consult prep's marker for
 * the booked event, the consult drafter's markers for the recorded calls, and a consult outcome a person logged.
 */
export async function readMarkers(db: Scoped, leadIds: readonly string[], eventId: string | null, meetingIds: readonly string[]): Promise<Read<MarkersFact>> {
  const onLeads = <Q extends { in: (c: string, v: string[]) => Q; eq: (c: string, v: string) => Q }>(q: Q): Q => (leadIds.length > 1 ? q.in("lead_id", [...leadIds]) : q.eq("lead_id", leadIds[0]));
  const [prep, drafted, outcome] = await Promise.all([
    eventId
      ? onLeads(db.from("crm_activity").select("payload").eq("type", "queue_drafted").eq("payload->>source", PREP_SOURCE).eq("payload->>event_id", eventId)).limit(1)
      : Promise.resolve({ data: [], error: null }),
    meetingIds.length > 0
      ? db
          .from("crm_activity")
          .select("payload")
          .in("type", ["queue_drafted", "ai_insight"])
          .eq("payload->>source", CONSULT_PROPOSAL_SOURCE)
          .in("payload->>meeting_id", [...meetingIds])
          .limit(500)
      : Promise.resolve({ data: [], error: null }),
    onLeads(db.from("crm_activity").select("id").eq("type", "call_logged").not("payload->>consult_outcome", "is", null)).limit(1),
  ]);
  if (prep.error || drafted.error || outcome.error) return unavailable();
  const handled = new Set<string>();
  for (const r of (drafted.data ?? []) as { payload: unknown }[]) {
    const id = (r.payload as Record<string, unknown> | null)?.meeting_id;
    if (typeof id === "string") handled.add(id);
  }
  return ok({ preppedEventIds: eventId && (prep.data ?? []).length > 0 ? [eventId] : [], handledMeetingIds: [...handled], outcomeLogged: (outcome.data ?? []).length > 0 });
}

/**
 * Who can certainly read the firm's settings rows. `agent_setting` is managed by owner / admin / senior admin (lectual
 * 0076 RLS, `src/app/dashboard/agents/actions.ts`); this repo does not show its SELECT policy or that of
 * `client_proposal_setting`. So an EMPTY answer is trusted as "nothing switched on" or "no approvers" only for this
 * tier; for any other role it is unknown, and nothing is promised or said to be off on it.
 */
const SETTINGS_READERS: readonly Role[] = ["owner", "admin", "senior_admin"];

async function readJobs(db: Scoped, modules: string[] | null, role: Role): Promise<Read<JobsFacts>> {
  if (modules === null) return unavailable();
  const [settingsRead, autopilot, approvers, connections] = await Promise.all([
    db.from("agent_setting").select("agent, enabled, autonomy"),
    loadAutopilot(),
    getProposalSettings().then(
      (s) => (s && s.approver_user_ids.length > 0 ? true : SETTINGS_READERS.includes(role) ? false : null),
      () => null,
    ),
    listMeetingConnections(),
  ]);
  if (settingsRead.error) return unavailable();
  const trustsEmpty = SETTINGS_READERS.includes(role);
  const rows = (settingsRead.data ?? []) as { agent: string; enabled: boolean; autonomy: string }[];
  let settings: JobsFacts["settings"] = {};
  for (const row of rows) {
    if ((AGENT_IDS as readonly string[]).includes(row.agent)) settings[row.agent as AgentId] = { enabled: Boolean(row.enabled), autonomy: row.autonomy as Autonomy };
  }
  if (rows.length === 0 && !trustsEmpty) settings = null;
  return ok({
    agentsOn: modules.includes("agents"),
    aiOn: aiConfigured(),
    // The runner's own rule: a read that failed counts as paused; a missing table (0082 not applied) as running.
    autopilot: autopilot.status === "ok" ? (autopilot.state.paused ? "paused" : "running") : autopilot.status === "missing" ? "running" : "unknown",
    settings,
    modules: { mailbox: modules.includes("mailbox"), proposals: modules.includes("proposals"), agentToolkit: modules.includes("agent-toolkit") },
    proposalApprovers: approvers,
    meetingSourceActive: connections.ok ? connections.connections.some((c) => c.status === "active") : null,
  });
}

async function readRouting(): Promise<RoutingFacts> {
  const r = await loadApprovalRouting();
  return r.status === "ok" ? { status: "ok", routing: r.routing, members: r.members } : { status: "failed" };
}

/** The loader's answer. A lead that isn't there (or isn't this firm's) is `not-found`; a read that failed is `unavailable`. */
export type LeadStepLoad = { status: "ok"; facts: LeadStepFacts } | { status: "not-found" } | { status: "unavailable" };

async function readKeeper(supabase: Scoped, leadId: string): Promise<{ status: "ok"; lead: NonNullable<Awaited<ReturnType<typeof getLead>>> } | { status: "not-found" } | { status: "unavailable" }> {
  let lead: Awaited<ReturnType<typeof getLead>>;
  try {
    lead = await getLead(leadId);
  } catch {
    return { status: "unavailable" };
  }
  if (!lead) return { status: "not-found" };
  if (!lead.merged_into_id) return { status: "ok", lead };
  let followed: Awaited<ReturnType<typeof resolveLeadId>>;
  try {
    followed = await resolveLeadId(supabase, leadId);
  } catch {
    return { status: "unavailable" };
  }
  if (followed.status !== "ok") return { status: followed.status };
  try {
    const keeper = await getLead(followed.id);
    return keeper ? { status: "ok", lead: keeper } : { status: "not-found" };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Everything the top card, the four facts and "What Lectual did" are decided from. Never throws: a person who isn't
 * signed in to a firm, or a lead that isn't theirs to see (RLS: another firm's id is just "not found"), is `not-found`;
 * any read of the lead itself that failed is `unavailable`. A merged lead is followed to its keeper.
 */
export async function loadLeadStepFacts(leadId: string, now: Date = new Date()): Promise<LeadStepLoad> {
  try {
    const session = await resolveViewSession();
    if (session.kind !== "ok") return { status: "not-found" };
    const supabase = await getScopedClient();
    const found = await readKeeper(supabase, leadId);
    if (found.status !== "ok") return found;
    const keeper = found.lead;
    const merged = await mergedSetFor(supabase, keeper.id);
    const ids = merged.ids.length > 0 ? merged.ids : [keeper.id];

    const [modules, timeZone, stages, routing] = await Promise.all([
      activeOrgModulesOrNull(),
      getFirmTimeZone(),
      listStages().catch(() => null),
      readRouting(),
    ]);

    const [approvals, tasks, consult, meetings, proposal, activity, jobs] = await Promise.all([
      settle(readLeadApprovals(supabase, ids, routing)),
      settle(readTasks(keeper.id)),
      settle(readConsult(keeper.id, modules)),
      settle(readMeetings(keeper.id)),
      settle(readProposal(ids, modules)),
      settle(readActivity(supabase, ids)),
      settle(readJobs(supabase, modules, session.role)),
    ]);
    // The markers need the booked event and the recorded calls; a failed read of either makes the markers unknown.
    const markers: Read<MarkersFact> =
      consult.status === "unavailable" || meetings.status === "unavailable"
        ? unavailable()
        : await settle(
            readMarkers(
              supabase,
              ids,
              consult.status === "ok" && consult.value ? consult.value.eventId : null,
              meetings.status === "ok" ? meetings.value.map((m) => m.id) : [],
            ),
          );

    return {
      status: "ok",
      facts: {
        now: now.toISOString(),
        timeZone,
        lead: {
          id: keeper.id,
          mergedIds: ids,
          mergedPartial: merged.status !== "ok",
          name: `${keeper.first_name ?? ""} ${keeper.last_name ?? ""}`.trim() || keeper.email || "",
          email: keeper.email,
          lastInboundAt: keeper.last_inbound_at,
          lastOutboundAt: keeper.last_outbound_at,
          stageId: keeper.current_stage_id,
          stageName: stages?.find((s) => s.id === keeper.current_stage_id)?.name ?? null,
          assignedTo: keeper.assigned_to,
        },
        viewer: { userId: session.user.id, role: session.role, actingAsStaff: session.actingAsStaff, canMoveStage: CAN_MOVE_STAGE.includes(session.role) },
        routing,
        approvals,
        tasks,
        consult,
        meetings,
        proposal,
        activity,
        markers,
        jobs,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}
