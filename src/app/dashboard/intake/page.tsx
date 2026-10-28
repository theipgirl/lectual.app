import { listStages, type Stage } from "@/lib/pipeline";
import type { Lead } from "@/lib/pipeline";
import { listIntakeLeads } from "@/lib/intake/leads";
import { intakeStages } from "@/lib/intake/scope";
import { inPipelineOrder } from "@/lib/pipeline/stage-order";
import { loadTemperatureFacts, type TemperatureFactsRead } from "@/lib/intake/facts";
import { leadActivitySince, type Activity } from "@/lib/matters";
import { listMemberDirectory, type MemberIdentity } from "@/lib/members/directory";
import { listForLeads, runningForMe } from "@/lib/time/entries";
import { notifyTimeRunning } from "@/lib/notifications/producers";
import { buildIntakeTime, startOfWeek, type IntakeTime } from "@/lib/time";
import {
  buildIntakeRows,
  parseIntakeFilters,
  parseIntakeViewState,
  type IntakeSearchParams,
} from "@/lib/intake/rows";
import { loadPendingApprovalsByLead } from "@/lib/queue/lead-pending";
import type { LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import { resolveFirmSession } from "@/lib/firm/session";
import { getFirmTimeZone } from "@/lib/org/profile";
import { loadAgentMoves, type AgentMovesRead } from "@/lib/stage-keeper/read";
import { loadStageDecisions, type StageDecisionsRead } from "@/lib/intake/stage-decisions-read";
import { canReconcile } from "@/lib/reconcile/roles";
import { LeadsLoadFailed, NoLeadStages } from "./_components/LeadsNotices";
import { LEADS_NAME } from "@/lib/ui/words";
import IntakeWorkspace from "./_components/IntakeWorkspace";
import "./intake.css";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle(LEADS_NAME) };

export const dynamic = "force-dynamic";

/** How far back the "latest note" lookup reaches. */
const NOTE_LOOKBACK_DAYS = 180;

/** Timeline types whose payload carries something worth showing as a next step. */
const NOTE_ACTIVITY_TYPES = new Set(["note", "call_logged", "email_sent", "voice_note"]);

/**
 * Pulls a one-line summary out of an activity payload. The key differs by type
 * (addLeadNote writes `note`, logged calls write `summary`, logged emails write
 * `subject`) — see src/lib/pipeline/notes.ts.
 */
function noteTextOf(activity: Activity): string | null {
  const payload = (activity.payload ?? {}) as Record<string, unknown>;
  for (const key of ["note", "summary", "subject", "transcript", "notes"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/**
 * lead id → newest note text. `activities` arrives newest-first from
 * leadActivitySince, so the first hit per lead is the latest one.
 */
function latestNotesByLead(activities: Activity[]): Record<string, string> {
  const byLead: Record<string, string> = {};
  for (const activity of activities) {
    const leadId = activity.lead_id;
    if (!leadId || byLead[leadId]) continue;
    if (!NOTE_ACTIVITY_TYPES.has(activity.type)) continue;
    const text = noteTextOf(activity);
    if (text) byLead[leadId] = text;
  }
  return byLead;
}

/**
 * The intake list (blueprint §11, canvas 10a–10c) — everyone who is in the
 * pipeline but is not yet a client, as one filterable list a firm can read as
 * a table, a board by stage, or a board by owner.
 *
 * All data fetching stays in this server component. `listStages()` /
 * `listIntakeLeads()` / `listMemberDirectory()` / `leadActivitySince()` are
 * RLS-scoped through the forced-scoped client, so the rows are exactly what the
 * signed-in caller's active org may see, and the stage set is whatever
 * `crm_stage` holds for that firm — never a hardcoded pipeline.
 *
 * THREE-STATE, not two (AGENTS.md): a failed lead read renders the error card.
 * "Nobody is in intake" is only ever printed when the query genuinely came back
 * empty. Telling a firm their Monday queue is clear while the read is broken is
 * the single worst thing this page could do.
 *
 * Ported from lectual src/app/(intake)/intake/page.tsx; in lectual.app it
 * replaces the Leads list and renders inside the app shell.
 */
export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<IntakeSearchParams>;
}) {
  // Next 16: searchParams is a Promise and must be awaited before it is read.
  const params = await searchParams;
  const filters = parseIntakeFilters(params);
  const viewState = parseIntakeViewState(params);

  // One clock for the whole render: the note window, every derived number, and
  // the client's own re-derivations after an optimistic write all read the same
  // instant, so the top-bar line can never disagree with the row it counts.
  const now = new Date();

  // Best-effort, started (not awaited) here so it runs alongside the reads
  // below; the `.catch` is attached immediately so a rejection is never an
  // unhandled one. An unresolved directory costs owner NAMES, not owner data —
  // the row still shows whether someone is assigned — which is a much smaller
  // failure than a dead page.
  const membersPromise: Promise<MemberIdentity[]> = listMemberDirectory().catch(() => []);

  const sinceIso = new Date(now.getTime() - NOTE_LOOKBACK_DAYS * 86_400_000).toISOString();
  // Same best-effort treatment: "Next step" degrades from the latest note to
  // the factual reply state rather than taking the list down.
  const notesPromise: Promise<Activity[]> = leadActivitySince(sinceIso).catch(() => []);

  // What is waiting on Rebecca, per lead. The loader reports an unreachable
  // queue as `unavailable` (never as "nothing pending"); the catch is only for
  // an unexpected throw, which must read the same way.
  const approvalsPromise: Promise<LeadPendingApprovals> = loadPendingApprovalsByLead().catch(
    (): LeadPendingApprovals => ({ status: "unavailable" }),
  );

  // The Stage Keeper's recent moves, for the chip and the "Agent moves" filter. Two states: a read
  // that failed is `unavailable`, which the workspace says out loud and never filters on.
  const agentMovesPromise: Promise<AgentMovesRead> = getFirmTimeZone()
    .then((tz) => loadAgentMoves(now, tz))
    .catch((): AgentMovesRead => ({ status: "unavailable" }));

  // The Lawmatics-import stage flags, for the card's "why" line and the "Needs a stage decision" filter. Two states.
  const decisionsPromise: Promise<StageDecisionsRead> = loadStageDecisions().catch((): StageDecisionsRead => ({ status: "unavailable" }));

  let stages: Stage[] = [];
  let leads: Lead[] = [];
  let loadFailed = false;

  // Stages and leads share one try: intake scope is derived FROM the stages, so
  // without them there is no honest list to draw — only a misleading one.
  try {
    stages = await listStages();
    leads = await listIntakeLeads(stages);
  } catch (err) {
    // The cause is for the server log only; the page says one fixed sentence.
    console.error("[intake] the lead list could not be read:", err instanceof Error ? err.message : "unknown error");
    loadFailed = true;
  }

  const [members, noteActivity, pendingApprovals, agentMoves, decisions] = await Promise.all([membersPromise, notesPromise, approvalsPromise, agentMovesPromise, decisionsPromise]);

  if (loadFailed) {
    return (
      <div className="intake-root">
        <LeadsLoadFailed />
      </div>
    );
  }

  const columns = inPipelineOrder(intakeStages(stages));

  if (columns.length === 0) {
    return (
      <div className="intake-root">
        <NoLeadStages />
      </div>
    );
  }

  // Time on cards (§13.1). Two reads: this week's entries for the leads on
  // screen, and the caller's own open timer (which may have started before the
  // week began, so it is fetched separately rather than assumed to be in the
  // window).
  //
  // Best-effort, but with an EXPLICIT unknown rather than a silent zero: a
  // failure leaves `time` null and every chip renders an em dash. "0m" over a
  // broken read would tell the firm nobody has touched a lead all week when
  // somebody has — the same three-state rule the queue taught us (AGENTS.md).
  const leadNames: Record<string, string> = {};
  for (const lead of leads) {
    leadNames[lead.id] = `${lead.first_name} ${lead.last_name}`.trim() || lead.email;
  }
  let time: IntakeTime | null = null;
  try {
    const [entries, running] = await Promise.all([
      listForLeads(
        leads.map((lead) => lead.id),
        startOfWeek(now),
      ),
      runningForMe(),
    ]);
    time = buildIntakeTime({ entries, running, now, leadNames });

    // §13.3's 8-hour stale-timer nudge, "checked on page load, no cron".
    // The running row is already in hand from the chip's own read, so this
    // costs no extra query. The producer never throws and dedupes on
    // entry_id, so refreshing this page cannot raise a second nudge for the
    // same timer — and it nudges the entry's OWNER, who on this path is the
    // caller, so one person's refresh never rings somebody else's bell.
    if (running) await notifyTimeRunning([running], now);
  } catch {
    time = null;
  }

  // Recorded facts for the sequence-cold and day-10 rules. `unavailable` (or a throw)
  // builds the rows without them, so the existing rules run and nothing is guessed cold.
  const factsRead: TemperatureFactsRead = await loadTemperatureFacts(leads, stages).catch(
    (): TemperatureFactsRead => ({ status: "unavailable" }),
  );

  // The "Reconcile stages" link is for the admin tier; the page and its actions check the role again.
  const session = await resolveFirmSession().catch(() => null);
  const showReconcile = session?.kind === "ok" && canReconcile(session.role);

  const rows = buildIntakeRows({
    leads,
    stages,
    members,
    latestNoteByLeadId: latestNotesByLead(noteActivity),
    factsByLeadId: factsRead.status === "ok" ? factsRead.byLead : undefined,
    agentMoveByLeadId: agentMoves.status === "ok" ? agentMoves.chips : undefined,
    decisionByLeadId: decisions.status === "ok" ? decisions.byLead : undefined,
    now,
  });

  return (
    <div className="intake-root" data-tour="intake-board">
    <IntakeWorkspace
      rows={rows}
      stages={stages}
      intakeStages={columns}
      members={members}
      initialFilters={filters}
      initialViewState={viewState}
      time={time}
      now={now.toISOString()}
      pendingApprovals={pendingApprovals}
      showReconcile={showReconcile}
      agentMoves={agentMoves.status === "ok" ? { status: "ok", truncated: agentMoves.truncated } : { status: "unavailable" }}
      stageDecisions={decisions.status === "ok" ? { status: "ok", truncated: decisions.truncated } : { status: "unavailable" }}
    />
    </div>
  );
}
