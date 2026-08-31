import Link from "next/link";

import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Shell } from "@/components/Shell";
import { requireSession } from "@/lib/auth/session";
import { civilDaysBetween } from "@/lib/deadlines/urgency";
import {
  courtCivilDate,
  courtToday,
  formatDocketDateTime,
  formatDocketDateWithYear,
} from "@/lib/format/date";
import { DEMAND_TITLE_PREFIX, listDemands, type Demand } from "@/lib/tasks";

/**
 * `/demands` — the demand queue.
 *
 * WHY THIS PAGE EXISTS. A settlement demand that never goes out is the firm's
 * own money sitting still: roughly 20% of a settlement, on cases that settle
 * around $10,000. Nothing in the schema models a demand, so nothing anywhere
 * makes a stalled one visible, and a case can sit for months without anybody
 * noticing that the next move was always ours.
 *
 * WHAT IT ACTUALLY READS — AND THE SMELL IT INHERITS. `listDemands()` reads
 * `crm_task` rows of type `custom` whose title begins `"Demand: "`. That string
 * convention is a deliberate interim, documented at length in `@/lib/tasks`:
 * `crm_demand` is deferred v2 schema, schema for this product lives in another
 * repository, and shipping the queue on a task title is what makes it useful
 * on day one rather than next quarter. The cost is stated on this page too, in
 * the card footer, rather than being known only to whoever wrote the library —
 * a renamed task silently leaves this queue, and nobody gets an alert about it.
 *
 * THE COLUMN THAT MATTERS IS "WAITING". A demand queue sorted by due date
 * answers "what is next"; this queue has to answer "what has been ignored
 * longest", which is a different question with a different answer. So the age
 * of the row is computed from `created_at` in the court's own timezone, it is
 * the sort key, and the oldest is at the top where it cannot be scrolled past.
 *
 * NO `org_id` FILTER. RLS scopes the read on the caller's `active_org_id`
 * claim, and this page adds no query of its own.
 */

export const dynamic = "force-dynamic";

/** How long a demand has been sitting, in whole days, in court time. */
function daysWaiting(demand: Demand, today: string): number | null {
  const opened = courtCivilDate(demand.created_at);
  if (!opened) return null;
  const days = civilDaysBetween(opened, today);
  return days < 0 ? 0 : days;
}

/**
 * Emphasis bands for age. These are the firm's own impatience, not a rule:
 * nothing legal turns on a demand being 30 days old, so the tone shifts and the
 * text says the number, rather than a colour standing in for a judgement.
 */
function ageTone(days: number | null): "overdue" | "soon" | "neutral" {
  if (days === null) return "neutral";
  if (days >= 30) return "overdue";
  if (days >= 14) return "soon";
  return "neutral";
}

export default async function DemandsPage() {
  const session = await requireSession();

  if (session.status !== "ok") {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="grid w-full max-w-lg gap-3 rounded-lg border border-border bg-surface p-7 shadow-[var(--shadow)]">
          <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted">Lectual</p>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {session.status === "signed-out" ? "Signed out" : "No firm access yet"}
          </h1>
          <p className="text-sm leading-relaxed text-ink-2">
            {session.status === "signed-out"
              ? "Sign in with a magic link to see the demand queue."
              : "This account is signed in but isn't a member of a Lectual firm workspace."}
          </p>
          <Link
            href="/sign-in/"
            className="justify-self-start rounded-sm bg-accent px-4 py-2.5 text-sm font-bold text-accent-ink"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  const today = courtToday();
  const result = await Promise.allSettled([listDemands({ status: "open" })]);
  // `undefined`, never `[]`. "The queue could not be read" and "no demand is
  // waiting" are opposite statements, and one of them is good news.
  const demands = result[0].status === "fulfilled" ? result[0].value : undefined;

  const rows = (demands ?? [])
    .map((demand) => ({ demand, days: daysWaiting(demand, today) }))
    // Longest-waiting first. An undated row keeps its place by age; nothing
    // drops out of this list for want of a follow-up date.
    .sort((a, b) => (b.days ?? -1) - (a.days ?? -1));

  const stale = rows.filter((row) => (row.days ?? 0) >= 30).length;

  return (
    <Shell
      firmName={session.orgName}
      userLabel={session.user.email}
      roleLabel={session.actingAsStaff ? `${session.role} · Lectual staff` : session.role}
    >
      <div className="grid gap-4">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Demands</h1>
          <p className="font-mono text-xs text-muted">{formatDocketDateWithYear(today)}</p>
          <p className="ml-auto font-mono text-sm tabular-nums text-ink-2">
            {demands === undefined ? (
              <>
                <span aria-hidden="true">— waiting</span>
                <span className="sr-only">The demand queue could not be read.</span>
              </>
            ) : (
              <>
                {rows.length} waiting
                {stale > 0 ? (
                  <>
                    {" · "}
                    <span className="font-bold text-overdue">{stale} over 30 days</span>
                  </>
                ) : null}
              </>
            )}
          </p>
        </header>

        <Card
          eyebrow="Worklist"
          title="Cases waiting on a demand"
          footer={
            <span>
              A demand is a task titled{" "}
              <code className="font-mono text-ink-2">{DEMAND_TITLE_PREFIX}…</code> on a matter —
              an interim convention until a demand table exists. Rename one of those tasks and it
              leaves this queue silently, so treat this count as a floor.
            </span>
          }
        >
          {demands === undefined ? (
            <EmptyState
              tone="warning"
              title="The demand queue could not be read"
              description="This is a failure, not an empty queue. Nothing here says anything about what is waiting — reload before concluding that nothing is."
            />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No demands waiting"
              description="Nothing on the docket is sitting behind a demand right now. New ones appear here as soon as a task titled 'Demand: …' is opened on a matter."
            />
          ) : (
            <ul className="grid gap-2">
              {rows.map(({ demand, days }) => (
                <li
                  key={demand.id}
                  className="grid gap-1 rounded-sm border border-border bg-surface px-3 py-2"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Badge tone={ageTone(days)} dot>
                      {days === null
                        ? "age unknown"
                        : days === 0
                          ? "opened today"
                          : days === 1
                            ? "waiting 1 day"
                            : `waiting ${days} days`}
                    </Badge>
                    <span className="min-w-0 flex-1 text-sm text-ink">{demand.subject}</span>
                  </div>

                  <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs text-muted">
                    {demand.matter_id ? (
                      <Link
                        href={`/matter/${demand.matter_id}/`}
                        className="font-mono font-semibold text-ink-2 underline underline-offset-2"
                      >
                        {demand.matter_number || "matter"}
                      </Link>
                    ) : (
                      <span className="font-mono text-ink-2">{demand.matter_number || "—"}</span>
                    )}
                    {demand.matter_title ? (
                      <span className="min-w-0 truncate">{demand.matter_title}</span>
                    ) : null}
                    <span>
                      {/* Follow-up date, not a court date: a demand queue holds
                          the firm's own intentions, and none of these dates is
                          an obligation to a court. */}
                      {demand.due_at
                        ? `follow up ${formatDocketDateTime(demand.due_at)}`
                        : "no follow-up date"}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </Shell>
  );
}
