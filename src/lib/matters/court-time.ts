/**
 * Court wall-clock ↔ instant conversion for hearing times.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * `crm_litigation_detail.next_hearing_at` is `timestamptz` — a true instant —
 * but a hearing is a WALL-CLOCK fact of a courtroom: "Aug 25, 10:00am, Judge
 * Carassas". Something has to choose the zone that maps between the two, and
 * getting it wrong is not cosmetic. Cabanis Law's imported docket stores that
 * Pinellas hearing as `2026-08-25 14:00:00+00`, because 10:00am Eastern IS
 * 14:00 UTC. Formatting that instant in UTC would show the attorney "2:00 PM"
 * for a hearing she must attend at 10:00 — a four-hour error on a court date.
 *
 * So the zone is the COURT's, not UTC and not the server's. Every Florida
 * county in this docket — Hillsborough, Broward, Pinellas, Miami-Dade, Lee,
 * Marion, Manatee, Palm Beach, Orange — sits in Eastern time, and the rest of
 * the dashboard already formats timestamps in `America/New_York` (the queue,
 * inbox, import and discovery surfaces all do). This module is that same
 * decision, made once and applied to both directions so a time typed into the
 * form round-trips to the same time on the card — for every reading the court
 * can actually sit at. The one hour a year that does not exist locally (the
 * spring-forward gap) has no instant to map to and is nudged forwards, not
 * silently back an hour; no court sets a hearing in it.
 *
 * Eastern is a deliberate constant, not a guess at the user's locale: a
 * paralegal opening the docket from another state must see the time the court
 * will call the case, not the time on their own wall. If this product ever
 * takes a firm litigating in the Florida panhandle (Central) or another state,
 * the zone becomes a per-org or per-matter column — at which point this
 * constant is the single place that has to change.
 *
 * DST is handled by asking Intl for the offset actually in force at the
 * instant in question rather than assuming a fixed -5/-4, so an October
 * hearing and a January hearing both round-trip correctly. An ambiguous
 * reading on the fall-back morning resolves to the first (EDT) occurrence.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Pure module: no server imports and no DB access, so the card (a client
 * component) and the server action can share it.
 */

/** The zone every court in this docket sits in. See the note above. */
export const COURT_TIME_ZONE = "America/New_York";

/**
 * How far `tz` is from UTC at a given instant, in milliseconds.
 *
 * Intl is the only DST table in the platform, so we read the offset off it:
 * format the instant in the target zone, reassemble those fields as if they
 * were UTC, and the difference from the real instant IS the offset.
 */
function zoneOffsetMs(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const f: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") f[p.type] = Number(p.value);

  const asIfUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second);
  return asIfUtc - instant.getTime();
}

/**
 * Turns a court wall-clock reading into the instant to store.
 *
 * Two passes, because the offset depends on the very instant we are solving
 * for: guess by treating the reading as UTC, correct by the offset at that
 * guess, then re-check. The second pass only matters within an hour of a DST
 * transition — and it is taken only when it actually reproduces the reading
 * asked for, which is what keeps the spring-forward gap from being resolved
 * backwards. See the comment on the check itself.
 */
export function courtWallClockToUtcIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
  let ts = wall - zoneOffsetMs(new Date(wall), COURT_TIME_ZONE);
  const settled = zoneOffsetMs(new Date(ts), COURT_TIME_ZONE);
  const reworked = wall - settled;
  // Only take the second pass if it actually lands on the reading we were
  // asked for. On the spring-forward morning 02:30 never happens, and an
  // unconditional rework "corrects" it an hour BACKWARDS into EST rather than
  // forwards past the gap. Checking first keeps the pass where it earns its
  // keep (03:00, which a single pass gets wrong) without inventing a time.
  if (reworked !== ts && zoneOffsetMs(new Date(reworked), COURT_TIME_ZONE) === settled) {
    ts = reworked;
  }
  return new Date(ts).toISOString();
}

/** The court wall-clock fields of a stored instant. */
function courtParts(iso: string): Record<string, number> | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: COURT_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(d);
  const f: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") f[p.type] = Number(p.value);
  return f;
}

/** A stored instant as the `datetime-local` input value the court would read. */
export function toCourtDateTimeLocal(iso: string | null): string {
  if (!iso) return "";
  const f = courtParts(iso);
  if (!f) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${f.year}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour)}:${pad(f.minute)}`
  );
}

/**
 * A stored instant rendered for display, in court time.
 *
 * The zone is named in the output ("10:00 AM EDT") rather than left implicit:
 * the reader this module exists for is a paralegal opening the docket from
 * another state, and an unlabelled time invites them to read it as their own.
 */
export function formatCourtDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: COURT_TIME_ZONE,
    timeZoneName: "short",
  });
}
