import Link from "next/link";
import { resolveFirmSession } from "@/lib/firm/session";
import { getScopedClient } from "@/lib/db/scoped-client";
import { loadActiveQueue, type QueueLoad } from "@/lib/queue/load";
import { mineQueue } from "@/lib/queue/mine-load";
import { orgHasModule } from "@/lib/org/modules";
import { listLeads, type Lead } from "@/lib/pipeline";
import { listMatters, listTasks, listUpcomingDeadlines, summarizeDocket } from "@/lib/matters";
import { buildCalendarRows } from "@/lib/matters/calendar-rows";
import { BAND_COPY } from "@/lib/matters/worklist";
import { laneOf, laneReason } from "@/lib/leads/lane";
import { hourInZone } from "@/lib/today/priorities";
import { greetingName, greetingSuffix } from "@/lib/today/greeting-name";
import { buildNeedsYou } from "@/lib/today/needs-you";
import { loadConnectionsNeedingReauth, loadDeadlinesClosedSince, loadOpenQuotes, loadUnreviewedSubmissions } from "@/lib/today/load-needs-you";
import { civilInZone, deadlinesMetThisMonth, mattersOpenedThisMonth, monthQueryFloor, monthStartCivil } from "@/lib/today/outcomes";
import { getFirmTimeZone } from "@/lib/org/profile";
import { loadAutopilot, type AutopilotLoad } from "@/lib/agents/autopilot";
import {
  autopilotStateLine,
  canPauseAutopilot,
  canResumeAutopilot,
  DEFAULT_MINUTES_PER_TASK,
  estimateAssumption,
  estimateHoursSaved,
} from "@/lib/agents/autopilot-rules";
import { buildRunDigest, type DigestRun } from "@/lib/agents/digest";
import { listMemberDirectory } from "@/lib/members/directory";
import { leadDisplayName } from "@/lib/matters/client-name";
import { civilDate } from "@/lib/matters/calendar-rows";
import { deadlineKindLabel, deadlineNeedsReview } from "@/lib/matters/deadline-rules";
import { AutopilotControl } from "@/components/agents/AutopilotControl";
import { RunDigestList } from "@/components/agents/RunDigestList";
import { GetSetUpCard } from "@/components/setup/GetSetUpCard";
import { NeedsYouSection } from "@/components/today/NeedsYouSection";
import { AddNameLink } from "@/components/account/AddNameLink";
import { TodayConsults } from "@/components/calendar/TodayConsults";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { ASSISTANTS_NAME, OUR_TURN } from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle("Today") };

export const dynamic = "force-dynamic";

function greeting(hour: number): string {
  return hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
}

/** A number, or an honest "—" with the reason, never a zero from a failed read. */
function Kpi({ label, value, sub, href, failed }: { label: string; value: number | null; sub: string; href: string; failed?: string }) {
  return (
    <Link href={href} className="lx-card lx-kpi">
      <span className="lx-label">{label}</span>
      <span className="lx-kpi-value">{value === null ? "—" : value}</span>
      <span className="lx-note">{value === null ? failed ?? "Couldn't load" : sub}</span>
    </Link>
  );
}

/**
 * Today. Every read is independent (allSettled): one dead source never blanks
 * the others, and a failed read says so instead of printing a zero. A home
 * page that reports "0" for a firm doing real work is the same lie as an
 * unreachable queue rendering "all caught up".
 */
export default async function TodayPage() {
  const session = await resolveFirmSession();
  if (session.kind !== "ok") return null; // the layout already handled this
  const now = new Date();
  const [hasAgents, tz] = await Promise.all([orgHasModule("agents"), getFirmTimeZone()]);
  const monthFloor = monthQueryFloor(now, tz);

  const [queueS, leadsS, mattersS, deadlinesS, tasksS, runsS, autopilotS, quotesS, connectionsS, submissionsS, closedS, membersS] =
    await Promise.allSettled([
      loadActiveQueue(),
      listLeads(),
      listMatters(),
      listUpcomingDeadlines({ limit: 100 }),
      listTasks({ status: "open" }),
      hasAgents
        ? getScopedClient().then(async (sb) => {
            // This month's runs, and at least the last 24 hours: the digest and the estimate.
            const since = new Date(Math.min(Date.parse(monthFloor), now.getTime() - 86_400_000)).toISOString();
            const { data, error } = await sb
              .from("agent_run")
              .select("agent, status, started_at, finished_at, items_in, drafts_out, summary, error")
              .gte("started_at", since)
              .order("started_at", { ascending: false })
              .limit(2000);
            if (error) throw error;
            return (data ?? []) as DigestRun[];
          })
        : Promise.resolve(null),
      hasAgents ? loadAutopilot() : Promise.resolve(null),
      loadOpenQuotes(),
      loadConnectionsNeedingReauth(),
      loadUnreviewedSubmissions(),
      loadDeadlinesClosedSince(monthFloor),
      listMemberDirectory(),
    ]);

  // loadActiveQueue never throws; a rejection would be a bug, shown as unavailable.
  const queue: QueueLoad = await mineQueue(queueS.status === "fulfilled" ? queueS.value : { status: "unavailable", items: [] }, { userId: session.user.id, role: session.role });
  const leads: Lead[] | null = leadsS.status === "fulfilled" ? leadsS.value : null;
  const matters = mattersS.status === "fulfilled" ? mattersS.value : null;
  const deadlines = deadlinesS.status === "fulfilled" ? deadlinesS.value : null;
  const tasks = tasksS.status === "fulfilled" ? tasksS.value : null;
  // null = no agents module; undefined = the log couldn't be read.
  const runs = runsS.status === "fulfilled" ? runsS.value : undefined;
  const autopilot: AutopilotLoad | null = autopilotS.status === "fulfilled" ? autopilotS.value : { status: "unavailable" };
  const openQuotes = quotesS.status === "fulfilled" ? quotesS.value : { quotes: null, payments: null };
  const connections = connectionsS.status === "fulfilled" ? connectionsS.value : null;
  const submissions = submissionsS.status === "fulfilled" ? submissionsS.value : null;
  const closedDeadlines = closedS.status === "fulfilled" ? closedS.value : null;
  const members = membersS.status === "fulfilled" ? membersS.value : [];

  const docket = matters ? summarizeDocket(matters, now) : null;
  const rows = buildCalendarRows(deadlines ?? [], tasks ?? [], now);
  const overdue = rows.filter((r) => r.overdueDays > 0).length;
  const weekAgo = now.getTime() - 7 * 86_400_000;
  const newLeads = leads ? leads.filter((l) => Date.parse(l.created_at) >= weekAgo) : null;
  const hotLeads = (leads ?? [])
    .filter((l) => laneOf(l) === "hot" && !l.assigned_to && Date.parse(l.created_at) >= now.getTime() - 14 * 86_400_000)
    .map((l) => ({ id: l.id, name: `${l.first_name} ${l.last_name}`.trim() || l.business_name || l.email, reason: laneReason(l.ai_summary) }));

  const digest = hasAgents ? buildRunDigest(runs === undefined ? null : runs ?? [], now, 24) : null;
  const matterOwner = new Map((matters ?? []).map((m) => [m.id, m.assigned_to]));
  const leadName = new Map((leads ?? []).map((l) => [l.id, leadDisplayName(l)]));

  const needs = buildNeedsYou({
    userId: session.user.id,
    now,
    deadlines:
      deadlines?.filter((d) => !deadlineNeedsReview(d, civilDate(now))).map((d) => ({
        id: d.id,
        matterId: d.matter_id,
        name: d.title ?? deadlineKindLabel(d.kind),
        dueDate: d.due_date,
        confirmed: d.attorney_confirmed,
        matterRef: [d.matter_number, d.matter_title].filter(Boolean).join(" · ") || "Docket",
        ownerId: matterOwner.get(d.matter_id) ?? null,
      })) ?? null,
    tasks:
      tasks
        ?.filter((t) => t.due_at)
        .map((t) => ({
          id: t.id,
          title: t.title,
          dueDate: civilDate(new Date(t.due_at as string)),
          href: t.matter_id ? `/dashboard/matters/${t.matter_id}/` : t.lead_id ? `/dashboard/leads/${t.lead_id}/` : "/dashboard/calendar/",
          assigneeId: t.assignee_id,
        })) ?? null,
    queue: queue.status === "ok" ? { status: "ok", items: queue.items } : { status: queue.status },
    quotes:
      openQuotes.quotes?.map((q) => ({
        id: q.id,
        title: q.title,
        status: q.status,
        expiresAt: q.expires_at,
        acceptedAt: q.accepted_at,
        clientName: q.lead_id ? leadName.get(q.lead_id) ?? null : null,
        createdBy: q.created_by,
      })) ?? null,
    payments: openQuotes.payments,
    agentFailures: digest ? (digest.status === "ok" ? digest.failures : null) : [],
    connections,
    submissions,
    hotLeads,
    stalled: docket ? docket.stalled : null,
  });

  // Outcomes. Each is "—" with why when its source couldn't be read.
  const opened = matters ? mattersOpenedThisMonth(matters, now, tz) : null;
  const met = closedDeadlines ? deadlinesMetThisMonth(closedDeadlines, now, tz) : null;
  const minutes = autopilot?.status === "ok" ? autopilot.state.minutesPerTask : DEFAULT_MINUTES_PER_TASK;
  const monthStart = monthStartCivil(now, tz);
  const estimate = runs ? estimateHoursSaved(runs.filter((r) => civilInZone(new Date(r.started_at), tz) >= monthStart), minutes) : null;

  const paused = autopilot?.status === "ok" && autopilot.state.paused;
  const pausedBy = autopilot?.status === "ok" ? autopilot.state.pausedBy : null;
  const pausedByName = pausedBy ? (members.find((m) => m.userId === pausedBy)?.displayName ?? members.find((m) => m.userId === pausedBy)?.email ?? null) : null;

  const queueValue = queue.status === "ok" ? queue.items.length : null;
  const queueFailed = queue.status === "unavailable" ? "Couldn't check approvals" : "No approvals connected yet";
  const firstName = greetingName({ userId: session.user.id, members, metadata: session.user.user_metadata, email: session.user.email });

  return (
    <>
      <div className="lx-page-head lx-page-head-list">
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 className="lx-h1">
            Good {greeting(hourInZone(now, tz))}
            {greetingSuffix(firstName)}.
          </h1>
          {!firstName && <AddNameLink />}
        </div>
      </div>

      <div className="lx-kpis">
        <Kpi label="Waiting on you" value={queueValue} sub="drafts to approve" href="/dashboard/queue/" failed={queueFailed} />
        <Kpi label="Overdue" value={deadlines === null && tasks === null ? null : overdue} sub="deadlines and tasks past due" href="/dashboard/calendar/" />
        <Kpi label={OUR_TURN} value={docket ? docket.waitingOn.firm : null} sub={docket ? `of ${docket.open} open matters` : ""} href="/dashboard/matters/?seg=firm" />
        <Kpi label="New leads" value={newLeads ? newLeads.length : null} sub="in the last 7 days" href="/dashboard/intake/" />
      </div>

      {queue.status === "unavailable" && (
        <p className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
          We couldn&apos;t reach the approval queue, so we don&apos;t know what&apos;s waiting. Refresh to try again.
        </p>
      )}

      <GetSetUpCard role={session.role} />

      <div className="lx-split">
        <div className="lx-col">
          <TodayConsults />

          <NeedsYouSection needs={needs} queue={queue.status} />
        </div>

        <aside className="lx-col lx-col-aside">
          <section className="lx-card lx-aside">
            <div className="lx-label">This month</div>
            <div className="lx-task" style={{ padding: "2px 0" }}>
              <Link href="/dashboard/matters/">Matters opened</Link>
              <span className="lx-num">{opened ?? "—"}</span>
            </div>
            <div className="lx-task" style={{ padding: "2px 0" }}>
              <Link href="/dashboard/calendar/" title="Deadlines closed as satisfied this month, on or before their due date">
                Deadlines met
              </Link>
              <span className="lx-num">{met ? `${met.met} of ${met.closed}` : "—"}</span>
            </div>
            {hasAgents && (
              <div className="lx-task" style={{ padding: "2px 0" }}>
                <Link href="/dashboard/agents/" title={`est. using ${estimateAssumption(minutes)}`}>
                  Hours saved (est.)*
                </Link>
                <span className="lx-num">{estimate ? estimate.hours : "—"}</span>
              </div>
            )}
            {(opened === null || met === null) && <p className="lx-note" style={{ margin: 0 }}>A figure shown as — couldn&apos;t be read just now.</p>}
            {hasAgents && (
              <p className="lx-note" style={{ margin: 0, fontSize: 12 }}>
                * An estimate, not a measurement: completed agent tasks × your firm&apos;s minutes per task ({estimateAssumption(minutes)}).{" "}
                <Link href="/dashboard/agents/">Change the minutes</Link>
              </p>
            )}
          </section>

          {hasAgents && digest && (
            <section className="lx-card lx-aside">
              <div className="lx-label">Overnight run</div>
              {autopilot?.status === "ok" ? (
                <AutopilotControl
                  compact
                  paused={paused}
                  reason={autopilot.state.reason}
                  stateLine={autopilotStateLine(autopilot.state, { lastRunAt: digest.status === "ok" ? digest.lastRunAt : null, pausedByName, now, tz })}
                  canPause={canPauseAutopilot(session.role)}
                  canResume={canResumeAutopilot(session.role)}
                />
              ) : autopilot?.status === "unavailable" ? (
                <p className="lx-note" role="alert" style={{ margin: 0, color: "var(--warn)" }}>
                  We couldn&apos;t read whether assistants are paused. Until we can, none of them run.
                </p>
              ) : null}
              <RunDigestList digest={digest} paused={paused} />
              <Link href="/dashboard/agents/" className="lx-note">
                {ASSISTANTS_NAME} →
              </Link>
            </section>
          )}

          <section className="lx-card lx-aside">
            <div className="lx-label">The docket</div>
            {docket ? (
              <>
                {(["firm", "client", "uspto", "court"] as const).filter((w) => w !== "court" || docket.waitingOn.court > 0).map((w) => (
                  <div key={w} className="lx-task" style={{ padding: "2px 0" }}>
                    <Link href={`/dashboard/matters/?seg=${w}`}>{BAND_COPY[w].label}</Link>
                    <span className="lx-num">{docket.waitingOn[w]}</span>
                  </div>
                ))}
                {docket.stalled.length > 0 && (
                  <Link href="/dashboard/matters/?seg=stalled" className="lx-note">
                    {docket.stalled.length} gone quiet →
                  </Link>
                )}
                <Link href="/dashboard/pipeline/" className="lx-note">
                  Pipeline →
                </Link>
              </>
            ) : (
              <p className="lx-note" style={{ margin: 0 }}>Matters couldn&apos;t be loaded.</p>
            )}
          </section>

          <div className="lx-upl">
            <span aria-hidden="true">§</span>
            <div>
              <b style={{ color: "var(--ox)" }}>The one rule.</b> Nothing reaches a client without a person approving it. Assistants draft;
              Approvals is the only way out of the firm.
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
