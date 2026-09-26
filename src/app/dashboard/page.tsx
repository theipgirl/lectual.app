import Link from "next/link";
import { resolveFirmSession } from "@/lib/firm/session";
import { getScopedClient } from "@/lib/db/scoped-client";
import { loadActiveQueue, type QueueLoad } from "@/lib/queue/load";
import { orgHasModule } from "@/lib/org/modules";
import { listLeads, type Lead } from "@/lib/pipeline";
import { listMatters, listTasks, listUpcomingDeadlines, summarizeDocket } from "@/lib/matters";
import { buildCalendarRows } from "@/lib/matters/calendar-rows";
import { BAND_COPY } from "@/lib/matters/worklist";
import { formatCivilDate } from "@/lib/matters/ip-fields";
import { laneOf, laneReason } from "@/lib/leads/lane";
import { buildPriorities, type PriorityTag } from "@/lib/today/priorities";
import { AGENT_DEFS, type AgentId } from "@/lib/agents/types";
import { relativeTime } from "@/lib/relative-time";

export const dynamic = "force-dynamic";

const TAG: Record<PriorityTag, { label: string; tone: string }> = {
  overdue: { label: "Overdue", tone: "lx-pill-risk" },
  deadline: { label: "Due soon", tone: "lx-pill-warn" },
  approval: { label: "Approve", tone: "lx-pill-ox" },
  hot: { label: "Hot lead", tone: "lx-pill-warn" },
  quiet: { label: "Gone quiet", tone: "lx-pill-mute" },
};

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
  const hasAgents = await orgHasModule("agents");

  const [queueS, leadsS, mattersS, deadlinesS, tasksS, runsS] = await Promise.allSettled([
    loadActiveQueue(),
    listLeads(),
    listMatters(),
    listUpcomingDeadlines({ limit: 100 }),
    listTasks({ status: "open" }),
    hasAgents
      ? getScopedClient().then(async (sb) => {
          const { data, error } = await sb
            .from("agent_run")
            .select("id, agent, status, started_at, drafts_out, summary")
            .order("started_at", { ascending: false })
            .limit(6);
          if (error) throw error;
          return data ?? [];
        })
      : Promise.resolve(null),
  ]);

  // loadActiveQueue never throws; a rejection would be a bug, shown as unavailable.
  const queue: QueueLoad = queueS.status === "fulfilled" ? queueS.value : { status: "unavailable", items: [] };
  const leads: Lead[] | null = leadsS.status === "fulfilled" ? leadsS.value : null;
  const matters = mattersS.status === "fulfilled" ? mattersS.value : null;
  const deadlines = deadlinesS.status === "fulfilled" ? deadlinesS.value : null;
  const tasks = tasksS.status === "fulfilled" ? tasksS.value : null;
  const runs = runsS.status === "fulfilled" ? runsS.value : undefined;

  const docket = matters ? summarizeDocket(matters, now) : null;
  const rows = buildCalendarRows(deadlines ?? [], tasks ?? [], now);
  const next14 = rows.filter((r) => r.overdueDays > 0 || Date.parse(`${r.dueDate}T00:00:00Z`) - now.getTime() <= 14 * 86_400_000);
  const overdue = rows.filter((r) => r.overdueDays > 0).length;
  const calendarNote =
    deadlines === null && tasks === null
      ? "Deadlines and tasks couldn't be loaded. Try again shortly."
      : deadlines === null
        ? "Docket dates couldn't be loaded; showing task dates only."
        : tasks === null
          ? "Tasks couldn't be loaded; showing docket dates only."
          : null;

  const weekAgo = now.getTime() - 7 * 86_400_000;
  const newLeads = leads ? leads.filter((l) => Date.parse(l.created_at) >= weekAgo) : null;
  const hotLeads = (leads ?? [])
    .filter((l) => laneOf(l) === "hot" && !l.assigned_to && Date.parse(l.created_at) >= now.getTime() - 14 * 86_400_000)
    .map((l) => ({ id: l.id, name: `${l.first_name} ${l.last_name}`.trim() || l.business_name || l.email, reason: laneReason(l.ai_summary) }));

  const priorities = buildPriorities({
    deadlines: rows,
    queue: queue.status === "ok" ? queue.items : [],
    stalled: docket?.stalled ?? [],
    hotLeads,
    now,
  });

  const queueValue = queue.status === "ok" ? queue.items.length : null;
  const queueFailed = queue.status === "unavailable" ? "Queue unreachable, so we can't say" : "No queue connected yet";
  const dateLine = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">
            {session.org.name} · {dateLine}
          </div>
          <h1 className="lx-h1">
            Good {greeting(now.getHours())}, {session.displayName.split(" ")[0]}.
          </h1>
        </div>
      </div>

      <div className="lx-kpis">
        <Kpi label="Waiting on you" value={queueValue} sub="drafts to approve" href="/dashboard/queue/" failed={queueFailed} />
        <Kpi label="Overdue" value={calendarNote && deadlines === null && tasks === null ? null : overdue} sub="deadlines and tasks past due" href="/dashboard/calendar/" />
        <Kpi label="Our move" value={docket ? docket.waitingOn.firm : null} sub={docket ? `of ${docket.open} open matters` : ""} href="/dashboard/matters/?seg=firm" />
        <Kpi label="New leads" value={newLeads ? newLeads.length : null} sub="in the last 7 days" href="/dashboard/leads/" />
      </div>

      {queue.status === "unavailable" && (
        <p className="lx-banner lx-banner-risk" style={{ margin: 0 }}>
          We couldn&apos;t reach the approval queue, so we don&apos;t know what&apos;s waiting. This is not an empty queue. Check again shortly.
        </p>
      )}

      <div className="lx-split">
        <div className="lx-col">
          <section className="lx-card" style={{ padding: 18, display: "grid", gap: 10 }}>
            <h2 className="lx-h2" style={{ fontSize: 25 }}>
              Top of the list
            </h2>
            {priorities.length === 0 ? (
              <p className="lx-note" style={{ margin: 0 }}>
                {queue.status === "ok" && !calendarNote && docket
                  ? "Nothing overdue, nothing waiting on you, nothing gone quiet."
                  : "Nothing to rank from what loaded. Some sources are unavailable, so this may not be the whole picture."}
              </p>
            ) : (
              <ol className="lx-list lx-prio">
                {priorities.map((p) => (
                  <li key={p.key}>
                    <span className={`lx-pill ${TAG[p.tag].tone}`}>{TAG[p.tag].label}</span>
                    <span style={{ minWidth: 0 }}>
                      <Link href={p.href} className="lx-rowlink">
                        {p.title}
                      </Link>
                      {p.detail && <span className="lx-note" style={{ display: "block" }}>{p.detail}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="lx-card" style={{ padding: 18, display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
              <h2 className="lx-h2" style={{ fontSize: 25 }}>
                Next two weeks
              </h2>
              <Link href="/dashboard/calendar/" className="lx-note">
                Calendar →
              </Link>
            </div>
            {calendarNote && <p className="lx-note" style={{ margin: 0, color: "var(--warn)" }}>{calendarNote}</p>}
            {next14.length === 0 ? (
              !calendarNote && <p className="lx-note" style={{ margin: 0 }}>Nothing due in the next two weeks.</p>
            ) : (
              <ul className="lx-list">
                {next14.slice(0, 8).map((r) => (
                  <li key={r.key} className="lx-task">
                    <span style={{ minWidth: 0 }}>
                      <Link href={r.href} className="lx-rowlink">
                        {r.name}
                      </Link>
                      <span className="lx-note" style={{ display: "block" }}>{r.source === "deadline" ? `Docket · ${r.detail}` : "Task"}</span>
                    </span>
                    <span className={`lx-pill ${r.overdueDays > 0 ? "lx-pill-risk" : "lx-pill-mute"}`}>
                      {r.overdueDays > 0 ? `${r.overdueDays}d overdue` : formatCivilDate(r.dueDate)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="lx-col lx-col-aside">
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
              </>
            ) : (
              <p className="lx-note" style={{ margin: 0 }}>Matters couldn&apos;t be loaded.</p>
            )}
          </section>

          {hasAgents && (
            <section className="lx-card lx-aside">
              <div className="lx-label">Agents overnight</div>
              {runs === undefined ? (
                <p className="lx-note" style={{ margin: 0 }}>The run log couldn&apos;t be loaded.</p>
              ) : !runs || runs.length === 0 ? (
                <p className="lx-note" style={{ margin: 0 }}>No runs yet. Switch agents on in Agents.</p>
              ) : (
                <ul className="lx-list">
                  {runs.map((r) => (
                    <li key={r.id} style={{ padding: "8px 0", display: "grid", gap: 2 }}>
                      <span style={{ color: "var(--ink)", fontWeight: 500 }}>
                        {AGENT_DEFS[r.agent as AgentId]?.name ?? r.agent}
                        <span className="lx-note"> · {relativeTime(r.started_at)}</span>
                      </span>
                      <span className="lx-note" style={r.status === "error" ? { color: "var(--wine)" } : undefined}>
                        {r.status === "error" ? "Failed. See Agents." : r.summary ?? r.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Link href="/dashboard/agents/" className="lx-note">
                Agents →
              </Link>
            </section>
          )}

          <div className="lx-upl">
            <span aria-hidden="true">§</span>
            <div>
              <b style={{ color: "var(--ox)" }}>The one rule.</b> Nothing reaches a client without a person approving it. Agents draft; the
              approval queue is the only way out of the firm.
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
