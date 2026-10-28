import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectionRow } from "@/lib/mailbox/sync";
import { ProviderError, hasCalendarScope } from "@/lib/mailbox/providers";
import { isDatabaseUpdateNeeded } from "./outlook-errors";
import {
  buildLeadIndex,
  normaliseGraphEvent,
  type GraphEvent,
  type NormalisedEvent,
} from "./outlook-parse";

/**
 * The Outlook calendar read: part of the daily mailbox-sync cron, after each
 * firm's mail. For every active Microsoft connection that holds the
 * Calendars.Read permission it reads `/me/calendarView` (now - 7 days to now +
 * 30 days) and keeps `crm_calendar_event` in step with it.
 *
 * It runs as the SERVICE ROLE like the mail sync, and the same fence applies:
 * every write carries the `org_id` of the mailbox_connection row being read (a
 * value that came out of the database, never out of Graph or a request), and
 * every delete is filtered by that org, `source = 'outlook'` and that
 * connection. This file imports no admin client; the cron hands it one.
 *
 * What it never does: store an event body or preview (see outlook-parse.ts),
 * log or record a title, address, location or link (the agent_run row holds
 * counts only), touch a Lawmatics row, change a mailbox's mail status because
 * of a calendar problem (only a dead refresh token, which the mail sync would
 * flag the same way), or throw. Any failure is a count.
 *
 * DATABASE UPDATE. The columns it writes come from lectual migration 0098. Until
 * that is applied to a database, the first refused statement ends this firm's
 * calendar step as `database-update-needed` with nothing written or deleted, and
 * the mail sync carries on untouched.
 */

export const CALENDAR_AGENT = "calendar-sync";
export const LOOKBACK_DAYS = 7;
export const LOOKAHEAD_DAYS = 30;
export const PAGE_SIZE = 100;
/** A full read is at most this many pages; reaching it means the read is incomplete. */
export const MAX_PAGES = 10;
const UPSERT_CHUNK = 100;
const DELETE_CHUNK = 50;
const DAY_MS = 86_400_000;

const GRAPH_ORIGIN = "https://graph.microsoft.com/";
const CALENDAR_SELECT =
  "id,subject,start,end,isAllDay,isCancelled,location,onlineMeeting,organizer,attendees,bodyPreview";

export type OrgCalendarState = "ok" | "skipped" | "error" | "database-update-needed";

export type OrgCalendarResult = {
  orgId: string;
  state: OrgCalendarState;
  /** Connections whose calendar was read (or tried). */
  calendars: number;
  eventsRead: number;
  written: number;
  removed: number;
  /** Microsoft connections without Calendars.Read: skipped, not an empty calendar. */
  needsReconnect: number;
  failed: number;
};

export type CalendarSyncDeps = {
  admin: SupabaseClient;
  fetchImpl?: typeof fetch;
  now: number;
  /** Same refresh as the mail step, including storing a rotated refresh token. */
  getAccessToken: (row: ConnectionRow) => Promise<string>;
};

// ── Graph read ───────────────────────────────────────────────────────────────

export type CalendarRead = {
  events: GraphEvent[];
  /** True only when every page was read to the end. Deleting is allowed only then. */
  complete: boolean;
  /** A page was refused or the request threw. */
  failed: boolean;
};

export function calendarWindow(now: number): { from: string; to: string } {
  return {
    from: new Date(now - LOOKBACK_DAYS * DAY_MS).toISOString(),
    to: new Date(now + LOOKAHEAD_DAYS * DAY_MS).toISOString(),
  };
}

function firstPageUrl(window: { from: string; to: string }): string {
  return (
    "https://graph.microsoft.com/v1.0/me/calendarView" +
    `?startDateTime=${encodeURIComponent(window.from)}&endDateTime=${encodeURIComponent(window.to)}` +
    `&$select=${CALENDAR_SELECT}&$top=${PAGE_SIZE}`
  );
}

export async function readCalendarView(args: {
  accessToken: string;
  window: { from: string; to: string };
  fetchImpl?: typeof fetch;
}): Promise<CalendarRead> {
  const doFetch = args.fetchImpl ?? fetch;
  const events: GraphEvent[] = [];
  let url: string | null = firstPageUrl(args.window);
  for (let page = 0; url; page += 1) {
    if (page >= MAX_PAGES) return { events, complete: false, failed: false };
    try {
      const res: Response = await doFetch(url, {
        headers: { authorization: `Bearer ${args.accessToken}`, prefer: 'outlook.timezone="UTC"' },
      });
      if (!res.ok) return { events, complete: false, failed: true };
      const json = (await res.json()) as { value?: GraphEvent[]; "@odata.nextLink"?: string };
      events.push(...(Array.isArray(json.value) ? json.value : []));
      const next: unknown = json["@odata.nextLink"];
      // The bearer token goes only back to Graph itself, whatever a payload says.
      url = typeof next === "string" && next.startsWith(GRAPH_ORIGIN) ? next : null;
      if (typeof next === "string" && url === null) return { events, complete: false, failed: true };
    } catch {
      return { events, complete: false, failed: true };
    }
  }
  return { events, complete: true, failed: false };
}

// ── writes ───────────────────────────────────────────────────────────────────

function eventRows(conn: ConnectionRow, events: NormalisedEvent[], nowIso: string) {
  return events.map((e) => ({
    org_id: conn.org_id,
    source: "outlook" as const,
    external_id: e.externalId,
    mailbox_connection_id: conn.id,
    title: e.row.title,
    starts_at: e.row.starts_at,
    ends_at: e.row.ends_at,
    all_day: e.row.all_day,
    location: e.row.location,
    join_url: e.row.join_url,
    organizer_email: e.row.organizer_email,
    attendee_emails: e.row.attendee_emails,
    is_consult: e.row.is_consult,
    lead_id: e.row.lead_id,
    synced_at: nowIso,
    updated_at: nowIso,
  }));
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type ConnectionWork =
  | { kind: "done"; eventsRead: number; written: number; removed: number; failed: boolean }
  | { kind: "database-update-needed" };

/** Upsert what was read, then (complete reads only) remove what vanished. */
async function writeConnection(
  deps: CalendarSyncDeps,
  conn: ConnectionRow,
  read: CalendarRead,
  stored: NormalisedEvent[],
  window: { from: string; to: string },
): Promise<ConnectionWork> {
  const { admin } = deps;
  const nowIso = new Date(deps.now).toISOString();
  let failed = read.failed;
  let written = 0;
  let removed = 0;

  // One row per external id: a repeated id in a single upsert is refused by Postgres.
  const unique = [...new Map(stored.map((e) => [e.externalId, e])).values()];
  for (const batch of chunks(eventRows(conn, unique, nowIso), UPSERT_CHUNK)) {
    const { error } = await admin
      .from("crm_calendar_event")
      .upsert(batch as never, { onConflict: "org_id,source,external_id" });
    if (error) {
      if (isDatabaseUpdateNeeded(error)) return { kind: "database-update-needed" };
      failed = true;
      continue;
    }
    written += batch.length;
  }

  // An incomplete or failed read proves nothing about what vanished.
  if (read.complete && !read.failed) {
    const keep = new Set(unique.map((e) => e.externalId));
    const present = await existingExternalIds(admin, conn, window);
    if (present === "database-update-needed") return { kind: "database-update-needed" };
    if (present === null) {
      failed = true;
    } else {
      const vanished = present.filter((id) => !keep.has(id));
      for (const batch of chunks(vanished, DELETE_CHUNK)) {
        const { error } = await admin
          .from("crm_calendar_event")
          .delete()
          .eq("org_id", conn.org_id)
          .eq("source", "outlook")
          .eq("mailbox_connection_id", conn.id)
          .gte("starts_at", window.from)
          .lt("starts_at", window.to)
          .in("external_id", batch);
        if (error) {
          if (isDatabaseUpdateNeeded(error)) return { kind: "database-update-needed" };
          failed = true;
          continue;
        }
        removed += batch.length;
      }
    }
  }
  return { kind: "done", eventsRead: read.events.length, written, removed, failed };
}

/** The Outlook events this connection already holds inside the window; null when they could not be listed. */
async function existingExternalIds(
  admin: SupabaseClient,
  conn: ConnectionRow,
  window: { from: string; to: string },
): Promise<string[] | "database-update-needed" | null> {
  const ids: string[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await admin
      .from("crm_calendar_event")
      .select("external_id")
      .eq("org_id", conn.org_id)
      .eq("source", "outlook")
      .eq("mailbox_connection_id", conn.id)
      .gte("starts_at", window.from)
      .lt("starts_at", window.to)
      .range(from, from + 999);
    if (error) return isDatabaseUpdateNeeded(error) ? "database-update-needed" : null;
    const rows = (data ?? []) as Array<{ external_id: string | null }>;
    for (const r of rows) if (r.external_id) ids.push(r.external_id);
    if (rows.length < 1000) break;
  }
  return ids;
}

// ── the run row ──────────────────────────────────────────────────────────────

/** Counts only: never a title, address, location or link. */
function runSummary(r: OrgCalendarResult): string {
  return (
    `${r.calendars} calendar(s) read, ${r.eventsRead} event(s) read, ${r.written} written, ${r.removed} removed, ` +
    `${r.needsReconnect} need reconnecting, ${r.failed} failed.`
  );
}

async function startRun(admin: SupabaseClient, orgId: string, nowIso: string): Promise<{ id: string | null; refused: boolean }> {
  const { data, error } = await admin
    .from("agent_run")
    .insert({ org_id: orgId, agent: CALENDAR_AGENT, trigger: "cron", status: "running", started_at: nowIso })
    .select("id")
    .single();
  // 23514: agent_run's agent CHECK doesn't list calendar-sync yet (0098 not applied).
  if (error && (error.code === "23514" || isDatabaseUpdateNeeded(error))) return { id: null, refused: true };
  return { id: (data as { id?: string } | null)?.id ?? null, refused: false };
}

async function finishRun(deps: CalendarSyncDeps, runId: string | null, orgId: string, r: OrgCalendarResult): Promise<void> {
  if (!runId) return;
  const waiting = r.state === "database-update-needed";
  await deps.admin
    .from("agent_run")
    .update({
      status: waiting ? "skipped" : r.state,
      finished_at: new Date(deps.now).toISOString(),
      items_in: r.eventsRead,
      drafts_out: 0,
      summary: waiting ? "Calendar sync isn't switched on for your firm yet." : runSummary(r),
      error: r.state === "error" ? `${r.failed} calendar(s) could not be read; see Settings → Integrations.` : null,
    })
    .eq("id", runId)
    .eq("org_id", orgId);
}

// ── one firm ─────────────────────────────────────────────────────────────────

/** ok when at least one calendar was read cleanly; skipped when nothing needed trying; error when everything tried failed. */
function tally(r: OrgCalendarResult, attemptedFailed: number): OrgCalendarState {
  if (r.calendars === 0) return r.failed === 0 ? "skipped" : "error";
  return attemptedFailed >= r.calendars ? "error" : "ok";
}

/**
 * The calendar step for one firm. `connections` are the firm's mailbox rows the
 * mail step just ran over; `mailDead` holds the ids whose mail sync found the
 * refresh token dead (no point trying their calendar). `leads` is the firm's
 * already-loaded lead list, or null when it could not be loaded.
 *
 * Returns null for a firm with no Microsoft connection (nothing to do, no run
 * row). Never throws.
 */
export async function syncOrgCalendars(
  deps: CalendarSyncDeps,
  args: {
    orgId: string;
    connections: ConnectionRow[];
    mailDead: ReadonlySet<string>;
    leads: ReadonlyArray<{ id: string; email: string | null }> | null;
  },
): Promise<OrgCalendarResult | null> {
  const { orgId } = args;
  const mine = args.connections.filter((c) => c.org_id === orgId);
  const microsoft = mine.filter((c) => c.provider === "microsoft");
  if (microsoft.length === 0) return null;

  const result: OrgCalendarResult = {
    orgId,
    state: "ok",
    calendars: 0,
    eventsRead: 0,
    written: 0,
    removed: 0,
    needsReconnect: 0,
    failed: 0,
  };
  let runId: string | null = null;
  try {
    const run = await startRun(deps.admin, orgId, new Date(deps.now).toISOString());
    if (run.refused) return { ...result, state: "database-update-needed" };
    runId = run.id;

    const leadIndex = buildLeadIndex(args.leads ?? []);
    const firmAddresses = new Set(mine.map((c) => c.email.trim().toLowerCase()));
    const window = calendarWindow(deps.now);
    let attemptedFailed = 0;

    for (const conn of microsoft) {
      if (!hasCalendarScope(conn.provider, conn.scopes)) {
        result.needsReconnect += 1;
        continue;
      }
      if (args.mailDead.has(conn.id) || args.leads === null) {
        result.failed += 1;
        continue;
      }
      result.calendars += 1;
      try {
        const accessToken = await deps.getAccessToken(conn);
        const read = await readCalendarView({ accessToken, window, fetchImpl: deps.fetchImpl });
        const stored = read.events
          .map((e) => normaliseGraphEvent(e, { leadIndex, firmAddresses }))
          .filter((e): e is NormalisedEvent => e !== null);
        const work = await writeConnection(deps, conn, read, stored, window);
        if (work.kind === "database-update-needed") {
          result.state = "database-update-needed";
          break;
        }
        result.eventsRead += work.eventsRead;
        result.written += work.written;
        result.removed += work.removed;
        if (work.failed) {
          result.failed += 1;
          attemptedFailed += 1;
        }
      } catch (err) {
        result.failed += 1;
        attemptedFailed += 1;
        if (err instanceof ProviderError && err.code === "reauth") await markReauth(deps, conn, err.message);
      }
    }

    if (result.state !== "database-update-needed") result.state = tally(result, attemptedFailed);
  } catch {
    // Nothing here may stop the mail sync's own bookkeeping.
    result.state = result.state === "database-update-needed" ? result.state : "error";
  }
  await finishRun(deps, runId, orgId, result).catch(() => undefined);
  return result;
}

/** The same status the mail sync sets for a dead refresh token. */
async function markReauth(deps: CalendarSyncDeps, conn: ConnectionRow, message: string): Promise<void> {
  await deps.admin
    .from("mailbox_connection")
    .update({ status: "reauth", last_error: message.slice(0, 500), updated_at: new Date(deps.now).toISOString() })
    .eq("id", conn.id)
    .eq("org_id", conn.org_id);
}
