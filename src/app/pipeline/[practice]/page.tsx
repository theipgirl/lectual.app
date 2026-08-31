import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Card } from "@/components/Card";
import { MatterCard, type MatterCardItem } from "@/components/MatterCard";
import { Shell } from "@/components/Shell";
import { StageLane } from "@/components/StageLane";
import { UnplacedLane } from "@/components/UnplacedLane";
import { requireSession } from "@/lib/auth/session";
import { boardMatterCount, buildBoard, type BoardStage } from "@/lib/board/board";
import { daysInStage, matterIsStale } from "@/lib/board/stage-rules";
import { deadlineKindShortLabel } from "@/lib/deadlines/kinds";
import { listOpenDeadlines, type OpenDeadline } from "@/lib/deadlines/read";
import { courtToday } from "@/lib/format/date";
import { listMatters, type Matter } from "@/lib/matters/read";
import { listMatterStages, type MatterStage } from "@/lib/matters/stages";
import {
  isCollectionsStageCode,
  isLitigationStageCode,
  PRACTICES,
  practicesInOrder,
  resolvePractice,
  type PracticeId,
} from "@/lib/practice/resolve";

/**
 * `/pipeline/[practice]` — the full board for one practice.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE UNPLACED LANE IS THE POINT
 *
 * 22 of this firm's 34 live litigation matters carry `stage_id IS NULL`. They
 * are deliberately unplaced — real, open, deadline-bearing cases awaiting the
 * attorney's judgment about where they sit. A board that keys on `stage_id`
 * drops 65% of her live litigation off the screen with no error at all, and a
 * screen that silently omits two thirds of a caseload is the exact shape of the
 * failure that cost this firm a pretrial conference.
 *
 * Three things defend against that here, and none of them is a code comment:
 *
 *   1. `buildBoard` returns `unstaged` as a REQUIRED field, so a renderer cannot
 *      forget it by leaving out an optional.
 *   2. `UnplacedLane` is rendered FIRST and UNCONDITIONALLY — at zero it renders
 *      a worded empty state, never nothing. A lane that vanishes when empty
 *      teaches the eye not to look for it, and the day it matters is the day it
 *      comes back.
 *   3. The stage catalog handed to `buildBoard` always includes every stage this
 *      practice's matters actually occupy (see `stagesForPractice`), so
 *      "unplaced" here always means "has no stage", never "sat on a stage this
 *      page forgot to ask for".
 *
 * The count header at the top states the arithmetic out loud — unplaced + every
 * stage + closed = the practice's total — so a lost matter is visible as a
 * number that does not add up rather than as a card nobody missed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ROUTING
 *
 * `[practice]` is validated against the `PRACTICES` registry and anything else
 * is a 404. The registry is the single source of which practices exist: adding
 * one is a one-line data change there and this page picks it up, tabs, route and
 * all. No practice is hardcoded as the primary one.
 *
 * NO `org_id` FILTER ANYWHERE. RLS scopes every read through the caller's JWT.
 */

export const dynamic = "force-dynamic";

type RouteParams = { practice: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { practice } = await params;
  const definition = PRACTICES.find((p) => p.id === practice);
  return { title: definition ? `${definition.label} board` : "Board" };
}

export default async function PipelinePage({
  params,
}: {
  params: Promise<RouteParams>;
}) {
  const { practice: rawPractice } = await params;

  // Validated against the registry, not against a union type: the param arrives
  // as an arbitrary string off the wire, and anything that is not a practice is
  // a 404 rather than an empty board that looks like a practice with no work in
  // it.
  const definition = PRACTICES.find((p) => p.id === rawPractice);
  if (!definition) notFound();
  const practice: PracticeId = definition.id;

  const session = await requireSession();

  if (session.status !== "ok") {
    // Absence of access must look like absence of access — never like a board
    // with nothing on it.
    return (
      <main className="grid min-h-dvh place-items-center p-6">
        <div className="grid w-full max-w-lg gap-3 rounded-lg border border-border bg-surface p-7 shadow-[var(--shadow)]">
          <p className="font-mono text-xs uppercase tracking-[0.08em] text-muted">
            {definition.label}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {session.status === "signed-out" ? "Signed out" : "No firm access yet"}
          </h1>
          <p className="text-sm leading-relaxed text-ink-2">
            {session.status === "signed-out"
              ? "Sign in with a magic link to see this board."
              : "This account is signed in but is not a member of a Lectual firm workspace, so there is no caseload to show. This is not an empty board."}
          </p>
          <Link
            href="/sign-in/"
            className="justify-self-start rounded-sm bg-accent px-4 py-2.5 text-sm font-bold text-accent-ink"
          >
            {session.status === "signed-out" ? "Sign in" : "Request a fresh link"}
          </Link>
        </div>
      </main>
    );
  }

  const today = courtToday();
  const now = new Date();

  const [matters, stages, deadlines] = await Promise.all([
    listMatters(),
    listMatterStages(),
    listOpenDeadlines(),
  ]);

  // Practice membership is resolved per matter from its type and its stage — an
  // unplaced LIT matter resolves to litigation, which is what keeps those 22
  // matters on this board instead of nowhere.
  const byPractice = matters.filter((m) => resolvePractice(m, m.stage) === practice);
  const stagesForPractice = stageCatalog(stages, byPractice, practice);
  const board = buildBoard(stagesForPractice, byPractice, now);

  // Structurally guaranteed by `buildBoard` (every matter lands in exactly one
  // bucket), asserted here anyway because the cost of it being false is 22
  // invisible cases. The header renders the same arithmetic for a human.
  const accountedFor = boardMatterCount(board);

  const nextDeadlineByMatter = indexNextDeadline(deadlines);

  const toCard = (matter: Matter): MatterCardItem => {
    const deadline = nextDeadlineByMatter.get(matter.id);
    const days = daysInStage(matter.stage_entered_at, now);
    return {
      id: matter.id,
      matterNumber: matter.matter_number,
      title: matter.title,
      nextDeadline: deadline
        ? {
            due_date: deadline.due_date,
            kindLabel: deadlineKindShortLabel(deadline.kind),
          }
        : null,
      daysInStage: days,
      stale: matterIsStale(
        {
          stage_entered_at: matter.stage_entered_at,
          waiting_on: matter.stage?.waiting_on ?? null,
        },
        now,
      ),
      href: `/matter/${matter.id}/`,
    };
  };

  const laneCounts = [
    { key: "unplaced", label: "Unplaced", code: "UNPLACED", count: board.unstaged.length },
    ...board.open.map((column) => ({
      key: column.stage.id,
      label: column.stage.label,
      code: column.stage.code,
      count: column.matters.length,
    })),
    ...(board.closedCount > 0
      ? [{ key: "closed", label: "Closed", code: "CLOSED", count: board.closedCount }]
      : []),
  ];

  return (
    <Shell
      wide
      firmName={session.orgName}
      userLabel={session.user.email}
      roleLabel={session.role}
    >
      <div className="grid gap-4">
        <header className="grid gap-2">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                Board
              </p>
              <h1 className="text-xl font-semibold tracking-tight text-ink">
                {definition.label}
              </h1>
              <p className="mt-0.5 text-[13px] text-ink-2">
                {accountedFor} {accountedFor === 1 ? "matter" : "matters"} ·{" "}
                {board.unstaged.length} unplaced · {board.closedCount} closed
              </p>
            </div>

            {/* The practice switcher. Rendered from the registry, so no practice
                is written down here and none is the default. */}
            <nav aria-label="Practice" className="flex flex-wrap items-center gap-1.5">
              {practicesInOrder().map((entry) => {
                const selected = entry.id === practice;
                return (
                  <Link
                    key={entry.id}
                    href={`/pipeline/${entry.id}/`}
                    aria-current={selected ? "page" : undefined}
                    className={[
                      "rounded-sm border px-2.5 py-1 text-[12px] font-semibold outline-offset-2",
                      "focus-visible:outline-2 focus-visible:outline-accent",
                      selected
                        ? "border-accent bg-accent text-accent-ink"
                        : "border-border-strong bg-surface text-ink-2 hover:bg-surface-3",
                    ].join(" ")}
                  >
                    {entry.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Per-stage counts, unplaced first and always present. This strip is
              the board's arithmetic in one line: it is where a lane holding
              nothing, or a lane holding far too much, is noticed before any
              scrolling happens. */}
          <Card
            eyebrow="Stage counts"
            title={`${accountedFor} ${accountedFor === 1 ? "matter" : "matters"} across ${laneCounts.length} ${laneCounts.length === 1 ? "lane" : "lanes"}`}
            id="stage-counts"
          >
            <ul className="flex flex-wrap gap-x-4 gap-y-2">
              {laneCounts.map((lane) => (
                <li key={lane.key} className="flex min-w-[7rem] flex-col gap-0.5">
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
                    {lane.code}
                  </span>
                  <span className="flex items-baseline gap-1.5">
                    <span
                      className={[
                        "font-mono text-[17px] font-semibold tabular-nums",
                        lane.key === "unplaced" && lane.count > 0 ? "text-soon" : "text-ink",
                      ].join(" ")}
                    >
                      {lane.count}
                    </span>
                    <span className="truncate text-[12px] text-ink-2">{lane.label}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </header>

        {/* The board. Unplaced is pinned first and is not part of the scrolling
            stage list — it cannot be sorted, filtered or scrolled behind the
            stages. */}
        <div className="grid gap-3 lg:grid-cols-[minmax(16rem,22rem)_1fr] lg:items-start">
          <UnplacedLane matters={board.unstaged.map(toCard)} today={today} />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {board.open.length === 0 ? (
              <Card eyebrow="Stages" title="No live stages on this board">
                <p className="text-[13px] text-ink-2">
                  This practice has no open stage ladder yet, so every matter in it sits in
                  the unplaced lane. That lane is complete — nothing is hidden — and the
                  ladder is content that gets seeded, not schema.
                </p>
              </Card>
            ) : (
              board.open.map((column) => (
                <StageLane
                  key={column.stage.id}
                  stage={column.stage}
                  matters={column.matters.map(toCard)}
                  stale={column.stale}
                  today={today}
                />
              ))
            )}
          </div>
        </div>

        {board.closed.length > 0 ? (
          <Card
            eyebrow="Closed"
            title={`${board.closedCount} closed ${board.closedCount === 1 ? "matter" : "matters"}`}
            id="closed-matters"
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {board.closed.map((column) => (
                <section key={column.stage.id} className="grid gap-2">
                  <h3 className="flex items-baseline gap-2 border-b border-border pb-1">
                    <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.09em] text-muted">
                      {column.stage.code}
                    </span>
                    <span className="text-[13px] font-semibold text-ink">
                      {column.stage.label}
                    </span>
                    <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-2">
                      {column.matters.length}
                    </span>
                  </h3>
                  {column.matters.map((matter) => (
                    <MatterCard key={matter.id} matter={toCard(matter)} today={today} />
                  ))}
                </section>
              ))}
            </div>
          </Card>
        ) : null}
      </div>
    </Shell>
  );
}

/**
 * The stages this board draws columns for.
 *
 * TWO RULES, AND THE FIRST ONE IS LOAD-BEARING.
 *
 * 1. EVERY STAGE THIS PRACTICE'S MATTERS ACTUALLY OCCUPY IS INCLUDED, always.
 *    `buildBoard` puts a matter whose `stage_id` is not in the catalog into
 *    `unstaged`, which is the right behaviour for a stage the caller cannot see
 *    — but it would be a lie here if this page simply forgot to ask for a
 *    stage. So occupancy, not the ladder, is the primary rule: "unplaced" on
 *    this board always means the matter genuinely has no stage.
 *
 * 2. THE PRACTICE'S OWN LADDER IS INCLUDED EVEN WHEN EMPTY, so a cleared step of
 *    the docket renders as an empty lane saying "nothing at this stage" rather
 *    than as a gap in the board's shape that changes every time a matter moves.
 *    Collections is the `PC` prefix and litigation is the LIT ladder; trademark
 *    has no seeded ladder yet (that is content, seeded in the main repo), so
 *    today its board is occupancy-only and its matters land in the unplaced lane
 *    — visibly, which is the whole idea.
 */
function stageCatalog(
  stages: readonly MatterStage[],
  matters: readonly Matter[],
  practice: PracticeId,
): BoardStage[] {
  const occupied = new Set(
    matters.map((m) => m.stage_id).filter((id): id is string => id !== null),
  );

  const onLadder = (code: string): boolean => {
    if (practice === "collections") return isCollectionsStageCode(code);
    if (practice === "litigation") {
      return isLitigationStageCode(code) && !isCollectionsStageCode(code);
    }
    // Trademark: no ladder seeded yet. Occupancy alone.
    return false;
  };

  return stages
    .filter((stage) => occupied.has(stage.id) || onLadder(stage.code))
    .map((stage) => ({
      id: stage.id,
      code: stage.code,
      label: stage.label,
      order_index: stage.order_index,
      is_open: stage.is_open,
      waiting_on: stage.waiting_on,
    }));
}

/**
 * The soonest open deadline per matter.
 *
 * `listOpenDeadlines` returns rows soonest-first with no near-end bound, so the
 * first row seen for a matter is its next one — and an overdue row, sorting
 * earliest, wins that slot. That is deliberate: the card should show the blown
 * date, not the next tidy one after it.
 */
function indexNextDeadline(deadlines: readonly OpenDeadline[]): Map<string, OpenDeadline> {
  const byMatter = new Map<string, OpenDeadline>();
  for (const deadline of deadlines) {
    if (!byMatter.has(deadline.matter_id)) byMatter.set(deadline.matter_id, deadline);
  }
  return byMatter;
}
