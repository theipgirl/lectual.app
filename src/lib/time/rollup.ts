import type { Database } from "@/lib/db/types";

/**
 * Pure roll-ups over time entries (blueprint §13.1).
 *
 * Nothing here touches the database, `next/headers` or the clock: every
 * function takes `now` as an argument. That is what lets the SERVER compute
 * this week's total for a page render and the BROWSER re-compute the same
 * number a second later as a running timer ticks, without the two ever
 * disagreeing about what "this week" means.
 *
 * These numbers are INTERNAL EFFORT — how long someone spent on an intake
 * card. They are never a client invoice: RPB bills flat fees and Lectual bills
 * flat fees (AGENTS.md), which is why there is no rate, no currency and no
 * "billable" anywhere in this file or in the table behind it.
 */

export type TimeEntry = Database["public"]["Tables"]["crm_time_entry"]["Row"];

/** The subset of a row the roll-ups actually read, so fixtures stay small. */
export type TimeEntryLike = Pick<
  TimeEntry,
  "id" | "lead_id" | "matter_id" | "user_id" | "started_at" | "ended_at" | "seconds" | "note"
>;

const HOUR_SECONDS = 3600;

/**
 * How long an entry represents, in seconds.
 *
 * A CLOSED entry reports its stored `seconds` — written by the server on Stop
 * — rather than a re-derivation from the timestamps. The stored number is the
 * one the timeline and the activity payload already recorded, and a manual
 * entry's `started_at` is itself back-computed from it, so re-deriving would
 * only introduce a second, rounder answer.
 *
 * A RUNNING entry has no stored duration yet, so it is measured against `now`.
 * Clamped at zero: a negative elapsed means the two clocks disagree, and a
 * timer that counts backwards is worse than one that reads 0m for a moment.
 */
export function elapsedSeconds(
  entry: Pick<TimeEntryLike, "started_at" | "ended_at" | "seconds">,
  now: Date,
): number {
  if (entry.ended_at !== null) return Math.max(0, entry.seconds);
  const started = Date.parse(entry.started_at);
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((now.getTime() - started) / 1000));
}

/**
 * Midnight on the Monday of `now`'s week, in the server's local zone.
 *
 * Monday, because this whole surface is the thing the firm opens on Monday
 * morning (blueprint §1) — a week that rolls over on Sunday would show a
 * Monday reader a total that had already been reset once since they last
 * looked.
 */
export function startOfWeek(now: Date): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // getDay(): 0 = Sunday. Sunday belongs to the week that began six days ago.
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return start;
}

/**
 * Whether an entry belongs to the week that began at `weekStartMs`.
 *
 * A STILL-RUNNING entry always counts, whenever it started. It is work
 * happening now, and a clock left open since Friday would otherwise tick
 * visibly on the chip while the total beside it said 0m — the chip and its
 * own number must never disagree.
 */
function countsForWeek(entry: TimeEntryLike, weekStartMs: number): boolean {
  if (entry.ended_at === null) return true;
  const started = Date.parse(entry.started_at);
  return Number.isFinite(started) && started >= weekStartMs;
}

/**
 * lead id → seconds logged this week, running timers included at their
 * elapsed-so-far.
 *
 * Entries with no `lead_id` (matter-side work) are skipped rather than bucketed
 * under a placeholder key — this is the intake card's number, and a matter's
 * effort is not part of it.
 */
export function weekTotalsByLead(entries: TimeEntryLike[], now: Date): Record<string, number> {
  const weekStartMs = startOfWeek(now).getTime();
  const totals: Record<string, number> = {};
  for (const entry of entries) {
    if (!entry.lead_id) continue;
    if (!countsForWeek(entry, weekStartMs)) continue;
    totals[entry.lead_id] = (totals[entry.lead_id] ?? 0) + elapsedSeconds(entry, now);
  }
  return totals;
}

/** One person's contribution to a total — the "who logged what" hover. */
export type UserTotal = {
  userId: string;
  seconds: number;
  /** How many entries they logged, so the hover can say "3 entries". */
  entries: number;
  /** True when one of those entries is still running. */
  running: boolean;
  /** Their most recent non-empty note, or null. The hover's second line. */
  lastNote: string | null;
};

/**
 * Totals per person over whatever entries are passed in, biggest first.
 *
 * Ties break on user id so the order is deterministic — a hover list that
 * reshuffles between two renders reads as data changing when nothing has.
 */
export function totalsByUser(entries: TimeEntryLike[], now: Date): UserTotal[] {
  const byUser = new Map<string, UserTotal>();
  // When each person's kept note was written, so a later one wins. Held beside
  // the totals rather than on them, so the returned objects carry nothing the
  // caller has to know to ignore.
  const noteAt = new Map<string, number>();

  for (const entry of entries) {
    const current = byUser.get(entry.user_id) ?? {
      userId: entry.user_id,
      seconds: 0,
      entries: 0,
      running: false,
      lastNote: null,
    };
    current.seconds += elapsedSeconds(entry, now);
    current.entries += 1;
    if (entry.ended_at === null) current.running = true;

    const note = entry.note?.trim();
    const at = Date.parse(entry.started_at);
    if (note && Number.isFinite(at) && at >= (noteAt.get(entry.user_id) ?? Number.NEGATIVE_INFINITY)) {
      current.lastNote = note;
      noteAt.set(entry.user_id, at);
    }
    byUser.set(entry.user_id, current);
  }

  return Array.from(byUser.values()).sort(
    (a, b) => b.seconds - a.seconds || a.userId.localeCompare(b.userId),
  );
}

/**
 * Running entries that have been open longer than `hours` — the input to
 * §13.3's `time_running` notification, and the reason a forgotten Friday timer
 * never quietly becomes 70 hours of "effort".
 *
 * Deliberately does NOT stop anything. Nobody's recorded time is edited by a
 * background rule; the owner is told, and the owner decides.
 */
export function staleRunning(
  entries: TimeEntryLike[],
  now: Date,
  hours = 8,
): TimeEntryLike[] {
  const threshold = hours * HOUR_SECONDS;
  return entries.filter(
    (entry) => entry.ended_at === null && elapsedSeconds(entry, now) >= threshold,
  );
}

/**
 * A duration as a person says it: "2h 15m", "45m", "0m".
 *
 * Minutes are FLOORED, never rounded up: a chip that says 1m before a minute
 * has passed is a small lie about a number the firm may later read back as
 * effort. Seconds are only ever shown by the running clock (formatClock).
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0m";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/**
 * The ticking face of a running timer: "0:07", "12:34", "1:02:03".
 *
 * Separate from formatDuration because a clock that is counting has to move
 * every second to look alive, while a stored total that moved every second
 * would look unstable.
 */
export function formatClock(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(total / HOUR_SECONDS);
  const minutes = Math.floor((total % HOUR_SECONDS) / 60);
  const secs = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  return hours > 0
    ? `${hours}:${mm}:${String(secs).padStart(2, "0")}`
    : `${mm}:${String(secs).padStart(2, "0")}`;
}

/** The caller's own open timer, flattened for the chip. */
export type RunningSummary = {
  entryId: string;
  leadId: string | null;
  matterId: string | null;
  startedAt: string;
  /**
   * Resolved from the leads already on screen. Null when the timer is running
   * on something this page isn't showing — the chip then says "another lead"
   * rather than naming a record the reader may not be entitled to see.
   */
  leadName: string | null;
};

export type LeadTimeSummary = {
  /** This week's total for the lead, running time included. */
  seconds: number;
  /** Who logged it, biggest first — the hover. */
  byUser: UserTotal[];
};

/**
 * Everything the ⏱ chips on one page need, in one object.
 *
 * `byLeadId` is deliberately sparse: a lead with no time this week has NO key,
 * which lets the chip tell "nobody logged anything" (0m) apart from "the read
 * failed" (the page passes the whole object as null and the chip shows —).
 * That is the three-state rule (AGENTS.md) applied to a very small number.
 */
export type IntakeTime = {
  weekStartIso: string;
  byLeadId: Record<string, LeadTimeSummary>;
  running: RunningSummary | null;
};

export function buildIntakeTime(input: {
  entries: TimeEntryLike[];
  /** The caller's open timer, wherever it is. */
  running: TimeEntryLike | null;
  now: Date;
  /** lead id → display name, for naming the lead a running timer sits on. */
  leadNames?: Record<string, string>;
}): IntakeTime {
  const { entries, running, now, leadNames } = input;

  // The open timer may have started before this week's window, so it is merged
  // in rather than assumed to be in `entries` — and deduped by id, because
  // when it DID start this week it is in both and would otherwise count twice.
  const merged = running && !entries.some((entry) => entry.id === running.id)
    ? [...entries, running]
    : entries;

  const weekStartMs = startOfWeek(now).getTime();
  const byLead = new Map<string, TimeEntryLike[]>();
  for (const entry of merged) {
    if (!entry.lead_id) continue;
    if (!countsForWeek(entry, weekStartMs)) continue;
    const list = byLead.get(entry.lead_id) ?? [];
    list.push(entry);
    byLead.set(entry.lead_id, list);
  }

  const byLeadId: Record<string, LeadTimeSummary> = {};
  for (const [leadId, list] of byLead) {
    byLeadId[leadId] = {
      seconds: list.reduce((total, entry) => total + elapsedSeconds(entry, now), 0),
      byUser: totalsByUser(list, now),
    };
  }

  return {
    weekStartIso: new Date(weekStartMs).toISOString(),
    byLeadId,
    running: running
      ? {
          entryId: running.id,
          leadId: running.lead_id,
          matterId: running.matter_id,
          startedAt: running.started_at,
          leadName: (running.lead_id && leadNames?.[running.lead_id]) || null,
        }
      : null,
  };
}
