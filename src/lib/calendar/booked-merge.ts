import type { OutlookCalendarEvent, OutlookRead } from "./outlook-read";

/**
 * Pure rules shared by the consult readers that now have two stored sources (Outlook and the Lawmatics daily sync).
 * No database, no clock: tested on their own.
 */

/** Lawmatics as a consult source: connected (`active`), connected but its key refused (`invalid`), not, or unreadable. */
export type LawmaticsGate = "active" | "invalid" | "not-connected" | "unavailable";

export function lawmaticsGateOf(read: { ok: true; connection: { status: string } | null } | { ok: false }): LawmaticsGate {
  if (!read.ok) return "unavailable";
  if (!read.connection || read.connection.status === "revoked") return "not-connected";
  return read.connection.status === "active" ? "active" : "invalid";
}

type BookedRead = OutlookRead<{ event: OutlookCalendarEvent | null }> | null;

/**
 * "Consult booked" from several reads (null = not read). The earliest event found in any read that worked is shown:
 * a booked consult is true whichever source said so. With no event: a failed read says it couldn't be checked (never
 * "no consult"), then "not switched on yet", then none. Null when nothing was read at all.
 */
export function mergeBookedConsults(reads: readonly BookedRead[]): BookedRead {
  const done = reads.filter((r): r is NonNullable<BookedRead> => r !== null);
  if (done.length === 0) return null;
  const events = done.flatMap((r) => (r.status === "ok" && r.event ? [r.event] : []));
  if (events.length > 0) {
    const earliest = events.reduce((a, b) => (Date.parse(b.starts_at) < Date.parse(a.starts_at) ? b : a));
    return { status: "ok", event: earliest };
  }
  if (done.some((r) => r.status === "unavailable")) return { status: "unavailable" };
  if (done.some((r) => r.status === "database-update-needed")) return { status: "database-update-needed" };
  return { status: "ok", event: null };
}

/** Two rows for the same call: within this many minutes of each other, on the same lead. */
export const SAME_CALL_MINUTES = 15;

export function sameLeadSameTime(a: { leadId: string | null; startsAt: string }, b: { leadId: string | null; startsAt: string }): boolean {
  if (!a.leadId || a.leadId !== b.leadId) return false;
  const d = Math.abs(Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return Number.isFinite(d) && d <= SAME_CALL_MINUTES * 60_000;
}
