import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import { getAdminClient } from "@/lib/db/admin";
import { openToken, sealToken } from "@/lib/mailbox/crypto";
import { revokeZoomToken, type ZoomClientCredentials, type ZoomTokenSet } from "./zoom";
import { SECRET_COLUMNS, type ConnectionSecrets } from "./import";
import type { MeetingProvider } from "./types";

/**
 * A firm's own Fathom / Zoom connections (lectual 0077,
 * `meeting_source_connection`).
 *
 * Reads and writes by a signed-in admin go through the caller's scoped client,
 * so RLS (owner/admin/senior_admin, own org) decides. The sealed columns have
 * no SELECT grant for `authenticated`, so every select here names its columns.
 * The service role is used for one thing: reading the sealed secrets back, by
 * the row id AND org_id that the caller's own RLS read returned.
 */

const COLUMNS =
  "id, org_id, provider, status, account_hint, import_cursor, last_import_at, last_import_count, last_verified_at, last_error, created_at";

export type MeetingConnection = {
  id: string;
  org_id: string;
  provider: MeetingProvider;
  status: "active" | "reauth" | "revoked";
  account_hint: string | null;
  import_cursor: string | null;
  last_import_at: string | null;
  last_import_count: number | null;
  last_verified_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type ConnectionsRead = { ok: true; connections: MeetingConnection[] } | { ok: false };

/** The calling firm's connections, through RLS. Never reads a secret. Revoked rows are left out. */
export async function listMeetingConnections(): Promise<ConnectionsRead> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase.from("meeting_source_connection").select(COLUMNS).neq("status", "revoked");
    if (error) return { ok: false };
    return { ok: true, connections: (data ?? []) as MeetingConnection[] };
  } catch {
    return { ok: false };
  }
}

async function ownRow(provider: MeetingProvider): Promise<{ ok: true; row: { id: string; org_id: string } | null } | { ok: false }> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase.from("meeting_source_connection").select("id, org_id").eq("provider", provider).maybeSingle();
  if (error) return { ok: false };
  return { ok: true, row: (data as { id: string; org_id: string } | null) ?? null };
}

/** The sealed secrets of the calling firm's connection, fenced on the (id, org_id) its own RLS read returned. */
export async function ownConnectionSecrets(provider: MeetingProvider): Promise<ConnectionSecrets | null> {
  const own = await ownRow(provider);
  if (!own.ok || !own.row) return null;
  const { data, error } = await getAdminClient()
    .from("meeting_source_connection")
    .select(SECRET_COLUMNS)
    .eq("id", own.row.id)
    .eq("org_id", own.row.org_id)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as ConnectionSecrets;
}

export type SaveResult = { ok: true; reconnected: boolean } | { ok: false; reason: string };

async function writeRow(provider: MeetingProvider, orgId: string, userId: string, fields: Record<string, unknown>): Promise<SaveResult> {
  const own = await ownRow(provider);
  if (!own.ok) return { ok: false, reason: "Couldn't read your firm's connection. Try again shortly." };
  const supabase = await getScopedClient();
  const now = new Date().toISOString();
  const row = { ...fields, status: "active", last_verified_at: now, last_error: null, updated_at: now };
  if (own.row) {
    const { data, error } = await supabase.from("meeting_source_connection").update(row).eq("id", own.row.id).select("id");
    if (error || !data?.length) return { ok: false, reason: "You don't have permission to change this connection." };
    return { ok: true, reconnected: true };
  }
  const { error } = await supabase.from("meeting_source_connection").insert({ ...row, org_id: orgId, provider, created_by: userId });
  if (error) {
    return { ok: false, reason: error.code === "42501" ? "You don't have permission to connect this." : "Couldn't save the connection. Try again shortly." };
  }
  return { ok: true, reconnected: false };
}

/** Stores the firm's Fathom key, sealed, as the signed-in admin. org and user come from the session. */
export function saveFathomKey(args: { root: Buffer; orgId: string; userId: string; key: string }): Promise<SaveResult> {
  return writeRow("fathom", args.orgId, args.userId, {
    api_key_enc: sealToken(args.root, args.key, "lectual-meetings"),
    access_token_enc: null,
    refresh_token_enc: null,
    token_expires_at: null,
    account_hint: `Key …${args.key.slice(-4)}`,
  });
}

/** Stores the firm's Zoom grant, both tokens sealed. */
export function saveZoomGrant(args: { root: Buffer; orgId: string; userId: string; tokens: ZoomTokenSet; user: { id: string | null; email: string | null } }): Promise<SaveResult> {
  return writeRow("zoom", args.orgId, args.userId, {
    api_key_enc: null,
    access_token_enc: sealToken(args.root, args.tokens.accessToken, "lectual-meetings"),
    refresh_token_enc: sealToken(args.root, args.tokens.refreshToken, "lectual-meetings"),
    token_expires_at: args.tokens.expiresAt,
    account_hint: args.user.email ? args.user.email.slice(0, 120) : "Zoom account",
    external_user_id: args.user.id ? args.user.id.slice(0, 200) : null,
  });
}

/**
 * Disconnects: the row is DELETED (with every secret in it), through RLS.
 * For Zoom the grant is also revoked at Zoom first, best effort. Meetings
 * already imported stay; they are the firm's records.
 */
export async function disconnectMeetingSource(provider: MeetingProvider, opts: { root: Buffer | null; zoomCreds: ZoomClientCredentials | null }): Promise<SaveResult> {
  const own = await ownRow(provider);
  if (!own.ok) return { ok: false, reason: "Couldn't read your firm's connection." };
  if (!own.row) return { ok: true, reconnected: false };
  if (provider === "zoom" && opts.root && opts.zoomCreds) {
    const secrets = await ownConnectionSecrets("zoom");
    if (secrets?.access_token_enc) {
      try {
        await revokeZoomToken({ creds: opts.zoomCreds, token: openToken(opts.root, secrets.access_token_enc, "lectual-meetings") });
      } catch {
        /* the delete below is what matters */
      }
    }
  }
  const supabase = await getScopedClient();
  const { data, error } = await supabase.from("meeting_source_connection").delete().eq("id", own.row.id).select("id");
  if (error || !data?.length) return { ok: false, reason: "You don't have permission to disconnect this." };
  return { ok: true, reconnected: false };
}
