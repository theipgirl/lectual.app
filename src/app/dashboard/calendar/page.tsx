import Link from "next/link";
import { listTasks, listUpcomingDeadlines } from "@/lib/matters";
import { buildCalendarRows, groupCalendarRows } from "@/lib/matters/calendar-rows";
import { formatCivilDate } from "@/lib/matters/ip-fields";

export const dynamic = "force-dynamic";

/**
 * Ported from lectual src/app/(firm)/dashboard/calendar/page.tsx: the same two
 * sources (open docket deadlines, open task due dates), the same merge and
 * grouping, re-skinned. An agenda, not a month grid: there is no booking or
 * external-calendar source yet, and a grid of empty days would imply a
 * completeness this page doesn't have. An empty agenda reads as "nothing due"
 * only when both reads succeeded.
 */
export default async function CalendarPage() {
  const now = new Date();
  const [deadlinesS, tasksS] = await Promise.allSettled([listUpcomingDeadlines({}), listTasks({ status: "open" })]);
  const deadlines = deadlinesS.status === "fulfilled" ? deadlinesS.value : null;
  const tasks = tasksS.status === "fulfilled" ? tasksS.value : null;

  const partialNote =
    deadlines === null && tasks === null
      ? "Deadlines and tasks couldn't be loaded. Try again shortly."
      : deadlines === null
        ? "Docket dates couldn't be loaded; showing task due dates only."
        : tasks === null
          ? "Tasks couldn't be loaded; showing docket dates only."
          : null;

  const rows = buildCalendarRows(deadlines ?? [], tasks ?? [], now);
  const groups = groupCalendarRows(rows, now);
  const unconfirmed = new Set((deadlines ?? []).filter((d) => !d.attorney_confirmed).map((d) => `d-${d.id}`));

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Calendar</div>
          <h1 className="lx-h1">Agenda</h1>
          <p className="lx-sub">
            Docket deadlines and task due dates. Consult bookings aren&apos;t connected yet, so this is not the firm&apos;s whole schedule.
          </p>
        </div>
      </div>

      {partialNote && (
        <p className="lx-banner lx-banner-warn" style={{ margin: 0 }}>
          {partialNote}
        </p>
      )}

      {groups.length === 0 ? (
        !partialNote && (
          <div className="lx-card lx-empty-card">
            <h2 className="lx-h2" style={{ fontSize: 25 }}>Nothing on the docket or task list</h2>
            <p className="lx-note" style={{ margin: 0 }}>
              Deadlines docketed on a matter and tasks with a due date show up here.
            </p>
          </div>
        )
      ) : (
        groups.map((g) => (
          <section key={g.key} className="lx-card lx-band" aria-labelledby={`cal-${g.key}`}>
            <header className="lx-band-head">
              <h2 id={`cal-${g.key}`} className="lx-h2" style={g.key === "overdue" ? { color: "var(--wine)" } : undefined}>
                {g.label}
              </h2>
              <span className="lx-note">{g.rows.length}</span>
            </header>
            <ul className="lx-list" style={{ padding: "0 18px 8px" }}>
              {g.rows.map((r) => (
                <li key={r.key} className="lx-task">
                  <span style={{ minWidth: 0 }}>
                    <Link href={r.href} className="lx-rowlink">
                      {r.name}
                    </Link>
                    {unconfirmed.has(r.key) && (
                      <span className="lx-pill lx-pill-warn" style={{ marginLeft: 8 }} title="Calculated or entered, not yet confirmed by an attorney">
                        Unconfirmed
                      </span>
                    )}
                    <span className="lx-note" style={{ display: "block" }}>
                      {r.source === "deadline" ? `Docket · ${r.detail}` : "Task"}
                    </span>
                  </span>
                  <span className={`lx-pill ${r.overdueDays > 0 ? "lx-pill-risk" : "lx-pill-mute"}`}>
                    {r.overdueDays > 0 ? `${r.overdueDays}d overdue` : formatCivilDate(r.dueDate)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
