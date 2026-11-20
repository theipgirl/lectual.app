/**
 * The 30- and 7-day deadline alerts (PGE Sprint 3 Part A). Pure: no database, no clock (today's civil date is
 * passed in), so Today's card, the bell notices and the morning brief share ONE set of windows.
 *
 *  - Windows: a deadline due in 0..7 days is in the 7-day window; 8..30 days, the 30-day window. Overdue ones
 *    head the card but raise no notice (they already passed both windows).
 *  - Recipients: a firm note (`crm_firm_brain_entry`, category `other`, key `deadline_alert_recipients`,
 *    `data.user_ids`) that the admin tier sets in Settings -> Team. No names in code and no new table. A user id
 *    that is no longer a member is dropped when the list is read, so a removed member gets nothing.
 *  - One notice per deadline per window. There is no unique index to lean on (no schema), so the de-dupe is the
 *    recipient's OWN bell: the notice is raised for the signed-in recipient on their Today, after reading their own
 *    `crm_notification` rows for those deadlines (RLS lets a person read only their own). A failed read raises
 *    nothing (a missed duplicate check must never become a flood).
 */

export const DEADLINE_ALERT_KEY = "deadline_alert_recipients";
export const DEADLINE_NOTICE_SOURCE = "deadline_window";
export const ALERT_WINDOWS = [30, 7] as const;
export type AlertWindow = (typeof ALERT_WINDOWS)[number];
/** At most this many notices are raised on one Today load (the rest follow on the next). */
export const NOTICES_PER_LOAD = 20;

const DAY = 86_400_000;

/** Whole days from `today` to `due` (both YYYY-MM-DD civil dates). Negative = overdue. */
export function civilDaysUntil(due: string, today: string): number | null {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${due.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / DAY);
}

/** 7 for 0..7 days out, 30 for 8..30, null otherwise (overdue, further out, or unreadable). */
export function alertWindow(daysUntil: number | null): AlertWindow | null {
  if (daysUntil === null || daysUntil < 0) return null;
  if (daysUntil <= 7) return 7;
  if (daysUntil <= 30) return 30;
  return null;
}

// ── recipients ──────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The stored list: `{ user_ids: [...] }`. Anything else, or a non-uuid entry, is dropped; never throws. */
export function parseRecipientData(data: unknown): string[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const ids = (data as { user_ids?: unknown }).user_ids;
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((x): x is string => typeof x === "string" && UUID.test(x)).map((x) => x.toLowerCase()))];
}

/**
 * The roles that can be alert recipients: the eight staff roles lectual 0056's `crm_notification_insert_staff` lets insert a
 * notification in the active org (the notice is raised by the recipient's own Today). A viewer or social media member could
 * never be told, so they cannot be chosen.
 */
export const ALERT_RECIPIENT_ROLES: readonly string[] = ["owner", "admin", "senior_admin", "intake", "paralegal", "law_clerk", "attorney", "clerk"];

export const canReceiveDeadlineAlerts = (role: string | null | undefined): boolean => !!role && ALERT_RECIPIENT_ROLES.includes(role);

export type AlertMemberRef = { userId: string; role: string | null | undefined };

/** Only current members in an eligible role count: a removed member's, or a demoted viewer's, id stays stored but gets nothing. */
export function currentRecipients(stored: readonly string[], members: readonly AlertMemberRef[]): string[] {
  const eligible = new Set(members.filter((m) => canReceiveDeadlineAlerts(m.role)).map((m) => m.userId.toLowerCase()));
  return stored.filter((id) => eligible.has(id.toLowerCase()));
}

export type RecipientRead = { status: "ok"; userIds: string[] } | { status: "unavailable" };

export function isRecipient(read: RecipientRead, userId: string): boolean | null {
  if (read.status !== "ok") return null;
  return read.userIds.some((id) => id.toLowerCase() === userId.toLowerCase());
}

// ── the card ────────────────────────────────────────────────────────────────

export type AlertDeadline = {
  id: string;
  matterId: string;
  title: string;
  dueDate: string;
  confirmed: boolean;
  matterLabel: string;
};

export type DeadlineCardGroups = { overdue: AlertDeadline[]; week: AlertDeadline[]; month: AlertDeadline[] };

/** Overdue on top (oldest first), then due in 7 days, then due in 8..30 days; soonest first inside each. */
export function deadlineCardGroups(deadlines: readonly AlertDeadline[], today: string): DeadlineCardGroups {
  const out: DeadlineCardGroups = { overdue: [], week: [], month: [] };
  const sorted = [...deadlines].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  for (const d of sorted) {
    const days = civilDaysUntil(d.dueDate, today);
    if (days === null) continue;
    if (days < 0) out.overdue.push(d);
    else if (days <= 7) out.week.push(d);
    else if (days <= 30) out.month.push(d);
  }
  return out;
}

// ── the notices ─────────────────────────────────────────────────────────────

export type NoticePlan = { deadlineId: string; matterId: string; window: AlertWindow; title: string };

/** `deadline_id:window`, the de-dupe key. */
export const noticeKey = (deadlineId: string, window: number) => `${deadlineId}:${window}`;

/** The keys already raised, from the recipient's own notification payloads. */
export function raisedKeys(payloads: readonly unknown[]): Set<string> {
  const keys = new Set<string>();
  for (const p of payloads) {
    if (!p || typeof p !== "object") continue;
    const r = p as Record<string, unknown>;
    if (r.source !== DEADLINE_NOTICE_SOURCE || typeof r.deadline_id !== "string") continue;
    const w = Number(r.window);
    if (w === 7 || w === 30) keys.add(noticeKey(r.deadline_id, w));
  }
  return keys;
}

/**
 * The notices to raise now: each open deadline in a window whose key has not been raised, soonest first, capped.
 * `raised` null (the de-dupe read failed) raises NOTHING.
 */
export function noticesToRaise(deadlines: readonly AlertDeadline[], today: string, raised: ReadonlySet<string> | null, cap = NOTICES_PER_LOAD): NoticePlan[] {
  if (raised === null) return [];
  const out: NoticePlan[] = [];
  const sorted = [...deadlines].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
  for (const d of sorted) {
    const window = alertWindow(civilDaysUntil(d.dueDate, today));
    if (window === null || raised.has(noticeKey(d.id, window))) continue;
    out.push({ deadlineId: d.id, matterId: d.matterId, window, title: d.title });
    if (out.length >= cap) break;
  }
  return out;
}

/** The notification payload: ids, the window and the deadline's title, nothing else. */
export function noticePayload(plan: NoticePlan): Record<string, unknown> {
  return { source: DEADLINE_NOTICE_SOURCE, deadline_id: plan.deadlineId, window: plan.window, title: plan.title.slice(0, 120) };
}
