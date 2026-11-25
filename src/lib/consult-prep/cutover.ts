import { zonedInstant } from "@/lib/deal/times";

/**
 * S2c: the switch-over from lawmatics-mcp's pre-consult brief to Lectual's (pure; no clock, no env: the caller passes both in).
 *
 * lawmatics-mcp hands each 24 h and 1 h brief to Resend with `scheduled_at` ahead of time and never cancels one. Setting its
 * `CONSULT_PREP_ENABLED=false` stops NEW schedules only, and Lectual cannot cancel the old ones (they sit on another Resend
 * account). So for the briefs lawmatics-mcp may already have handed over, Lectual sends nothing: `CONSULT_PREP_CUTOVER_AT` is
 * the moment lawmatics-mcp is switched off, and `lawmaticsReach` works out, from its own slot rules, the latest send time it can
 * have scheduled by then.
 *
 * lawmatics-mcp's rules (its `src/consult-brief/slots.ts`, read for this): two runs a day, 7:30 AM and 8:00 PM in
 * America/New_York (weekend slots dropped when its BRIEF_WEEKDAYS_ONLY is "true"). A run acts for slot S when it fires up to 1 h
 * before S (EARLY_TICK_MS). It schedules only send times in [S, N), N being the next slot, plus, for a MORNING run only, 1 h briefs
 * in [N, N + 3 h) (LATE_EOD_GRACE_MS). Everything else it sends at once, i.e. before it was switched off. So the furthest it can
 * reach is N (24 h briefs) and N + 3 h (1 h briefs, after a morning slot) of the last slot it could act for: the latest slot at or
 * before cutover + 1 h. Its weekday setting is not known here, so both settings are worked out and the later reach wins (it only
 * differs from Friday evening to Monday morning).
 */

export const LAWMATICS_TZ = "America/New_York";
const HOUR_MS = 3_600_000;
const EARLY_TICK_MS = HOUR_MS;
const LATE_EOD_GRACE_MS = 3 * HOUR_MS;
const SLOTS = [
  { kind: "morning" as const, hour: 7, minute: 30 },
  { kind: "eod" as const, hour: 20, minute: 0 },
];

/**
 * The latest send time lawmatics-mcp can have handed to Resend: `day` for its 24 h briefs, `hour` for its 1 h briefs (exclusive).
 * `seenBy`: the earliest moment its LAST run before the switch-over can have fired (that run's slot - 1 h, the earlier of the two
 * weekday settings). A consult Lectual knew of only after it is one lawmatics-mcp may never have seen, so Lectual briefs it.
 */
export type CutoverReach = { day: number; hour: number; seenBy: number };

const ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * `CONSULT_PREP_CUTOVER_AT` as an instant, or null. Only a full ISO instant WITH a zone ("2026-12-01T15:00:00-05:00",
 * "2026-12-01T20:00:00Z") counts: a date alone or a time with no zone would be read in the server's zone, so it is ignored.
 */
export function parseCutoverAt(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  const m = ISO_INSTANT.exec(v);
  if (!m) return null;
  // An impossible date or time (Feb 30, hour 24, an offset past 14 h) is refused: the parts must come back unchanged from a real date.
  const [y, mo, d, h, mi, sec] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number);
  const wall = new Date(Date.UTC(y, mo - 1, d, h, mi, sec));
  if (wall.getUTCFullYear() !== y || wall.getUTCMonth() !== mo - 1 || wall.getUTCDate() !== d || wall.getUTCHours() !== h || wall.getUTCMinutes() !== mi || wall.getUTCSeconds() !== sec) return null;
  if (m[7] && (Number(m[8]) > 14 || Number(m[9]) > 59)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

type Slot = { kind: "morning" | "eod"; at: number };

function slotsAround(cutoverMs: number, weekdaysOnly: boolean): Slot[] {
  const c = new Date(cutoverMs);
  const out: Slot[] = [];
  for (let d = -9; d <= 9; d += 1) {
    const day = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), c.getUTCDate() + d));
    const wd = day.getUTCDay();
    if (weekdaysOnly && (wd === 0 || wd === 6)) continue;
    for (const s of SLOTS) {
      out.push({ kind: s.kind, at: zonedInstant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), s.hour, s.minute, LAWMATICS_TZ).getTime() });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

function reachFor(cutoverMs: number, weekdaysOnly: boolean): CutoverReach {
  const slots = slotsAround(cutoverMs, weekdaysOnly);
  let i = -1;
  for (let j = 0; j < slots.length; j += 1) if (slots[j].at <= cutoverMs + EARLY_TICK_MS) i = j;
  // Nine days either side always holds a slot before and after the cutover (a skipped weekend is two days).
  if (i < 0 || i >= slots.length - 1) return { day: cutoverMs + 7 * 24 * HOUR_MS, hour: cutoverMs + 7 * 24 * HOUR_MS, seenBy: cutoverMs - 7 * 24 * HOUR_MS };
  const next = slots[i + 1].at;
  return { day: next, hour: slots[i].kind === "morning" ? next + LATE_EOD_GRACE_MS : next, seenBy: slots[i].at - EARLY_TICK_MS };
}

/** How far lawmatics-mcp's last runs before `cutoverMs` can have scheduled briefs, under either weekday setting. */
export function lawmaticsReach(cutoverMs: number): CutoverReach {
  const a = reachFor(cutoverMs, false);
  const b = reachFor(cutoverMs, true);
  // The reach is the LATER of the two settings (more is left to lawmatics-mcp); `seenBy` the EARLIER (fewer consults count as seen).
  // Both lean toward the attorney getting a brief: a possible duplicate beats no brief.
  return { day: Math.max(a.day, b.day), hour: Math.max(a.hour, b.hour), seenBy: Math.min(a.seenBy, b.seenBy) };
}

/**
 * Is this Lectual email one lawmatics-mcp may already have covered? Only an EVENT-keyed prep (a stage-keyed one has no consult time and
 * lawmatics-mcp briefs only booked consults) and only a kind it could have scheduled:
 *   24h     its own 24 h brief went out, or is waiting at Resend: start - 24 h < reach.day
 *   1h      likewise: start - 1 h < reach.hour
 *   booked  lawmatics-mcp sends no "booked" email, but the plan's rule is that Lectual sends it only when lawmatics-mcp sent nothing for
 *           this consult: suppressed when either of its briefs was in reach.
 */
/**
 * What Lectual knows of a consult for the switch-over rule. `null`: not a Lawmatics consult (an Outlook-only event, which
 * lawmatics-mcp never briefs): the rule does not apply. Otherwise `knownSinceMs` is when Lectual's copy of the Lawmatics row was
 * written at its current start (the later of its `created_at` and `synced_at`, so a reschedule counts as new), or null when unknown.
 */
export type LawmaticsConsult = { knownSinceMs: number | null } | null;

/**
 * The reach to apply to one prep's emails, or null for none: a re-run, a stage-keyed prep, an Outlook-only consult, and a consult
 * Lectual first knew of (at this start) after lawmatics-mcp's last run had fired get no cutover rule. They are Lectual's to brief.
 * An unknown `knownSinceMs` keeps the time-only rule.
 */
export function cutoverFor(reach: CutoverReach | null, consult: LawmaticsConsult | undefined, opts: { rerun?: boolean } = {}): CutoverReach | null {
  if (!reach || opts.rerun || !consult) return null;
  if (consult.knownSinceMs !== null && Number.isFinite(consult.knownSinceMs) && consult.knownSinceMs > reach.seenBy) return null;
  return reach;
}

export function supersededByCutover(kind: "booked" | "24h" | "1h", startsAtMs: number | null, reach: CutoverReach | null): boolean {
  if (!reach || startsAtMs === null || !Number.isFinite(startsAtMs)) return false;
  const day = startsAtMs - 24 * HOUR_MS < reach.day;
  const hour = startsAtMs - HOUR_MS < reach.hour;
  if (kind === "24h") return day;
  if (kind === "1h") return hour;
  return day || hour;
}

/**
 * S2c (B): real consult prep emails start only once the switch-over has happened: `CONSULT_PREP_CUTOVER_AT` set, valid, and now at or
 * after it. Unset, invalid or still ahead = NO email (fail closed). Builds, queue items, markers and saved files are not affected.
 */
export function emailsStarted(cutoverAtMs: number | null | undefined, nowMs: number): boolean {
  return typeof cutoverAtMs === "number" && Number.isFinite(cutoverAtMs) && nowMs >= cutoverAtMs;
}
