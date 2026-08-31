/**
 * MatterCard — one matter, as it appears in a lane on the board.
 *
 * WHAT A CARD HAS TO SAY, AND WHY
 * -------------------------------
 * 1. THE MATTER NUMBER, FIRST AND IN MONO. For this firm `crm_matter.matter_number`
 *    IS the court case number (`26-CC-011354`). It is what she reads out to a
 *    clerk, what the docket search takes, and what every deadline row is keyed
 *    to — so it is the card's identity line, not a footnote under the title.
 *    A matter with no number says so in words rather than rendering a blank
 *    where a case number should be.
 * 2. THE CLIENT / TITLE, as the human-readable second line.
 * 3. THE NEXT DEADLINE, with its urgency band. Banding comes from
 *    `@/lib/deadlines/urgency` — the card does no date arithmetic of its own,
 *    so a card, a hero row and a calendar dot for the same date can never
 *    disagree. Colour is never the only signal: the band's word ("Overdue",
 *    "This week", "Later") is always rendered next to the date.
 *    A matter with NO deadline says "No deadline on the docket" out loud. A
 *    blank line there reads as "nothing due", and reading blank as "nothing
 *    due" is the exact failure this dashboard was built after.
 * 4. DAYS IN STAGE, ONLY WHEN STALE. A day count on every card is wallpaper;
 *    on the handful that have gone quiet past their stall threshold it is the
 *    whole point. Staleness is computed upstream by
 *    `matterIsStale`/`daysInStage` in `@/lib/board/stage-rules` and handed in.
 *
 * The stale chip is deliberately NOT drawn in an urgency colour. "This has sat
 * for 34 days" and "this is due Thursday" are different kinds of fact, and
 * letting a stalled case borrow the amber of a court deadline would devalue the
 * amber that matters.
 *
 * Interaction: the TITLE is the link, not the whole card. That keeps an
 * optional per-card action (a "Place on a stage" button in the unplaced lane)
 * from being an interactive control nested inside an anchor.
 *
 * Presentational only — every value arrives as a prop.
 */

import Link from "next/link";
import type { ReactNode } from "react";

import { Badge } from "@/components/Badge";
import { urgencyTokens } from "@/components/UrgencyBadge";
import { urgencyBand, urgencyLabel, urgencyPhrase } from "@/lib/deadlines/urgency";
import { courtToday, docketWeekday, formatDocketDate } from "@/lib/format/date";

/** The next thing due on a matter, as the card renders it. */
export type MatterCardDeadline = {
  /** Civil date, `YYYY-MM-DD`. A docket date has no time of day. */
  due_date: string;
  /** Short kind label — "Answer due", "Hearing", "Appeal window". */
  kindLabel: string;
  /** Court wall-clock with the zone named — "10:00 AM EDT". Absent = all day. */
  time?: string | null;
};

/** Everything a lane needs to render one matter. */
export type MatterCardItem = {
  id: string;
  /** The court case number for litigation matters. Null renders as a notice. */
  matterNumber?: string | null;
  /** The matter's own title. */
  title?: string | null;
  /** Client name, when the caller resolved one. */
  clientName?: string | null;
  /** Soonest open deadline, or null when the docket is clear for this matter. */
  nextDeadline?: MatterCardDeadline | null;
  /** From `daysInStage()`. Null for an unplaced matter — it has no clock. */
  daysInStage?: number | null;
  /** From `matterIsStale()`. Gates the day count; see the note above. */
  stale?: boolean;
  /** Who is carrying it. Requested explicitly for the board cards. */
  assignee?: string | null;
  /** Usually the case file, `/matter/[id]`. */
  href?: string | null;
};

export type MatterCardProps = {
  matter: MatterCardItem;
  /** Civil date to band the deadline against. Defaults to today, court time. */
  today?: string;
  /** Trailing control — e.g. "Place on a stage" in the unplaced lane. */
  action?: ReactNode;
  className?: string;
};

export function MatterCard({ matter, today = courtToday(), action, className }: MatterCardProps) {
  const number = matter.matterNumber?.trim();
  const title = matter.title?.trim();
  const client = matter.clientName?.trim();
  // The title line prefers the client's name and falls back to the matter
  // title; when both exist and differ, both are shown.
  const primary = client ?? title ?? null;
  const secondary = client && title && client !== title ? title : null;
  const showStale = matter.stale === true && typeof matter.daysInStage === "number";

  return (
    <article
      className={[
        "flex min-w-0 flex-col gap-1.5 rounded-sm border border-border bg-surface p-2.5",
        "shadow-[var(--shadow)] print:shadow-none",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          {number ? (
            <p className="font-mono text-[13px] font-semibold leading-5 tracking-tight text-ink">
              {matter.href ? (
                <Link
                  href={matter.href}
                  className="rounded-sm outline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  {number}
                </Link>
              ) : (
                number
              )}
            </p>
          ) : (
            <p className="text-[13px] font-semibold leading-5 text-soon">
              {matter.href ? (
                <Link
                  href={matter.href}
                  className="rounded-sm outline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                >
                  No case number recorded
                </Link>
              ) : (
                "No case number recorded"
              )}
            </p>
          )}

          {primary ? (
            <p className="truncate text-[13px] leading-5 text-ink-2" title={primary}>
              {primary}
            </p>
          ) : null}
          {secondary ? (
            <p className="truncate text-xs leading-4 text-muted" title={secondary}>
              {secondary}
            </p>
          ) : null}
        </div>

        {action ? <div className="shrink-0">{action}</div> : null}
      </div>

      <NextDeadlineLine deadline={matter.nextDeadline ?? null} today={today} />

      {(showStale || matter.assignee) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {showStale ? (
            <Badge
              tone="neutral"
              className="border-border-strong"
              title="This matter has sat in its current stage longer than its stall threshold."
            >
              Stalled · {matter.daysInStage} days in stage
            </Badge>
          ) : null}
          {matter.assignee ? (
            <span className="truncate text-[11px] leading-4 text-muted">
              <span className="sr-only">Assigned to </span>
              {matter.assignee}
            </span>
          ) : null}
        </div>
      )}
    </article>
  );
}

/**
 * The deadline line. Present for every card, in every state — including the
 * state where there is no deadline, which is said in words.
 */
function NextDeadlineLine({
  deadline,
  today,
}: {
  deadline: MatterCardDeadline | null;
  today: string;
}) {
  if (!deadline) {
    return (
      <p className="text-[11px] leading-4 text-muted">No deadline on the docket</p>
    );
  }

  const band = urgencyBand(deadline.due_date, today);
  const tokens = urgencyTokens(band);

  return (
    <p
      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-sm border-l-2 py-1 pl-2 text-[11px] leading-4"
      style={{ borderLeftColor: tokens.border, background: tokens.bg }}
    >
      {/* The band's word, always — the row must not depend on its colour. */}
      <span className="font-semibold" style={{ color: tokens.ink }}>
        {urgencyLabel(band)}
      </span>
      <time
        dateTime={deadline.due_date}
        className="font-mono font-semibold tabular-nums text-ink"
      >
        <span className="sr-only">{docketWeekday(deadline.due_date) ?? ""} </span>
        <span aria-hidden="true">{formatDocketDate(deadline.due_date)}</span>
      </time>
      {deadline.time ? (
        <span className="font-mono font-semibold" style={{ color: tokens.ink }}>
          {deadline.time}
        </span>
      ) : null}
      <span className="truncate text-ink-2">{deadline.kindLabel}</span>
      <span className="text-muted">{urgencyPhrase(deadline.due_date, today)}</span>
    </p>
  );
}

export default MatterCard;
