import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
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
import { linkGateFlags, needsCloserLook, type CloserReason } from "@/lib/queue/deck";
import { checkDraftStaleness, stalenessRequiresConfirm } from "@/lib/queue/stale";
import { loadAuditContext } from "@/lib/queue/audit-context";
import { gateLinkedProposal, loadLinkedPanel } from "@/lib/consult-proposal/link";
import { listTasks } from "@/lib/matters/tasks";
import { loadBookedConsult } from "@/lib/calendar/outlook-read";
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
  type JobsFacts,
  type LeadStepFacts,
  type LinkedProposalFact,
  type MeetingFact,
  type OpenTask,
  type PendingDraft,
  type ProposalFact,
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
export async function closerLookFor(item: QueueItem, audit?: Audit | null): Promise<{ reasons: CloserReason[] | null; gate: Awaited<ReturnType<typeof gateLinkedProposal>> | null }> {
  try {
    const [gate, stale, ctx] = await Promise.all([gateLinkedProposal(item.id), checkDraftStaleness(item), audit === undefined ? loadAuditContext() : Promise.resolve(audit)]);
    const g = linkGateFlags(gate);
    return { reasons: needsCloserLook(item, ctx, { stale: stalenessRequiresConfirm(stale), linkedProposal: g.failed, linkedProposalPassed: g.passedWithProposal }), gate };
  } catch {
    return { reasons: null, gate: null };
  }
}

async function enrich(item: QueueItem, payloadKind: string | null, audit: Audit | null): Promise<PendingDraft> {
  const body = item.final_body ?? item.draft_body;
  const [look, panel] = await Promise.all([closerLookFor(item, audit), loadLinkedPanel(item.id).catch(() => ({ status: "unavailable" as const }))]);
  const closerLook = look.reasons;
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
  };
}

/**
 * The pending queue items linked to this lead (any id of its merged set), by the SAME grouping the lead page's
 * "waiting on" read uses (`groupPendingByLead`, over the queue's batched resolver), so the two cannot disagree.
 */
export async function readLeadApprovals(db: Scoped, leadIds: readonly string[]): Promise<Read<PendingDraft[]>> {
  const queue = await loadActiveQueue("pending");
  if (queue.status === "unconfigured") return notSetUp("queue-off");
  if (queue.status !== "ok") return unavailable();
  try {
    const byLead = await groupPendingByLead(db as unknown as StopDb, queue.items);
    const kinds = new Map<string, string>();
    for (const id of leadIds) for (const a of byLead[id] ?? []) kinds.set(a.queueId, a.kind);
    const mine = queue.items.filter((i) => kinds.has(i.id));
    if (mine.length === 0) return ok([]);
    const audit = await loadAuditContext().catch(() => null);
    const enriched = await Promise.all(mine.slice(0, ENRICH_CAP).map((i) => enrich(i, kinds.get(i.id) ?? null, audit)));
    return ok(enriched);
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
  if (modules === null) return unavailable();
  if (!modules.includes("mailbox")) return notSetUp("mailbox-off");
  const read = await loadBookedConsult(leadId);
  if (read.status === "database-update-needed") return notSetUp("calendar-not-ready");
  if (read.status !== "ok") return unavailable();
  const e = read.event;
  return ok(e ? { eventId: e.id, title: e.title, startsAt: e.starts_at, endsAt: e.ends_at, joinUrl: e.join_url } : null);
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

async function readActivity(db: Scoped, leadIds: readonly string[]): Promise<Read<ActivityRow[]>> {
  const base = db.from("crm_activity").select(ACTIVITY_COLUMNS);
  const { data, error } = await (leadIds.length > 1 ? base.in("lead_id", [...leadIds]) : base.eq("lead_id", leadIds[0])).order("created_at", { ascending: false }).limit(100);
  if (error) return unavailable();
  return ok((data ?? []) as ActivityRow[]);
}

async function readJobs(db: Scoped, modules: string[] | null): Promise<Read<JobsFacts>> {
  if (modules === null) return unavailable();
  const [settingsRead, autopilot, approvers, connections] = await Promise.all([
    db.from("agent_setting").select("agent, enabled, autonomy"),
    loadAutopilot(),
    getProposalSettings().then(
      (s) => (s ? s.approver_user_ids.length > 0 : false),
      () => null,
    ),
    listMeetingConnections(),
  ]);
  if (settingsRead.error) return unavailable();
  const settings: JobsFacts["settings"] = {};
  for (const row of (settingsRead.data ?? []) as { agent: string; enabled: boolean; autonomy: string }[]) {
    if ((AGENT_IDS as readonly string[]).includes(row.agent)) settings[row.agent as AgentId] = { enabled: Boolean(row.enabled), autonomy: row.autonomy as Autonomy };
  }
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

/**
 * Everything the top card, the four facts and "What Lectual did" are decided from. Null when the person isn't signed
 * in to a firm, or the lead isn't theirs to see (RLS: another firm's id is just "not found").
 */
export async function loadLeadStepFacts(leadId: string, now: Date = new Date()): Promise<LeadStepFacts | null> {
  const session = await resolveFirmSession();
  if (session.kind !== "ok") return null;
  const supabase = await getScopedClient();

  let lead = await getLead(leadId);
  if (!lead) return null;
  if (lead.merged_into_id) {
    const followed = await resolveLeadId(supabase, leadId);
    if (followed.status !== "ok") return null;
    lead = await getLead(followed.id);
    if (!lead) return null;
  }
  const keeper = lead;
  const merged = await mergedSetFor(supabase, keeper.id);
  const ids = merged.ids.length > 0 ? merged.ids : [keeper.id];

  const [modules, timeZone, stages] = await Promise.all([activeOrgModulesOrNull(), getFirmTimeZone(), listStages().catch(() => null)]);

  const [approvals, tasks, consult, meetings, proposal, activity, jobs, routing] = await Promise.all([
    settle(readLeadApprovals(supabase, ids)),
    settle(readTasks(keeper.id)),
    settle(readConsult(keeper.id, modules)),
    settle(readMeetings(keeper.id)),
    settle(readProposal(ids, modules)),
    settle(readActivity(supabase, ids)),
    settle(readJobs(supabase, modules)),
    readRouting(),
  ]);

  return {
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
    jobs,
  };
}
