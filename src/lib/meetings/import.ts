import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/lib/db/types";
import { openToken, sealToken } from "@/lib/mailbox/crypto";
import { listFathomMeetings } from "./fathom";
import { listZoomMeetings, refreshZoomToken, type ZoomClientCredentials } from "./zoom";
import { decideLinks, NO_LINK, type MatchContext } from "./match";
import {
  MeetingAuthError,
  boundMeeting,
  type FetchLike,
  type MeetingProvider,
  type NormalizedMeeting,
} from "./types";

/**
 * The meetings import, for ONE connection: pull what is new from that firm's
 * own Fathom / Zoom account, and write it into crm_meeting.
 *
 * It runs as the SERVICE ROLE (crm_meeting has no INSERT grant for signed-in
 * users, and the daily cron has nobody signed in). That makes tenant
 * isolation this file's job, so the rule is mechanical: every read and write
 * is fenced on the org_id of the meeting_source_connection row being imported
 * — a value that came out of the database, never out of a request. The admin
 * "Import now" button reaches the same code with a connection row its own RLS
 * read returned.
 *
 * Idempotent: rows are keyed on (org_id, provider, external_id). A meeting
 * seen again has its content refreshed (a transcript that arrived late fills
 * in) and its links left alone — links are staff's.
 */

/** First run looks back this far; later runs re-read this much overlap before the cursor. */
export const FIRST_IMPORT_DAYS = 30;
export const CURSOR_OVERLAP_MS = 2 * 86_400_000;

export const SECRET_COLUMNS =
  "id, org_id, provider, status, api_key_enc, access_token_enc, refresh_token_enc, token_expires_at, import_cursor";

export type ConnectionSecrets = {
  id: string;
  org_id: string;
  provider: MeetingProvider;
  status: string;
  api_key_enc: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  import_cursor: string | null;
};

export type ExistingMeeting = { id: string; linked: boolean };

/** The persistence the importer needs. Production: adminMeetingStore(); tests: an in-memory map. */
export type MeetingStore = {
  existing(orgId: string, provider: MeetingProvider, externalIds: string[]): Promise<Map<string, ExistingMeeting>>;
  insert(rows: Record<string, unknown>[]): Promise<void>;
  update(orgId: string, id: string, patch: Record<string, unknown>): Promise<void>;
  matchContext(orgId: string): Promise<MatchContext>;
};

export type UpsertCounts = { inserted: number; updated: number; linked: number; suggested: number };

function contentOf(m: NormalizedMeeting) {
  return {
    title: m.title,
    started_at: m.startedAt,
    duration_seconds: m.durationSeconds,
    attendees: m.attendees as unknown as Json,
    share_url: m.shareUrl,
  };
}

/**
 * Writes one batch of normalized meetings for one firm. Pure over `store`.
 * New rows get the attendee-email link decision (match.ts); existing rows get
 * fresh content, keep their links, and never lose a transcript or summary to
 * a later read that came back without one.
 */
export async function upsertMeetings(
  store: MeetingStore,
  args: { orgId: string; provider: MeetingProvider; importedBy: string | null; now: number },
  batch: NormalizedMeeting[],
): Promise<UpsertCounts> {
  const counts: UpsertCounts = { inserted: 0, updated: 0, linked: 0, suggested: 0 };
  // Last one wins inside a batch (overlapping windows can repeat a meeting).
  const byId = new Map<string, NormalizedMeeting>();
  for (const raw of batch) {
    const m = boundMeeting(raw);
    if (m.externalId) byId.set(m.externalId, m);
  }
  if (byId.size === 0) return counts;

  const existing = await store.existing(args.orgId, args.provider, [...byId.keys()]);
  const fresh = [...byId.values()].filter((m) => !existing.has(m.externalId));
  const needsMatch = fresh.some((m) => m.attendees.some((a) => a.email));
  const ctx = needsMatch ? await store.matchContext(args.orgId) : null;
  const nowIso = new Date(args.now).toISOString();

  const inserts: Record<string, unknown>[] = [];
  for (const m of fresh) {
    const d = ctx ? decideLinks(m.attendees, m.hostEmails, ctx) : NO_LINK;
    const auto = Boolean(d.leadId || d.matterId);
    if (auto) counts.linked++;
    else if (d.suggestedLeadId || d.suggestedMatterId) counts.suggested++;
    inserts.push({
      ...contentOf(m),
      org_id: args.orgId,
      provider: args.provider,
      external_id: m.externalId,
      summary: m.summary,
      transcript: m.transcript as unknown as Json,
      lead_id: d.leadId,
      matter_id: d.matterId,
      suggested_lead_id: d.suggestedLeadId,
      suggested_matter_id: d.suggestedMatterId,
      link_source: auto ? "auto" : null,
      linked_at: auto ? nowIso : null,
      imported_at: nowIso,
      imported_by: args.importedBy,
    });
  }
  if (inserts.length > 0) {
    await store.insert(inserts);
    counts.inserted = inserts.length;
  }

  for (const m of byId.values()) {
    const row = existing.get(m.externalId);
    if (!row) continue;
    const patch: Record<string, unknown> = { ...contentOf(m) };
    if (m.transcript) patch.transcript = m.transcript as unknown as Json;
    if (m.summary) patch.summary = m.summary;
    await store.update(args.orgId, row.id, patch);
    counts.updated++;
  }
  return counts;
}

export type ImportDeps = {
  admin: SupabaseClient;
  root: Buffer;
  zoomCreds: ZoomClientCredentials | null;
  store?: MeetingStore;
  fetchImpl?: FetchLike;
  now?: () => number;
};

export type ImportOutcome =
  | { ok: true; connectionId: string; orgId: string; provider: MeetingProvider; counts: UpsertCounts; truncated: boolean }
  | { ok: false; connectionId: string; orgId: string; provider: MeetingProvider; status: "reauth" | "error"; error: string };

/** The service-role store, every statement fenced on the org_id it is handed. */
export function adminMeetingStore(admin: SupabaseClient): MeetingStore {
  return {
    async existing(orgId, provider, externalIds) {
      const out = new Map<string, ExistingMeeting>();
      for (let i = 0; i < externalIds.length; i += 200) {
        const { data, error } = await admin
          .from("crm_meeting")
          .select("id, external_id, lead_id, matter_id")
          .eq("org_id", orgId)
          .eq("provider", provider)
          .in("external_id", externalIds.slice(i, i + 200));
        if (error) throw new Error(`meeting read failed: ${error.message}`);
        for (const r of (data ?? []) as Record<string, unknown>[]) {
          out.set(String(r.external_id), {
            id: String(r.id),
            linked: Boolean(r.lead_id || r.matter_id),
          });
        }
      }
      return out;
    },
    async insert(rows) {
      const { error } = await admin.from("crm_meeting").insert(rows);
      // 23505: another run inserted the same meeting first; the next run updates it.
      if (error && error.code !== "23505") throw new Error(`meeting insert failed: ${error.message}`);
    },
    async update(orgId, id, patch) {
      const { error } = await admin.from("crm_meeting").update(patch).eq("id", id).eq("org_id", orgId);
      if (error) throw new Error(`meeting update failed: ${error.message}`);
    },
    async matchContext(orgId) {
      const leads: { id: string; email: string | null }[] = [];
      for (let from = 0; from < 20_000; from += 1000) {
        const { data, error } = await admin.from("crm_lead").select("id, email").eq("org_id", orgId).not("email", "is", null).range(from, from + 999);
        if (error) throw new Error(`lead read failed: ${error.message}`);
        leads.push(...((data ?? []) as { id: string; email: string | null }[]));
        if (!data || data.length < 1000) break;
      }
      const [c, mc, m] = await Promise.all([
        admin.from("crm_contact").select("id, email").eq("org_id", orgId).not("email", "is", null),
        admin.from("crm_matter_contact").select("contact_id, matter_id").eq("org_id", orgId),
        admin.from("crm_matter").select("id, lead_id").eq("org_id", orgId),
      ]);
      for (const r of [c, mc, m]) if (r.error) throw new Error(`match context read failed: ${r.error.message}`);
      return {
        leads,
        contacts: (c.data ?? []) as { id: string; email: string | null }[],
        matterContacts: ((mc.data ?? []) as { contact_id: string; matter_id: string }[]).map((x) => ({ contactId: x.contact_id, matterId: x.matter_id })),
        matters: ((m.data ?? []) as { id: string; lead_id: string | null }[]).map((x) => ({ id: x.id, leadId: x.lead_id })),
      };
    },
  };
}

async function markConnection(deps: ImportDeps, conn: ConnectionSecrets, patch: Record<string, unknown>): Promise<void> {
  await deps.admin
    .from("meeting_source_connection")
    .update({ ...patch, updated_at: new Date((deps.now ?? Date.now)()).toISOString() })
    .eq("id", conn.id)
    .eq("org_id", conn.org_id);
}

/** A Zoom access token good for at least two more minutes; a refresh re-seals BOTH tokens (Zoom rotates the refresh token). */
async function zoomAccessToken(deps: ImportDeps, conn: ConnectionSecrets): Promise<string> {
  const now = (deps.now ?? Date.now)();
  if (!conn.access_token_enc || !conn.refresh_token_enc) throw new MeetingAuthError("No Zoom sign-in is stored. Reconnect Zoom.");
  const expires = conn.token_expires_at ? Date.parse(conn.token_expires_at) : 0;
  if (expires - now > 120_000) return openToken(deps.root, conn.access_token_enc, "lectual-meetings");
  if (!deps.zoomCreds) throw new Error("Zoom sign-in isn't configured on this deployment.");
  const fresh = await refreshZoomToken({
    creds: deps.zoomCreds,
    refreshToken: openToken(deps.root, conn.refresh_token_enc, "lectual-meetings"),
    fetchImpl: deps.fetchImpl,
    now,
  });
  const { error } = await deps.admin
    .from("meeting_source_connection")
    .update({
      access_token_enc: sealToken(deps.root, fresh.accessToken, "lectual-meetings"),
      refresh_token_enc: sealToken(deps.root, fresh.refreshToken, "lectual-meetings"),
      token_expires_at: fresh.expiresAt,
      updated_at: new Date(now).toISOString(),
    })
    .eq("id", conn.id)
    .eq("org_id", conn.org_id);
  // Losing a rotated refresh token kills the connection, so a failed store is loud.
  if (error) throw new Error(`token store failed: ${error.message}`);
  return fresh.accessToken;
}

export function importSince(cursor: string | null, now: number): string {
  const c = cursor ? Date.parse(cursor) : NaN;
  const start = Number.isFinite(c) ? c - CURSOR_OVERLAP_MS : now - FIRST_IMPORT_DAYS * 86_400_000;
  return new Date(start).toISOString();
}

export function nextCursor(cursor: string | null, meetings: NormalizedMeeting[]): string | null {
  let best = cursor ? Date.parse(cursor) : NaN;
  for (const m of meetings) {
    const t = m.cursorAt ? Date.parse(m.cursorAt) : NaN;
    if (Number.isFinite(t) && (!Number.isFinite(best) || t > best)) best = t;
  }
  return Number.isFinite(best) ? new Date(best).toISOString() : cursor;
}

export async function importConnection(deps: ImportDeps, conn: ConnectionSecrets, opts: { importedBy?: string | null } = {}): Promise<ImportOutcome> {
  const base = { connectionId: conn.id, orgId: conn.org_id, provider: conn.provider };
  const now = (deps.now ?? Date.now)();
  const store = deps.store ?? adminMeetingStore(deps.admin);
  try {
    if (conn.status !== "active") throw new MeetingAuthError("This connection needs an admin to reconnect it.");
    const since = importSince(conn.import_cursor, now);
    let pull: { meetings: NormalizedMeeting[]; truncated: boolean };
    if (conn.provider === "fathom") {
      if (!conn.api_key_enc) throw new MeetingAuthError("No Fathom key is stored. Reconnect Fathom.");
      pull = await listFathomMeetings({ key: openToken(deps.root, conn.api_key_enc, "lectual-meetings"), since, fetchImpl: deps.fetchImpl });
    } else {
      pull = await listZoomMeetings({ accessToken: await zoomAccessToken(deps, conn), since, now, fetchImpl: deps.fetchImpl });
    }
    const counts = await upsertMeetings(store, { orgId: conn.org_id, provider: conn.provider, importedBy: opts.importedBy ?? null, now }, pull.meetings);
    await markConnection(deps, conn, {
      import_cursor: nextCursor(conn.import_cursor, pull.meetings),
      last_import_at: new Date(now).toISOString(),
      last_import_count: counts.inserted,
      last_error: pull.truncated ? "More meetings than one run reads: the newest were imported, and the rest will follow on later runs where the provider allows." : null,
    });
    return { ok: true, ...base, counts, truncated: pull.truncated };
  } catch (err) {
    const reauth = err instanceof MeetingAuthError;
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    await markConnection(deps, conn, { ...(reauth ? { status: "reauth" } : {}), last_error: message }).catch(() => undefined);
    return { ok: false, ...base, status: reauth ? "reauth" : "error", error: message };
  }
}

export type ImportRunSummary = { connections: number; ok: number; failed: number; inserted: number };

/** The daily cron: every ACTIVE connection in every firm, one failing never stops the next. */
export async function runMeetingImports(deps: ImportDeps): Promise<ImportRunSummary> {
  const { data, error } = await deps.admin.from("meeting_source_connection").select(SECRET_COLUMNS).eq("status", "active");
  if (error) throw new Error(`connection read failed: ${error.message}`);
  const summary: ImportRunSummary = { connections: 0, ok: 0, failed: 0, inserted: 0 };
  for (const conn of (data ?? []) as ConnectionSecrets[]) {
    summary.connections++;
    const out = await importConnection(deps, conn);
    if (out.ok) {
      summary.ok++;
      summary.inserted += out.counts.inserted;
    } else summary.failed++;
  }
  return summary;
}
