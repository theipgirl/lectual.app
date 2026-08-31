/**
 * The calendar engine: four sources, one row type, merged and deduped.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS MODULE IS FOR
 *
 * The month grid on `/`, the `UP NEXT` strip under it and the full `/calendar`
 * page are all the same reading of the same data at different densities. If
 * each built its own list, they would drift, and the day one of them dropped a
 * row would be the day nobody noticed. So there is exactly one merge, here, and
 * every surface renders what it returns.
 *
 * The four sources are not interchangeable, and the differences are the whole
 * design:
 *
 *   crm_matter_deadline.due_date        civil date, no time   → 'deadline'
 *   crm_litigation_detail.next_hearing_at   timestamptz       → 'hearing'
 *   crm_task.due_at                         timestamptz       → 'task'
 *   external / Outlook events               timestamptz       → 'external'
 *
 * A civil date has no time of day and no zone; an instant has both. Turning an
 * instant into "which day is this on" is a question with a different answer in
 * every timezone, and the only answer that matters is the COURT's — see
 * `courtCivilDate`. Hearing times are then rendered in court time with the zone
 * NAMED ("10:00 AM EDT"), because the Pinellas hearing stored as
 * `2026-08-25T14:00:00Z` is a 10:00am appearance, and showing "2:00 PM" for it
 * is a four-hour error on a court date.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO RULES THIS FILE ENFORCES STRUCTURALLY
 *
 * 1. AN EXTERNAL EVENT IS NEVER A DEADLINE. `countsFor` counts `deadline` and
 *    `hearing` rows and nothing else. An Outlook lunch is context; counting it
 *    in "7 open · 2 overdue" would let a personal appointment wear the same
 *    weight as a court date, and would inflate the one number on the screen the
 *    attorney is meant to trust. Tested explicitly.
 *
 * 2. A FAILING EXTERNAL SOURCE NEVER EMPTIES THE CALENDAR. The external source
 *    is read inside a try/catch and its failure is reported as a flag, not as
 *    an exception and never as silence. A calendar that renders blank because a
 *    token expired looks exactly like "nothing is due" — which is precisely the
 *    condition that cost this firm a pretrial conference. Every internal row
 *    must survive an external source that throws. Tested by injecting one.
 *
 * Pure module: no DB access, no `fetch`, no server imports, and no reading of
 * the clock except through a `today` parameter the caller supplies.
 */

import { COURT_TIME_ZONE } from "@/lib/court-time";
import { courtCivilDate, courtToday } from "@/lib/format/date";
import { urgencyBand, type UrgencyBand } from "@/lib/deadlines/urgency";

// ── The common row ───────────────────────────────────────────────────────────

/** Which source a row came from. Drives the marker, the weight and the counts. */
export type CalendarRowKind = "deadline" | "hearing" | "task" | "external";

/** Render order within a single day: obligations first, context last. */
const KIND_ORDER: Record<CalendarRowKind, number> = {
  deadline: 0,
  hearing: 1,
  task: 2,
  external: 3,
};

export type CalendarRow = {
  /** Stable per-row identity for React keys and for dedupe bookkeeping. */
  key: string;
  /** Civil date, `YYYY-MM-DD`. For an instant, the date in COURT time. */
  date: string;
  kind: CalendarRowKind;
  title: string;
  /** For this firm, `crm_matter.matter_number` IS the court case number. */
  matterNumber?: string;
  matterId?: string;
  /** Court wall-clock with the zone named — "10:00 AM EDT". Absent = all day. */
  time?: string;
  /** Urgency band. Never set on `external` rows: they are not obligations. */
  urgency?: UrgencyBand;
};

// ── Source shapes ────────────────────────────────────────────────────────────

/**
 * Structural inputs rather than table Row types: this module is pure and gets
 * unit-tested with hand-built fixtures, and the reads that feed it (`@/lib/
 * deadlines/read`) already flatten the matter join onto the row.
 */
export type DeadlineSourceRow = {
  id: string;
  matter_id: string;
  matter_number?: string | null;
  /** `hearing` is the kind that can collide with `next_hearing_at`. */
  kind?: string | null;
  title?: string | null;
  /** Civil date, `YYYY-MM-DD`. */
  due_date: string;
};

export type HearingSourceRow = {
  matter_id: string;
  matter_number?: string | null;
  /** timestamptz. */
  next_hearing_at: string | null;
  next_hearing_purpose?: string | null;
};

export type TaskSourceRow = {
  id: string;
  matter_id?: string | null;
  matter_number?: string | null;
  title: string;
  /** timestamptz. Tasks with no due date are not calendar rows. */
  due_at: string | null;
};

/**
 * An event from outside Lectual — Outlook today, anything else later. The seam
 * exists now so the merge, the dedupe and the counting rules are settled and
 * tested before a live Graph read is ever wired to them (Outlook is M6).
 */
export type ExternalEvent = {
  id: string;
  subject: string;
  /** timestamptz. Graph returns the event's own zone; it is converted here. */
  startsAt: string;
  /** All-day events have no meaningful wall-clock time to show. */
  isAllDay?: boolean;
};

/**
 * External events, or a function that produces them.
 *
 * The function form is the honest one: producing these involves a token that
 * can be missing, expired or revoked, and the failure has to be survivable at
 * exactly this boundary. Passing a thunk lets the failure happen inside this
 * module's try/catch instead of taking out the caller's whole render.
 */
export type ExternalSource = readonly ExternalEvent[] | (() => readonly ExternalEvent[]);

export type CalendarSources = {
  deadlines?: readonly DeadlineSourceRow[];
  hearings?: readonly HearingSourceRow[];
  tasks?: readonly TaskSourceRow[];
  /** Optional; defaults to none. Outlook is a later milestone. */
  external?: ExternalSource;
  /** Civil date to band urgency against. Defaults to today in court time. */
  today?: string;
};

// ── Court wall-clock ─────────────────────────────────────────────────────────

const COURT_TIME_OF_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: COURT_TIME_ZONE,
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

/**
 * The time of day of an instant, in court time, zone named: "10:00 AM EDT".
 *
 * The zone is named rather than left implicit for the same reason
 * `@/lib/court-time` names it: an unlabelled time invites whoever is reading
 * the docket — from another state, or from a phone that has followed them
 * there — to read it as their own.
 */
export function courtTimeOfDay(instant: string | null | undefined): string | null {
  if (!instant) return null;
  const d = new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  return COURT_TIME_OF_DAY.format(d);
}

// ── Merge ────────────────────────────────────────────────────────────────────

export type CalendarBuild = {
  rows: CalendarRow[];
  /**
   * True when the external source threw. The UI must show this as a "not
   * connected — reconnect" chip: the failure is always visible, and the
   * internal rows below it are complete regardless.
   */
  externalUnavailable: boolean;
};

/** Matter numbers look like `26-CC-011354`; used to spot them in a subject line. */
const MATTER_NUMBER_IN_TEXT = /\b\d{2}-[A-Z]{2,3}-\d{4,8}\b/g;

function resolveExternal(source: ExternalSource | undefined): {
  events: readonly ExternalEvent[];
  failed: boolean;
} {
  if (source === undefined) return { events: [], failed: false };
  if (Array.isArray(source)) return { events: source, failed: false };
  try {
    const events = (source as () => readonly ExternalEvent[])();
    return { events: events ?? [], failed: false };
  } catch {
    // Deliberately swallowed. The caller learns about it through
    // `externalUnavailable`, and every Lectual row is returned either way.
    return { events: [], failed: true };
  }
}

/**
 * Merges the four sources into one sorted, deduped list.
 *
 * Ordering is by civil date, then obligations before context within a day
 * (deadline, hearing, task, external), then by time, then by title — so a
 * day's rows read in the order they matter rather than in query order.
 */
export function buildCalendar(sources: CalendarSources = {}): CalendarBuild {
  const today = sources.today ?? courtToday();
  const rows: CalendarRow[] = [];

  // Deadlines — civil dates, used exactly as stored. No Date is ever built out
  // of one, so no timezone can shift it off its day.
  const deadlineByMatterDate = new Map<string, CalendarRow>();
  for (const d of sources.deadlines ?? []) {
    if (!d.due_date) continue;
    const row: CalendarRow = {
      key: `deadline:${d.id}`,
      date: d.due_date,
      kind: "deadline",
      title: d.title?.trim() || defaultDeadlineTitle(d.kind),
      urgency: urgencyBand(d.due_date, today),
    };
    if (d.matter_number) row.matterNumber = d.matter_number;
    if (d.matter_id) row.matterId = d.matter_id;
    rows.push(row);
    // Only `hearing`-kind rows can absorb a `next_hearing_at`; a motion
    // response that happens to share a date with a hearing is a separate
    // obligation and stays a separate row.
    if (isHearingKind(d.kind)) deadlineByMatterDate.set(`${d.matter_id}|${d.due_date}`, row);
  }

  // Hearings — instants, placed on the court's civil date.
  for (const h of sources.hearings ?? []) {
    const date = courtCivilDate(h.next_hearing_at);
    if (!date) continue;
    const time = courtTimeOfDay(h.next_hearing_at) ?? undefined;

    // Dedupe: a `hearing` deadline and a `next_hearing_at` on the same matter
    // and the same civil date are ONE court appearance recorded twice. Prefer
    // the docket row — it is the one the firm maintains, the one that can be
    // satisfied, and the one urgency is banded from — and annotate it with the
    // time the timestamp carries and the date column cannot.
    const existing = deadlineByMatterDate.get(`${h.matter_id}|${date}`);
    if (existing) {
      if (time && !existing.time) existing.time = time;
      continue;
    }

    const row: CalendarRow = {
      key: `hearing:${h.matter_id}:${h.next_hearing_at}`,
      date,
      kind: "hearing",
      title: h.next_hearing_purpose?.trim() || "Hearing",
      urgency: urgencyBand(date, today),
    };
    if (time) row.time = time;
    if (h.matter_number) row.matterNumber = h.matter_number;
    row.matterId = h.matter_id;
    rows.push(row);
  }

  // Tasks — instants too. A task with no due date is not a calendar row.
  for (const t of sources.tasks ?? []) {
    const date = courtCivilDate(t.due_at);
    if (!date) continue;
    const row: CalendarRow = {
      key: `task:${t.id}`,
      date,
      kind: "task",
      title: t.title,
      urgency: urgencyBand(date, today),
    };
    const time = courtTimeOfDay(t.due_at);
    if (time) row.time = time;
    if (t.matter_number) row.matterNumber = t.matter_number;
    if (t.matter_id) row.matterId = t.matter_id;
    rows.push(row);
  }

  // External — additive overlay, never an obligation, never counted, and never
  // able to remove anything above it.
  const { events, failed } = resolveExternal(sources.external);
  const docketNumbersByDate = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.matterNumber) continue;
    const set = docketNumbersByDate.get(row.date) ?? new Set<string>();
    set.add(row.matterNumber.toUpperCase());
    docketNumbersByDate.set(row.date, set);
  }

  for (const e of events) {
    const date = courtCivilDate(e.startsAt);
    if (!date) continue;
    // An Outlook entry for a case already on the docket that day is the same
    // appearance seen from the other calendar — collapse it rather than show
    // the attorney two rows for one hearing. Everything else stays separate:
    // this app cannot know that "Call re: Barrios" is or is not the docket
    // item, and guessing would hide a real event.
    const onDocket = docketNumbersByDate.get(date);
    const mentioned = e.subject.toUpperCase().match(MATTER_NUMBER_IN_TEXT) ?? [];
    if (onDocket && mentioned.some((n) => onDocket.has(n))) continue;

    const row: CalendarRow = {
      key: `external:${e.id}`,
      date,
      kind: "external",
      title: e.subject,
      // No `urgency`, by design — an external event has no docket standing.
    };
    if (!e.isAllDay) {
      const time = courtTimeOfDay(e.startsAt);
      if (time) row.time = time;
    }
    rows.push(row);
  }

  rows.sort(compareRows);
  return { rows, externalUnavailable: failed };
}

/** The merged rows alone, for callers that do not render the external chip. */
export function buildCalendarRows(sources: CalendarSources = {}): CalendarRow[] {
  return buildCalendar(sources).rows;
}

function compareRows(a: CalendarRow, b: CalendarRow): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const kindDelta = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (kindDelta !== 0) return kindDelta;
  // All-day rows lead the day; timed rows follow in clock order. Comparing the
  // formatted strings would sort "1:00 PM" before "10:00 AM", so sort on the
  // 24-hour reading instead.
  const at = minutesOfDay(a.time);
  const bt = minutesOfDay(b.time);
  if (at !== bt) return at - bt;
  return a.title.localeCompare(b.title);
}

/** Minutes since midnight of a "10:00 AM EDT" string; -1 when there is none. */
function minutesOfDay(time: string | undefined): number {
  if (!time) return -1;
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(time);
  if (!m) return -1;
  let hour = Number(m[1]) % 12;
  if (m[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number(m[2]);
}

function isHearingKind(kind: string | null | undefined): boolean {
  return kind === "hearing";
}

function defaultDeadlineTitle(kind: string | null | undefined): string {
  return kind === "hearing" ? "Hearing" : "Deadline";
}

// ── Counting ─────────────────────────────────────────────────────────────────

export type CalendarCounts = {
  /** Counted rows: deadlines and hearings only. The "7 open" number. */
  total: number;
  overdue: number;
  soon: number;
  later: number;
  /** Rows deliberately left out of the counts — tasks and external events. */
  uncounted: number;
};

/**
 * The hero strip's numbers — "7 open · 2 overdue".
 *
 * ONLY `deadline` and `hearing` rows are counted. Tasks are the firm's own
 * work items rather than dates owed to a court, and external events are
 * somebody else's calendar showing through: neither belongs in a number the
 * attorney reads as "obligations I owe". An Outlook lunch counted here would
 * be indistinguishable from a court date at a glance, which is the exact
 * confusion this dashboard exists to remove.
 */
export function countsFor(rows: readonly CalendarRow[]): CalendarCounts {
  const counts: CalendarCounts = { total: 0, overdue: 0, soon: 0, later: 0, uncounted: 0 };
  for (const row of rows) {
    if (row.kind !== "deadline" && row.kind !== "hearing") {
      counts.uncounted += 1;
      continue;
    }
    counts.total += 1;
    if (row.urgency) counts[row.urgency] += 1;
  }
  return counts;
}

/** Rows for one civil date, in the order they should render. */
export function rowsOn(rows: readonly CalendarRow[], date: string): CalendarRow[] {
  return rows.filter((r) => r.date === date);
}

/**
 * The `UP NEXT` reading: rows from `today` through `today + days`, inclusive.
 *
 * Bounds the FAR end only. Overdue rows are excluded here because this list is
 * explicitly forward-looking and sits directly beneath the hero that shows
 * them — nowhere in this app does a filter drop a blown date without something
 * else on the same screen still showing it.
 */
export function upNext(
  rows: readonly CalendarRow[],
  today: string,
  days = 14,
): CalendarRow[] {
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return rows.filter((r) => r.date >= today && r.date <= end);
}
