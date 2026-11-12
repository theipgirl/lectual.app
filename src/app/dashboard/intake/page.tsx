import { listStages, type Stage } from "@/lib/pipeline";
import type { Lead } from "@/lib/pipeline";
import { listIntakeLeads } from "@/lib/intake/leads";
import { loadLatestNotes, notesIncomplete, NOTE_LOOKBACK_DAYS } from "@/lib/intake/notes-read";
import { loadWorkingFacts } from "@/lib/intake/working-load";
import { classifyLeads } from "@/lib/intake/working";
import { findDuplicates } from "@/lib/intake/duplicates";
import { setDataFrom, type SetData, type LostRead } from "@/lib/intake/sets";
import { listLostLeads, readLostCount, lostStageIds, type LostLeads } from "@/lib/intake/lost";
import { activeOrgModulesOrNull } from "@/lib/org/modules";
import { intakeStages } from "@/lib/intake/scope";
import { inPipelineOrder } from "@/lib/pipeline/stage-order";
import { loadTemperatureFacts, type TemperatureFactsRead } from "@/lib/intake/facts";
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
  let intakeLeads: Lead[] = [];
  let loadFailed = false;

  // Stages and leads share one try: intake scope is derived FROM the stages, so
  // without them there is no honest list to draw — only a misleading one.
  try {
    stages = await listStages();
    intakeLeads = await listIntakeLeads(stages);
  } catch (err) {
    // The cause is for the server log only; the page says one fixed sentence.
    console.error("[intake] the lead list could not be read:", err instanceof Error ? err.message : "unknown error");
    loadFailed = true;
  }

  const [members, pendingApprovals, agentMoves, decisions] = await Promise.all([membersPromise, approvalsPromise, agentMovesPromise, decisionsPromise]);

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

  // The sets. The Working rule reads its facts once (activity, proposals, consults, booth; approvals are the queue read the
  // page already holds) and classifies every lead in the list. Lost leads are NOT in the list (their own scope and reads: a
  // head count for the chip every render, the lead list only when ?set=lost), so the rail badge and the Pipeline are untouched.
  const lostView = viewState.set === "lost";
  // A module list that could not be read is "unknown", not "off": the consult read is then UNAVAILABLE (missing data
  // never hides a lead), where a firm without the Mailboxes feature simply has no consults.
  const modules = await activeOrgModulesOrNull().catch(() => null);
  const mailboxOn = modules ? modules.includes("mailbox") : null;
  const [workingFacts, lostCount, lostLeads] = await Promise.all([
    loadWorkingFacts({ leadIds: intakeLeads.map((l) => l.id), stages, approvals: pendingApprovals, mailboxOn: mailboxOn ?? false, mailboxUnknown: mailboxOn === null }),
    readLostCount(stages),
    lostView ? listLostLeads(stages) : Promise.resolve<LostLeads | null>(null),
  ]);
  const stageCategory = (id: string | null) => stages.find((s) => s.id === id)?.category ?? null;
  const setData: SetData = setDataFrom(classifyLeads({ leads: intakeLeads, stages, facts: workingFacts }), intakeLeads, stageCategory);
  const lost: LostRead = lostCount;
  // The leads the page draws: the list, or (Lost chosen) the lost leads. A failed lost read draws none and says so.
  const leads: Lead[] = lostView ? (lostLeads && lostLeads.status === "ok" ? lostLeads.leads : []) : intakeLeads;
  const lostFailed = lostView && (!lostLeads || lostLeads.status !== "ok");
  // Possible duplicates among the OPEN leads already loaded (no query, nothing merged).
  const duplicates = findDuplicates(leads, intakeLeads, stages);
  const lostShown = lostLeads && lostLeads.status === "ok" ? { shown: lostLeads.leads.length, total: lostLeads.total } : null;

  // "Next step" degrades from the latest note to the factual reply state rather than taking the list down, but a FAILED
  // or cut-short read is reported, never turned into "no activity". Only the leads on screen are asked about.
  const notes = await loadLatestNotes(sinceIso, leads.map((l) => l.id));

  // Time on cards (§13.1). Two reads: this week's entries for the leads on
  // screen, and the caller's own open timer (which may have started before the
  // week began, so it is fetched separately rather than assumed to be in the
  // window).
  //
  // Best-effort, but with an EXPLICIT unknown rather than a silent zero: a
  // failure leaves `time` null and every chip renders an em dash. "0m" over a
  // failed read would tell the firm nobody has touched a lead all week when
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
    latestNoteByLeadId: notes.status === "ok" ? notes.byLead : undefined,
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
      lostStages={stages.filter((s) => lostStageIds(stages).includes(s.id))}
      setData={setData}
      lost={lostView && lostFailed ? { status: "unavailable" } : lost}
      lostView={lostView}
      lostFailed={lostFailed}
      notesUnavailable={notesIncomplete(notes)}
      duplicates={duplicates}
      lostCut={lostShown && lostShown.total > lostShown.shown ? lostShown : null}
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
