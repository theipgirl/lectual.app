import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getAdminClient } from "@/lib/db/admin";
import { openToken, sealToken } from "./crypto";
import { revokeToken, type MailboxProvider, type MailboxScope, type TokenSet } from "./providers";

/**
 * Reads and writes of `mailbox_connection` (migration 0057).
 *
 * Everything goes through the caller's RLS-scoped client, so the database
 * decides who sees and changes which row. Two things to know about that table:
 *
 *   · Token columns are not selectable by `authenticated`. Every select here
 *     names its columns — `select('*')` would fail with "permission denied".
 *   · The service-role client appears exactly once, in disconnect(), to read
 *     the refresh token it must revoke. It only runs after the caller's own
 *     client has shown they can see the row, and it looks the row up by BOTH
 *     id and the org_id that scoped read returned.
 */

const COLUMNS =
  "id, org_id, user_id, scope, provider, email, label, status, last_synced_at, last_error, matched_count, created_at";

export type MailboxConnection = {
  id: string;
  org_id: string;
  user_id: string | null;
  scope: MailboxScope;
  provider: MailboxProvider;
  email: string;
  label: string | null;
  status: "active" | "reauth" | "error" | "revoked";
  last_synced_at: string | null;
  last_error: string | null;
  matched_count: number;
  created_at: string;
};

export type ListResult =
  | { ok: true; connections: MailboxConnection[] }
  | { ok: false; error: string };

/** The caller's own personal mailboxes plus the firm's shared ones (RLS decides). */
export async function listConnections(): Promise<ListResult> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("mailbox_connection")
    .select(COLUMNS)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, connections: (data ?? []) as MailboxConnection[] };
}

export type SaveOutcome =
  | { ok: true; id: string; reconnected: boolean }
  | { ok: false; code: "taken" | "scope-conflict" | "forbidden" | "db-error"; message: string };

/**
 * Stores a freshly consented mailbox. Reconnecting an existing row refreshes
 * its tokens and clears any `reauth` / `error` state; otherwise a new row is
 * inserted. `email` is stored lower-cased (0057's unique index is on
 * lower(email)), so the equality lookup below is exact.
 */
export async function saveConnection(args: {
  root: Buffer;
  orgId: string;
  userId: string;
  scope: MailboxScope;
  provider: MailboxProvider;
  email: string;
  tokens: TokenSet;
}): Promise<SaveOutcome> {
  const { root, orgId, userId, scope, provider, email, tokens } = args;
  const supabase = await getScopedClient();

  const sealed = {
    access_token_enc: sealToken(root, tokens.accessToken),
    refresh_token_enc: sealToken(root, tokens.refreshToken),
    token_expires_at: tokens.expiresAt,
    scopes: tokens.grantedScopes,
    status: "active",
    last_error: null,
    updated_at: new Date().toISOString(),
  };

  const { data: existing, error: findError } = await supabase
    .from("mailbox_connection")
    .select("id, scope")
    .eq("provider", provider)
    .eq("email", email)
    .maybeSingle();
  if (findError) return { ok: false, code: "db-error", message: findError.message };

  if (existing) {
    if (existing.scope !== scope) {
      return {
        ok: false,
        code: "scope-conflict",
        message:
          scope === "personal"
            ? "This address is already connected as a firm mailbox."
            : "This address is already connected as someone's personal mailbox.",
      };
    }
    const { data: updated, error } = await supabase
      .from("mailbox_connection")
      .update(sealed)
      .eq("id", existing.id)
      .select("id");
    if (error) return { ok: false, code: "db-error", message: error.message };
    if (!updated || updated.length === 0) {
      return { ok: false, code: "forbidden", message: "You can't change this mailbox connection." };
    }
    return { ok: true, id: existing.id, reconnected: true };
  }

  const { data: inserted, error } = await supabase
    .from("mailbox_connection")
    .insert({
      ...sealed,
      org_id: orgId,
      user_id: scope === "personal" ? userId : null,
      scope,
      provider,
      email,
      label: scope === "personal" ? "My mailbox" : null,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error) {
    // 23505: a row we cannot see already holds this address — a colleague's
    // personal mailbox. Say so without naming whose.
    if (error.code === "23505") {
      return { ok: false, code: "taken", message: "Someone in your firm has already connected this mailbox." };
    }
    // 42501: RLS refused the insert (e.g. a firm mailbox without admin rights).
    if (error.code === "42501") {
      return { ok: false, code: "forbidden", message: "You don't have permission to connect this mailbox." };
    }
    return { ok: false, code: "db-error", message: error.message };
  }
  return { ok: true, id: inserted.id, reconnected: false };
}

export type DisconnectOutcome =
  | { ok: true; revoked: boolean }
  | { ok: false; message: string };

/**
 * Revokes at the provider (best effort) and deletes the row. The delete is
 * the caller's own RLS-scoped statement, so a member who can see a firm
 * mailbox but may not manage it gets "0 rows", not a deletion.
 */
export async function disconnect(args: { root: Buffer | null; id: string }): Promise<DisconnectOutcome> {
  const supabase = await getScopedClient();

  const { data: row, error: readError } = await supabase
    .from("mailbox_connection")
    .select("id, org_id, provider")
    .eq("id", args.id)
    .maybeSingle();
  if (readError) return { ok: false, message: readError.message };
  if (!row) return { ok: false, message: "That mailbox isn't connected." };

  // The token has to be read before the delete (afterwards there is nothing to
  // read), but it is only USED once the caller's own delete has succeeded.
  // Revoking a token the caller couldn't delete would be a way to break a
  // colleague's or the firm's mailbox without permission.
  const admin = getAdminClient();
  const { data: tokenRow } = await admin
    .from("mailbox_connection")
    .select("refresh_token_enc")
    .eq("id", row.id)
    .eq("org_id", row.org_id)
    .maybeSingle();

  const { data: deleted, error: deleteError } = await supabase
    .from("mailbox_connection")
    .delete()
    .eq("id", row.id)
    .select("id");
  if (deleteError) return { ok: false, message: deleteError.message };
  if (!deleted || deleted.length === 0) {
    return { ok: false, message: "You don't have permission to disconnect this mailbox." };
  }

  let revoked = false;
  if (args.root && tokenRow?.refresh_token_enc) {
    try {
      revoked = await revokeToken({
        provider: row.provider as MailboxProvider,
        token: openToken(args.root, tokenRow.refresh_token_enc),
      });
    } catch {
      // Revocation is a courtesy: our copy is already gone, and the provider
      // expires unused refresh tokens on its own.
    }
  }
  return { ok: true, revoked };
}
