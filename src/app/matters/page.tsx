import Link from "next/link";

import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { Shell } from "@/components/Shell";
import { requireSession } from "@/lib/auth/session";
import { formatDocketDateWithYear } from "@/lib/format/date";
import { listMatters, type Matter } from "@/lib/matters/read";
import { listMatterStages } from "@/lib/matters/stages";
import { practiceLabel, resolvePractice, type PracticeId } from "@/lib/practice/resolve";

/**
 * `/matters` — every matter in the firm, in one list.
 *
 * The board at `/pipeline/[practice]` answers "where is each case in its
 * lifecycle". This answers a different question the board structurally cannot:
 * "show me all of them". A kanban hides anything without a stage behind a lane,
 * spreads 53 matters across a horizontal scroller, and gives no way to sort or
 * scan. This is the flat, searchable, printable index — the thing the firm's
 * spreadsheet used to be.
 *
 * TWO RULES THIS PAGE EXISTS TO HONOUR
 *
 * 1. Nothing is hidden by default. The unfiltered view is every matter,
 *    including the 22 with `stage_id IS NULL` and every closed one. The counts
 *    in the filter bar are computed from the full set before filtering, so the
 *    page always tells you how many exist even while showing a subset.
 * 2. Closed is shown as closed. A disposed matter is not an alarm — it renders
 *    muted, and its row says "Closed" in words. That mirrors the docket rule in
 *    `lib/deadlines/read.ts`: a closed matter's stale open deadline is not a
 *    live obligation and must never wear red.
 */

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const STATUS_FILTERS = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "on_hold", label: "On hold" },
  { id: "closed", label: "Closed" },
  { id: "unplaced", label: "No stage" },
] as const;

type StatusFilterId = (typeof STATUS_FILTERS)[number]["id"];

function firstParam(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function resolveFilter(raw: string | undefined): StatusFilterId {
  const match = STATUS_FILTERS.find((f) => f.id === raw);
  return (match ?? STATUS_FILTERS[0]).id;
}

function matchesFilter(matter: Matter, filter: StatusFilterId): boolean {
  switch (filter) {
    case "all":
      return true;
    case "unplaced":
      return matter.stage_id == null;
    default:
      return matter.status === filter;
  }
}

/** Closed covers both the lifecycle status and a terminal stage (PC80/PC90). */
function isClosed(matter: Matter): boolean {
  return matter.status === "closed" || matter.stage?.is_open === false;
}

export default async function MattersPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await requireSession();
  if (session.status !== "ok") {
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <Card eyebrow="Lectual">
          <p className="text-sm text-ink-2">
            <Link href="/sign-in/" className="font-semibold text-accent underline">
              Sign in
            </Link>{" "}
            to see the firm&apos;s matters.
          </p>
        </Card>
      </main>
    );
  }

  const params = await searchParams;
  const filter = resolveFilter(firstParam(params.status));
  const practiceParam = firstParam(params.practice);

  const [mattersResult, stagesResult] = await Promise.allSettled([
    listMatters(),
    listMatterStages(),
  ]);

  const matters =
    mattersResult.status === "fulfilled" ? mattersResult.value : undefined;
  const stages = stagesResult.status === "fulfilled" ? stagesResult.value : undefined;

  const shell = (children: React.ReactNode) => (
    <Shell
      firmName={session.orgName}
      userLabel={session.user.email}
      roleLabel={session.role}
      wide
    >
      {children}
    </Shell>
  );

  if (matters === undefined) {
    return shell(
      <EmptyState
        tone="warning"
        title="Matters could not be loaded"
        description="This is a failure, not an empty caseload. Nothing here says anything about how many matters exist — reload the page before drawing any conclusion."
      />,
    );
  }

  // Counts come from the FULL set, before any filter is applied, so the bar
  // reports what exists rather than what is currently on screen.
  const counts: Record<StatusFilterId, number> = {
    all: matters.length,
    open: matters.filter((m) => m.status === "open").length,
    on_hold: matters.filter((m) => m.status === "on_hold").length,
    closed: matters.filter((m) => m.status === "closed").length,
    unplaced: matters.filter((m) => m.stage_id == null).length,
  };

  const byStatus = matters.filter((m) => matchesFilter(m, filter));

  const practices = new Map<PracticeId, Matter[]>();
  for (const matter of byStatus) {
    const practice = resolvePractice(matter, matter.stage);
    const bucket = practices.get(practice);
    if (bucket) bucket.push(matter);
    else practices.set(practice, [matter]);
  }

  const visiblePractices = [...practices.entries()].filter(
    ([id]) => !practiceParam || id === practiceParam,
  );

  const shownCount = visiblePractices.reduce((n, [, list]) => n + list.length, 0);

  return shell(
    <div className="grid min-w-0 gap-4">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Matters</h1>
        <p className="font-mono text-sm tabular-nums text-muted">
          {shownCount === counts.all
            ? `${counts.all} total`
            : `${shownCount} of ${counts.all}`}
        </p>
        {stages === undefined ? (
          <p role="status" className="text-xs text-soon">
            Stage names unavailable — matters are listed by number instead.
          </p>
        ) : null}
      </header>

      {/* Status filter. Plain links, so every view is bookmarkable, survives a
          reload, and needs no client state on an otherwise server-rendered
          page. */}
      <nav aria-label="Filter matters" className="flex flex-wrap gap-1.5 print:hidden">
        {STATUS_FILTERS.map((f) => {
          const active = f.id === filter;
          const href =
            f.id === "all"
              ? "/matters/"
              : `/matters/?status=${f.id}`;
          return (
            <Link
              key={f.id}
              href={href}
              aria-current={active ? "true" : undefined}
              className={[
                "rounded-[var(--r-sm)] border px-2.5 py-1 text-[13px] font-semibold",
                active
                  ? "border-accent bg-accent text-accent-ink"
                  : "border-border-strong text-ink-2 hover:bg-surface-3",
              ].join(" ")}
            >
              {f.label}{" "}
              <span className="font-mono tabular-nums opacity-70">{counts[f.id]}</span>
            </Link>
          );
        })}
      </nav>

      {shownCount === 0 ? (
        <EmptyState
          title="No matters match this filter"
          description="Every matter is still here — clear the filter to see all of them."
        />
      ) : (
        visiblePractices.map(([practice, list]) => (
          <Card
            key={practice}
            eyebrow={practiceLabel(practice)}
            meta={
              <span className="font-mono text-xs tabular-nums text-muted">
                {list.length}
              </span>
            }
          >
            {/* The table scrolls inside its own container. The page itself must
                never scroll sideways — see the min-w-0 note on the Today page. */}
            <div className="-mx-1 min-w-0 overflow-x-auto">
              <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-[11px] uppercase tracking-[0.08em] text-muted">
                    <th scope="col" className="px-1 py-1.5 font-semibold">
                      Case number
                    </th>
                    <th scope="col" className="px-1 py-1.5 font-semibold">
                      Matter
                    </th>
                    <th scope="col" className="px-1 py-1.5 font-semibold">
                      Stage
                    </th>
                    <th scope="col" className="px-1 py-1.5 font-semibold">
                      Status
                    </th>
                    <th scope="col" className="px-1 py-1.5 font-semibold">
                      Opened
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((matter) => {
                    const closed = isClosed(matter);
                    return (
                      <tr
                        key={matter.id}
                        className={[
                          "border-b border-border align-top last:border-0",
                          closed ? "text-muted" : "text-ink-2",
                        ].join(" ")}
                      >
                        <td className="px-1 py-2">
                          <Link
                            href={`/matter/${matter.id}/`}
                            className="font-mono text-[13px] font-semibold text-accent underline-offset-2 hover:underline"
                          >
                            {matter.matter_number || "—"}
                          </Link>
                        </td>
                        <td className="max-w-[28rem] px-1 py-2">
                          <span className={closed ? "" : "text-ink"}>
                            {matter.title || matter.owner_name || "Untitled matter"}
                          </span>
                        </td>
                        <td className="px-1 py-2">
                          {matter.stage ? (
                            <Badge mono>{matter.stage.code}</Badge>
                          ) : (
                            // Not an error and not an omission — an explicit
                            // state the attorney has to resolve.
                            <span className="text-xs font-semibold text-soon">
                              No stage
                            </span>
                          )}
                        </td>
                        <td className="px-1 py-2 text-xs">
                          {matter.status === "closed"
                            ? "Closed"
                            : matter.status === "on_hold"
                              ? "On hold"
                              : "Open"}
                        </td>
                        <td className="px-1 py-2 font-mono text-xs tabular-nums">
                          {matter.opened_at
                            ? formatDocketDateWithYear(matter.opened_at.slice(0, 10))
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        ))
      )}
    </div>,
  );
}
