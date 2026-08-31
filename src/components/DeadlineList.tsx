/**
 * The deadline hero — the ranked "what is on fire" reading of the docket.
 *
 * Three sections, always in this order: OVERDUE, THIS WEEK, LATER. Overdue is
 * first, is never collapsed, and has no collapse affordance at all — there is
 * deliberately no `defaultCollapsed`, no `maxRows`, no "show more" for it,
 * because every one of those is a way for a blown date to end up one click
 * away from being seen. Two of the rows on this docket are intentionally-
 * overdue lapsed appeal windows kept `status='open'` precisely so they keep
 * rendering here.
 *
 * Every row shows, in this order: the weekday and date (`formatDocketDate` —
 * "Mon 18 Aug", never "8/18"), the kind label, the matter number (which for
 * this firm IS the court case number), and the court or county when the row
 * carries one. A section's band is stated in words in its heading AND repeated
 * as screen-reader text on every row, so a row read out of context still says
 * whether it is overdue.
 *
 * Presentational only: rows arrive as props, the clock is a prop, nothing here
 * fetches, and the banding is done by `@/lib/deadlines/urgency` rather than by
 * any arithmetic of its own.
 */

import Link from "next/link";

import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { UrgencyBadge, urgencyTokens } from "@/components/UrgencyBadge";
import {
  countByUrgency,
  groupByUrgency,
  urgencyPhrase,
  type UrgencyBand,
} from "@/lib/deadlines/urgency";
import { courtToday, docketWeekday, formatDocketDate } from "@/lib/format/date";

export type DeadlineListItem = {
  id: string;
  /** Civil date, `YYYY-MM-DD`. Never an instant — a docket date has no time. */
  due_date: string;
  /** Present so an already-satisfied row can never be banded as overdue. */
  status?: string | null;
  /**
   * Short kind label — "Appeal window", "Motion response". Mapped by the
   * caller through `deadlineKindShortLabel` so this component never has to
   * know the enum.
   */
  kindLabel: string;
  /** The row's own title, when it says something the kind label does not. */
  title?: string | null;
  /** `crm_matter.matter_number` — the court case number for this firm. */
  matterNumber?: string | null;
  /** Court or division, e.g. "County Civil". */
  court?: string | null;
  /** County, e.g. "Pinellas". */
  county?: string | null;
  /** Court wall-clock with the zone named — "10:00 AM EDT". Absent = all day. */
  time?: string | null;
  /** Link target for the row, usually the case file. */
  href?: string | null;
};

export type DeadlineListProps = {
  deadlines: readonly DeadlineListItem[];
  /** Civil date to band against. Defaults to today in court time. */
  today?: string;
  title?: string;
  /** Shown when there is not a single deadline in any band. */
  emptyMessage?: string;
  className?: string;
};

/**
 * Per-band empty text. An empty band still renders its heading and says so in
 * words: "Nothing overdue" is a real, reassuring answer, whereas a section
 * that silently disappears is indistinguishable from one that failed to load.
 */
const EMPTY_BAND_TEXT: Record<UrgencyBand, string> = {
  overdue: "Nothing overdue.",
  soon: "Nothing due in the next 7 days.",
  later: "Nothing further out.",
};

export function DeadlineList({
  deadlines,
  today = courtToday(),
  title = "Deadlines",
  emptyMessage = "No open deadlines on the docket.",
  className,
}: DeadlineListProps) {
  const counts = countByUrgency(deadlines, today);
  const groups = groupByUrgency(deadlines, today);

  // "7 open · 2 overdue". The overdue half is coloured AND worded, and it is
  // dropped entirely at zero rather than rendered as a reassuring "0 overdue"
  // that a glance could mistake for a count that failed to load.
  const meta = (
    <p className="font-mono text-xs tabular-nums text-[var(--ink-2)]">
      {counts.total} open
      {counts.overdue > 0 ? (
        <>
          {" · "}
          <span className="font-bold" style={{ color: urgencyTokens("overdue").ink }}>
            {counts.overdue} overdue
          </span>
        </>
      ) : null}
    </p>
  );

  return (
    <Card eyebrow={title} meta={meta} className={className}>
      {deadlines.length === 0 ? (
        <p className="py-2 text-sm text-[var(--muted)]">{emptyMessage}</p>
      ) : (
        <div className="grid gap-5">
          {groups.map((group) => (
            <section key={group.band} aria-labelledby={`deadline-band-${group.band}`}>
              <h3 id={`deadline-band-${group.band}`} className="mb-2">
                <UrgencyBadge band={group.band} count={group.deadlines.length} />
                <span className="sr-only">. {group.description}</span>
              </h3>

              {group.deadlines.length === 0 ? (
                <p className="pl-3 text-xs text-[var(--muted)]">
                  {EMPTY_BAND_TEXT[group.band]}
                </p>
              ) : (
                <ul className="grid gap-1.5">
                  {group.deadlines.map((deadline) => (
                    <DeadlineRow
                      key={deadline.id}
                      deadline={deadline}
                      band={group.band}
                      bandLabel={group.label}
                      today={today}
                    />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}

function DeadlineRow({
  deadline,
  band,
  bandLabel,
  today,
}: {
  deadline: DeadlineListItem;
  band: UrgencyBand;
  bandLabel: string;
  today: string;
}) {
  const tokens = urgencyTokens(band);
  const venue = [deadline.court, deadline.county]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  const ownTitle = deadline.title?.trim();
  // The kind label always shows. A row title only shows alongside it when it
  // adds something — a title that merely restates the kind is noise on a line
  // already carrying a date, a case number and a venue.
  const subtitle = ownTitle && ownTitle !== deadline.kindLabel ? ownTitle : null;

  const body = (
    <>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <time
          dateTime={deadline.due_date}
          className="font-mono text-sm font-semibold tabular-nums text-[var(--ink)]"
        >
          <span className="sr-only">{docketWeekday(deadline.due_date) ?? ""} </span>
          <span aria-hidden="true">{formatDocketDate(deadline.due_date)}</span>
        </time>
        <span className="text-sm font-semibold text-[var(--ink)]">
          {deadline.kindLabel}
        </span>
        {deadline.time ? (
          <span className="font-mono text-xs font-semibold" style={{ color: tokens.ink }}>
            {deadline.time}
          </span>
        ) : null}
        {subtitle ? (
          <span className="text-xs text-[var(--ink-2)]">{subtitle}</span>
        ) : null}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
        {deadline.matterNumber ? <Badge mono>{deadline.matterNumber}</Badge> : null}
        {venue ? <span>{venue}</span> : null}
        <span style={{ color: tokens.ink }}>{urgencyPhrase(deadline.due_date, today)}</span>
      </div>
    </>
  );

  return (
    <li
      className="rounded-[var(--r-sm)] border-l-2 py-1.5 pl-3"
      style={{ borderLeftColor: tokens.border, background: tokens.bg }}
    >
      {/* Repeated per row, not only in the heading: a row read on its own by a
          screen reader, or landed on by keyboard, must still announce its
          band. Colour and position are not enough. */}
      <span className="sr-only">{bandLabel}. </span>
      {deadline.href ? (
        <Link
          href={deadline.href}
          className="block rounded-[var(--r-sm)] outline-offset-2 focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          {body}
        </Link>
      ) : (
        body
      )}
    </li>
  );
}

export default DeadlineList;
