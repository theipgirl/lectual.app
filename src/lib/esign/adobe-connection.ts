import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import { openToken, sealToken } from "@/lib/mailbox/crypto";
import { adobeAccessPoint } from "./host-rule";
import { AdobeOAuthError, adobeNeedsRefresh, refreshAdobeToken, type AdobeClientCredentials, type AdobeTokenSet } from "./adobe-oauth";
import type { AdobeFetch } from "./adobe-client";
import { isNotSetUpError, type EsignDb } from "./db";

/**
 * A firm's OWN Adobe Acrobat Sign connection (lectual 0113 `adobe_sign_connection`; Sprint 5a, contract item 2). Modelled on
 * `payments/lawpay-connection.ts`.
 *
 *  - The readable row comes through the caller's SCOPED client (RLS: any member reads, the admin tier writes). `authenticated`
 *    has no SELECT on `access_token_enc` / `refresh_token_enc`, so every select here names its columns and none names those two.
 *  - The sealed tokens are read only by the service role, FENCED on the `(id, org_id)` a scoped read returned (signed-in paths)
 *    or on the proposal / request row's own `org_id` (the public path). Never on anything a browser sent.
 *  - Tokens are sealed with MAILBOX_TOKEN_KEY under their own HKDF context, `lectual-adobe-sign`.
 *  - Refresh when under 5 minutes are left; Adobe's refresh token does not rotate, so the stored one is kept. A refused refresh
 *    (`invalid_grant`, 401) sets `reauth`. A refusal about one agreement never pauses the firm.
 */

export const TOKEN_CONTEXT = "lectual-adobe-sign" as const;

/** The columns `authenticated` may read. NOT the two `_enc` columns. */
export const CONNECTION_COLUMNS =
  "id, org_id, status, api_access_point, web_access_point, account_email, scopes, access_expires_at, last_refreshed_at, last_verified_at, last_error, created_at, updated_at";

export type AdobeConnectionStatus = "active" | "reauth" | "revoked";

export type AdobeConnection = {
  id: string;
  org_id: string;
  status: AdobeConnectionStatus;
  api_access_point: string;
  account_email: string | null;
  access_expires_at: string | null;
  last_refreshed_at: string | null;
};

/** Three states, never two: a failed read is never "not connected". */
export type AdobeConnectionRead = { state: "ok"; connection: AdobeConnection | null } | { state: "not-set-up" } | { state: "unavailable" };

function toConnection(row: Record<string, unknown>): AdobeConnection | null {
  if (typeof row.id !== "string" || typeof row.org_id !== "string") return null;
  const status = row.status === "active" || row.status === "reauth" || row.status === "revoked" ? row.status : "reauth";
  return {
    id: row.id,
    org_id: row.org_id,
    status,
    api_access_point: typeof row.api_access_point === "string" ? row.api_access_point : "",
    account_email: typeof row.account_email === "string" ? row.account_email : null,
    access_expires_at: typeof row.access_expires_at === "string" ? row.access_expires_at : null,
    last_refreshed_at: typeof row.last_refreshed_at === "string" ? row.last_refreshed_at : null,
  };
}

/** The calling firm's connection through RLS. Never reads a secret. */
export async function readAdobeConnection(db: EsignDb): Promise<AdobeConnectionRead> {
  try {
    const { data, error } = await db.from("adobe_sign_connection").select(CONNECTION_COLUMNS).maybeSingle();
    if (error) return isNotSetUpError(error) ? { state: "not-set-up" } : { state: "unavailable" };
    if (!data) return { state: "ok", connection: null };
    const connection = toConnection(data as Record<string, unknown>);
    return connection ? { state: "ok", connection } : { state: "unavailable" };
  } catch {
    return { state: "unavailable" };
  }
}

export async function getAdobeConnection(): Promise<AdobeConnectionRead> {
  try {
    return await readAdobeConnection((await getScopedClient()) as unknown as EsignDb);
  } catch {
    return { state: "unavailable" };
  }
}

/**
 * How many clients are waiting on the firm (its `out_for_signature` requests), through RLS, from granted columns only. Null when
 * the count couldn't be read (the Settings line is then left out, never "0").
 */
export async function countWaitingClients(db: EsignDb): Promise<number | null> {
  try {
    const { data, error } = await db.from("client_proposal_esign_request").select("id").eq("status", "out_for_signature");
    if (error || !Array.isArray(data)) return null;
    return data.length;
  } catch {
    return null;
  }
}

export type SaveResult = { ok: true; reconnected: boolean } | { ok: false; reason: "permission" | "failed" | "not-set-up" };

/**
 * Stores (or replaces) the firm's connection as the signed-in admin, through the SCOPED client. The insert names no `_enc`
 * column in a select (it selects `id` only), and never `connected_by` (the database defaults it to auth.uid()).
 */
export async function saveAdobeConnection(
  db: EsignDb,
  args: { root: Buffer; orgId: string; tokens: AdobeTokenSet; accountEmail: string | null; scopes: readonly string[]; now?: Date },
): Promise<SaveResult> {
  const read = await readAdobeConnection(db);
  if (read.state === "not-set-up") return { ok: false, reason: "not-set-up" };
  if (read.state !== "ok") return { ok: false, reason: "failed" };
  const now = (args.now ?? new Date()).toISOString();
  const fields = {
    status: "active",
    api_access_point: args.tokens.apiAccessPoint,
    web_access_point: args.tokens.webAccessPoint,
    account_email: args.accountEmail,
    scopes: [...args.scopes],
    access_token_enc: sealToken(args.root, args.tokens.accessToken, TOKEN_CONTEXT),
    refresh_token_enc: sealToken(args.root, args.tokens.refreshToken, TOKEN_CONTEXT),
    access_expires_at: args.tokens.accessExpiresAt,
    last_refreshed_at: now,
    last_verified_at: now,
  };
  try {
    if (read.connection) {
      const { data, error } = await db.from("adobe_sign_connection").update(fields).eq("id", read.connection.id).select("id");
      if (error || !Array.isArray(data) || data.length === 0) return { ok: false, reason: "permission" };
      return { ok: true, reconnected: true };
    }
    const { error } = await db.from("adobe_sign_connection").insert({ ...fields, org_id: args.orgId }).select("id");
    if (error) return { ok: false, reason: error.code === "42501" ? "permission" : "failed" };
    return { ok: true, reconnected: false };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

/* ───────────────────────── sealed tokens (service role) ─────────────────────────
 * The `db` below is ALWAYS the service role, and every read is fenced on an org_id that came from one of our own rows. */

export type AdobeAccessResult =
  | { kind: "ok"; connectionId: string; accessPoint: string; accessToken: string; refreshToken: string }
  | { kind: "none" }
  | { kind: "reauth" }
  | { kind: "not-set-up" }
  | { kind: "unavailable" };

/**
 * The firm's access for an Adobe call: an ACTIVE connection fenced on `orgId` (and on `connectionId` when the caller has one),
 * its tokens opened, refreshed when under 5 minutes are left. A refused refresh marks the connection `reauth`.
 */
export async function loadAdobeAccess(input: {
  db: EsignDb;
  orgId: string;
  connectionId?: string;
  root: Buffer;
  creds: AdobeClientCredentials;
  fetchImpl?: AdobeFetch;
  now?: Date;
}): Promise<AdobeAccessResult> {
  const orgId = (input.orgId ?? "").trim();
  if (!orgId) return { kind: "unavailable" };
  try {
    let q = input.db
      .from("adobe_sign_connection")
      .select("id, org_id, status, api_access_point, access_token_enc, refresh_token_enc, access_expires_at")
      .eq("org_id", orgId);
    if (input.connectionId) q = q.eq("id", input.connectionId);
    const { data, error } = await q.maybeSingle();
    if (error) return isNotSetUpError(error) ? { kind: "not-set-up" } : { kind: "unavailable" };
    const row = data as Record<string, unknown> | null;
    if (!row || row.org_id !== orgId) return { kind: "none" };
    if (row.status === "reauth") return { kind: "reauth" };
    if (row.status !== "active") return { kind: "none" };
    const accessPoint = adobeAccessPoint(row.api_access_point);
    if (!accessPoint || typeof row.access_token_enc !== "string" || typeof row.refresh_token_enc !== "string") return { kind: "unavailable" };
    const connectionId = String(row.id);
    let accessToken: string;
    let refreshToken: string;
    try {
      accessToken = openToken(input.root, row.access_token_enc, TOKEN_CONTEXT);
      refreshToken = openToken(input.root, row.refresh_token_enc, TOKEN_CONTEXT);
    } catch {
      return { kind: "unavailable" };
    }
    const now = input.now ?? new Date();
    if (adobeNeedsRefresh(typeof row.access_expires_at === "string" ? row.access_expires_at : null, now.getTime())) {
      try {
        const fresh = await refreshAdobeToken({ creds: input.creds, refreshToken, accessPoint, fetchImpl: input.fetchImpl, now: now.getTime() });
        accessToken = fresh.accessToken;
        await input.db
          .from("adobe_sign_connection")
          .update({
            access_token_enc: sealToken(input.root, fresh.accessToken, TOKEN_CONTEXT),
            access_expires_at: fresh.accessExpiresAt,
            last_refreshed_at: now.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq("id", connectionId)
          .eq("org_id", orgId);
      } catch (err) {
        if (err instanceof AdobeOAuthError && err.code === "reauth") {
          await markAdobeReauth(input.db, orgId, connectionId);
          return { kind: "reauth" };
        }
        return { kind: "unavailable" };
      }
    }
    return { kind: "ok", connectionId, accessPoint, accessToken, refreshToken };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * Adobe refused the FIRM's grant (a 401, or `invalid_grant` on refresh): the connection goes to `reauth` until an admin
 * reconnects. Fenced on the row's org and on `active`. Never for a refusal about one agreement. Never throws.
 */
export async function markAdobeReauth(db: EsignDb, orgId: string, connectionId: string): Promise<void> {
  try {
    await db
      .from("adobe_sign_connection")
      .update({ status: "reauth", last_error: "reauth", updated_at: new Date().toISOString() })
      .eq("id", connectionId)
      .eq("org_id", orgId)
      .eq("status", "active");
  } catch {
    // The next call will be refused the same way.
  }
}
