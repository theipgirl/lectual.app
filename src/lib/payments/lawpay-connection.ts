import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import { getAdminClient } from "@/lib/db/admin";
import type { Json } from "@/lib/db/types";
import { openToken, sealToken } from "@/lib/mailbox/crypto";
import { rootKeyOrNull } from "@/lib/mailbox/config";
import {
  LawPayOAuthError,
  deauthorizeLawPay,
  fetchGatewayCredentials,
  needsRefresh,
  refreshLawPayToken,
  secretKeyFor,
  type FetchLike,
  type GatewayCredentials,
  type LawPayAccount,
  type LawPayClientCredentials,
  type LawPayMode,
  type LawPayTokenSet,
} from "./lawpay-oauth";
import { lawPayApiBase, lawPayDeploymentMode } from "./lawpay-config";
import { accountFitsKind, parseStoredAccounts } from "./lawpay-accounts";
import type { PaymentAccountKind } from "./types";

/**
 * A firm's OWN LawPay connection (lectual migration 0076, `lawpay_connection`).
 *
 * The firm signs in to LawPay; nobody pastes a key. The OAuth token fetches the
 * merchant's gateway credentials, whose per-account secret keys are what a
 * charge authenticates with. All three secrets (access token, refresh token,
 * gateway credentials) are sealed with MAILBOX_TOKEN_KEY under the
 * `lectual-lawpay` HKDF context and have no SELECT grant for `authenticated`,
 * so every select here names its columns.
 *
 * Writes by a signed-in admin go through the caller's scoped client, so RLS
 * (owner/admin/senior_admin, own org) decides. The service role is used in
 * exactly three places, each fenced on an org_id the caller did not choose:
 *   · reading the sealed secrets back, by the row id AND org_id a scoped read
 *     returned (refreshAccounts);
 *   · the public proposal route, which has no session: the org_id comes off the
 *     quote row its token resolved (loadChargeCredentials,
 *     markConnectionNeedsAttention).
 */

const COLUMNS =
  "id, org_id, status, mode, expires_at, scopes, merchant_id, merchant_name, accounts, display_hint, last_verified_at, last_error, created_at, updated_at";

export type LawPayConnectionStatus = "active" | "reauth" | "revoked";

export type LawPayConnection = {
  id: string;
  org_id: string;
  status: LawPayConnectionStatus;
  mode: LawPayMode;
  expires_at: string | null;
  merchant_id: string | null;
  merchant_name: string | null;
  accounts: LawPayAccount[];
  display_hint: string | null;
  last_verified_at: string | null;
  last_error: string | null;
  created_at: string;
};

export type ConnectionRead = { ok: true; connection: LawPayConnection | null } | { ok: false };

function toConnection(row: Record<string, unknown>): LawPayConnection {
  const status = row.status === "active" || row.status === "reauth" || row.status === "revoked" ? row.status : "reauth";
  return {
    id: String(row.id),
    org_id: String(row.org_id),
    status,
    mode: row.mode === "live" ? "live" : "test",
    expires_at: (row.expires_at as string | null) ?? null,
    merchant_id: (row.merchant_id as string | null) ?? null,
    merchant_name: (row.merchant_name as string | null) ?? null,
    accounts: parseStoredAccounts(row.accounts),
    display_hint: (row.display_hint as string | null) ?? null,
    last_verified_at: (row.last_verified_at as string | null) ?? null,
    last_error: (row.last_error as string | null) ?? null,
    created_at: String(row.created_at),
  };
}

/** The calling firm's connection, through RLS. Never reads a secret. */
export async function getLawPayConnection(): Promise<ConnectionRead> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase.from("lawpay_connection").select(COLUMNS).maybeSingle();
    if (error) return { ok: false };
    return { ok: true, connection: data ? toConnection(data as Record<string, unknown>) : null };
  } catch {
    return { ok: false };
  }
}

export function displayHint(gateway: GatewayCredentials): string {
  const name = gateway.merchantName ?? "LawPay merchant";
  const tail = gateway.merchantId ? ` ···${gateway.merchantId.slice(-4)}` : "";
  return `${name}${tail}`.slice(0, 120);
}

function sealedFields(root: Buffer, tokens: LawPayTokenSet, gateway: GatewayCredentials) {
  return {
    access_token_enc: sealToken(root, tokens.accessToken, "lectual-lawpay"),
    refresh_token_enc: tokens.refreshToken ? sealToken(root, tokens.refreshToken, "lectual-lawpay") : null,
    gateway_credentials_enc: sealToken(root, JSON.stringify(gateway.secrets), "lectual-lawpay"),
    expires_at: tokens.expiresAt,
    scopes: tokens.scopes,
  };
}

function nonSecretFields(gateway: GatewayCredentials) {
  return {
    merchant_id: gateway.merchantId,
    merchant_name: gateway.merchantName,
    // No secret_key in here: lawpay_accounts_valid() refuses one.
    accounts: gateway.accounts as unknown as Json,
    display_hint: displayHint(gateway),
  };
}

export type SaveResult = { ok: true; reconnected: boolean; unmapped: PaymentAccountKind[] } | { ok: false; reason: string };

/**
 * Stores (or replaces) the firm's connection as the signed-in admin, through
 * RLS. A new connection starts in this deployment's mode (test unless the
 * deployment is explicitly live).
 *
 * Reconnecting can change which accounts LawPay lists. Any existing mapping
 * that no longer names a listed account in the connection's mode with a
 * matching trust flag is REMOVED, never silently repointed: the firm maps again.
 */
export async function saveLawPayConnection(args: {
  root: Buffer;
  orgId: string;
  userId: string;
  tokens: LawPayTokenSet;
  gateway: GatewayCredentials;
}): Promise<SaveResult> {
  const supabase = await getScopedClient();
  const now = new Date().toISOString();
  const read = await getLawPayConnection();
  if (!read.ok) return { ok: false, reason: "Couldn't read your firm's LawPay connection. Try again shortly." };

  const fields = {
    ...sealedFields(args.root, args.tokens, args.gateway),
    ...nonSecretFields(args.gateway),
    status: "active",
    last_verified_at: now,
    last_error: null,
    updated_at: now,
  };

  let mode: LawPayMode;
  if (read.connection) {
    mode = read.connection.mode;
    const { data, error } = await supabase.from("lawpay_connection").update(fields).eq("id", read.connection.id).select("id");
    if (error || !data?.length) return { ok: false, reason: "You don't have permission to change the LawPay connection." };
  } else {
    mode = lawPayDeploymentMode();
    const { error } = await supabase
      .from("lawpay_connection")
      .insert({ ...fields, mode, org_id: args.orgId, created_by: args.userId });
    if (error) {
      return {
        ok: false,
        reason: error.code === "42501" ? "You don't have permission to connect LawPay." : "Couldn't save the LawPay connection. Try again shortly.",
      };
    }
  }
  const unmapped = await pruneStaleMappings(args.gateway.accounts, mode);
  return { ok: true, reconnected: Boolean(read.connection), unmapped };
}

/** Removes LawPay mappings that no longer match what LawPay lists. Scoped. */
async function pruneStaleMappings(accounts: LawPayAccount[], mode: LawPayMode): Promise<PaymentAccountKind[]> {
  const supabase = await getScopedClient();
  const { data } = await supabase
    .from("crm_org_payment_account")
    .select("id, account_kind, provider_account_id")
    .eq("provider", "lawpay");
  const removed: PaymentAccountKind[] = [];
  for (const row of data ?? []) {
    const account = accounts.find((a) => a.id === row.provider_account_id);
    if (account && accountFitsKind(account, row.account_kind, mode)) continue;
    const { error } = await supabase.from("crm_org_payment_account").delete().eq("id", row.id);
    if (!error) removed.push(row.account_kind);
  }
  return removed;
}

export type DisconnectResult = { ok: true; revokedAtLawPay: boolean } | { ok: false; reason: string };

/**
 * Disconnect: revoke at LawPay, then delete.
 *
 *   1. The caller's own scoped UPDATE flips the row to `revoked` and clears
 *      every sealed secret. It is also the permission check: RLS lets only an
 *      owner/admin/senior_admin of THIS firm touch it, and 0 rows means refused
 *      — before anything is sent to LawPay, so nobody can revoke a connection
 *      they could not remove.
 *   2. Deauthorize at LawPay (best effort; needs the partner app, and a
 *      merchant public key, which is not a secret).
 *   3. Delete the firm's LawPay account mappings, then the row.
 */
export async function disconnectLawPay(args: {
  creds: LawPayClientCredentials | null;
  fetchImpl?: FetchLike;
}): Promise<DisconnectResult> {
  const read = await getLawPayConnection();
  if (!read.ok) return { ok: false, reason: "Couldn't read your firm's LawPay connection." };
  const conn = read.connection;
  if (!conn) return { ok: true, revokedAtLawPay: false };

  const supabase = await getScopedClient();
  const { data: cleared, error: clearError } = await supabase
    .from("lawpay_connection")
    .update({
      status: "revoked",
      access_token_enc: null,
      refresh_token_enc: null,
      gateway_credentials_enc: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conn.id)
    .select("id");
  if (clearError || !cleared?.length) return { ok: false, reason: "You don't have permission to disconnect LawPay." };

  let revokedAtLawPay = false;
  const publicKey = conn.accounts.find((a) => a.public_key)?.public_key ?? null;
  if (args.creds && publicKey) {
    revokedAtLawPay = await deauthorizeLawPay({
      creds: args.creds,
      publicKey,
      apiBase: lawPayApiBase(),
      fetchImpl: args.fetchImpl,
    });
  }

  await supabase.from("crm_org_payment_account").delete().eq("provider", "lawpay");
  const { error: deleteError } = await supabase.from("lawpay_connection").delete().eq("id", conn.id);
  if (deleteError) {
    // The row is revoked with no secrets, so nothing can charge through it.
    return { ok: false, reason: "LawPay was disconnected, but the record couldn't be removed. Try again." };
  }
  return { ok: true, revokedAtLawPay };
}

export type RefreshResult =
  | { ok: true; unmapped: PaymentAccountKind[] }
  | { ok: false; reason: string; reauth: boolean };

/**
 * Re-reads the merchant's accounts with the stored grant, refreshing the grant
 * first when it has a known expiry and a refresh token. Reactivates a `reauth`
 * connection when LawPay accepts the grant again. A dead grant marks the row
 * `reauth` — only a person reconnecting can fix that.
 */
export async function refreshLawPayAccounts(args: {
  root: Buffer;
  creds: LawPayClientCredentials;
  fetchImpl?: FetchLike;
  now?: number;
}): Promise<RefreshResult> {
  const read = await getLawPayConnection();
  if (!read.ok) return { ok: false, reason: "Couldn't read your firm's LawPay connection.", reauth: false };
  const conn = read.connection;
  if (!conn || conn.status === "revoked") return { ok: false, reason: "LawPay isn't connected.", reauth: false };

  // Service role, fenced by the id AND org_id the scoped read just returned.
  const { data: secrets, error } = await getAdminClient()
    .from("lawpay_connection")
    .select("access_token_enc, refresh_token_enc")
    .eq("id", conn.id)
    .eq("org_id", conn.org_id)
    .maybeSingle();
  if (error || !secrets?.access_token_enc) return { ok: false, reason: "Reconnect LawPay to continue.", reauth: true };

  const supabase = await getScopedClient();
  const markReauth = async (message: string) => {
    await supabase
      .from("lawpay_connection")
      .update({ status: "reauth", last_error: message.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("id", conn.id);
  };

  try {
    let tokens: LawPayTokenSet = {
      accessToken: openToken(args.root, secrets.access_token_enc, "lectual-lawpay"),
      refreshToken: secrets.refresh_token_enc ? openToken(args.root, secrets.refresh_token_enc, "lectual-lawpay") : null,
      expiresAt: conn.expires_at,
      scopes: [],
    };
    const now = args.now ?? Date.now();
    if (needsRefresh(tokens.expiresAt, now)) {
      if (!tokens.refreshToken) {
        await markReauth("LawPay's sign-in expired. Reconnect LawPay.");
        return { ok: false, reason: "LawPay's sign-in expired. Reconnect LawPay.", reauth: true };
      }
      tokens = await refreshLawPayToken({ creds: args.creds, refreshToken: tokens.refreshToken, apiBase: lawPayApiBase(), fetchImpl: args.fetchImpl, now });
    }
    const gateway = await fetchGatewayCredentials({ accessToken: tokens.accessToken, apiBase: lawPayApiBase(), fetchImpl: args.fetchImpl });
    const nowIso = new Date(now).toISOString();
    const { data, error: updateError } = await supabase
      .from("lawpay_connection")
      .update({
        ...sealedFields(args.root, tokens, gateway),
        ...nonSecretFields(gateway),
        status: "active",
        last_verified_at: nowIso,
        last_error: null,
        updated_at: nowIso,
      })
      .eq("id", conn.id)
      .select("id");
    if (updateError || !data?.length) return { ok: false, reason: "You don't have permission to change the LawPay connection.", reauth: false };
    return { ok: true, unmapped: await pruneStaleMappings(gateway.accounts, conn.mode) };
  } catch (err) {
    if (err instanceof LawPayOAuthError && err.code === "reauth") {
      await markReauth(err.message);
      return { ok: false, reason: err.message, reauth: true };
    }
    const message = err instanceof LawPayOAuthError ? err.message : "Couldn't reach LawPay. Try again shortly.";
    return { ok: false, reason: message, reauth: false };
  }
}

/* ─────────────────── the public proposal route (no session) ─────────────── */

/** The narrow shape of the service-role client this module needs on the public route. */
type AdminLike = ReturnType<typeof getAdminClient>;

export type ChargeCredentials =
  | { status: "ok"; secretKey: string; publicKey: string; mode: LawPayMode; connectionId: string }
  | { status: "unconfigured" }
  | { status: "unavailable" };

/**
 * The secret and public key for ONE of the firm's accounts, for a caller with
 * no session. `orgId` MUST come from the quote row the token resolved — never a
 * request. Refuses (unconfigured) unless the connection is active, in this
 * deployment's mode, and still lists the account in that mode with a trust flag
 * matching `kind`. A test deployment can therefore never reach a live key.
 */
export async function loadChargeCredentials(input: {
  db: AdminLike;
  orgId: string;
  accountId: string;
  kind: PaymentAccountKind;
}): Promise<ChargeCredentials> {
  const orgId = (input.orgId ?? "").trim();
  if (!orgId) return { status: "unavailable" };
  try {
    const { data, error } = await input.db
      .from("lawpay_connection")
      .select("id, status, mode, accounts, gateway_credentials_enc")
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) return { status: "unavailable" };
    if (!data || data.status !== "active" || !data.gateway_credentials_enc) return { status: "unconfigured" };
    const mode: LawPayMode = data.mode === "live" ? "live" : "test";
    if (mode !== lawPayDeploymentMode()) return { status: "unconfigured" };

    const account = parseStoredAccounts(data.accounts).find((a) => a.id === input.accountId);
    if (!account || !accountFitsKind(account, input.kind, mode) || !account.public_key) return { status: "unconfigured" };

    const root = rootKeyOrNull();
    if (!root) return { status: "unconfigured" };
    let secrets: Record<string, unknown>;
    try {
      secrets = JSON.parse(openToken(root, data.gateway_credentials_enc, "lectual-lawpay")) as Record<string, unknown>;
    } catch {
      return { status: "unconfigured" };
    }
    const secretKey = secrets[secretKeyFor(mode, account.id)];
    if (typeof secretKey !== "string" || !secretKey) return { status: "unconfigured" };
    return { status: "ok", secretKey, publicKey: account.public_key, mode, connectionId: data.id };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * LawPay refused the firm's own request (a rejected key, an inactive merchant
 * account). No card can work until the firm acts, so the connection goes to
 * `reauth` and every proposal of this firm stops offering a card form — rather
 * than re-offering one that is certain to fail. Fenced on the quote's org_id.
 */
export async function markConnectionNeedsAttention(input: { db: AdminLike; orgId: string; detail: string }): Promise<void> {
  try {
    await input.db
      .from("lawpay_connection")
      .update({ status: "reauth", last_error: input.detail.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("org_id", input.orgId)
      .eq("status", "active");
  } catch (err) {
    console.error(`[payments] could not mark LawPay connection for attention org=${input.orgId}`, err);
  }
}
