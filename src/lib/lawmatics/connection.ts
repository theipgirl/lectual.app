import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import { getAdminClient } from "@/lib/db/admin";
import { openToken, sealToken } from "@/lib/mailbox/crypto";
import { rootKeyOrNull } from "@/lib/mailbox/config";
import { createLawmaticsClient, LawmaticsApiError, type FetchLike, type LawmaticsClient } from "./client";

/**
 * A firm's own Lawmatics connection (lectual 0072, `lawmatics_connection`).
 *
 * lectual's importer reads ONE deployment-wide LAWMATICS_TOKEN, which is why
 * it is locked to one firm by the `lawmatics-import` module. Here each firm
 * pastes its own API token, so the token and the tenant are the same thing:
 * whatever an import pulls comes from the account the calling firm connected,
 * and lands in that firm through RLS (the importers write with the scoped
 * client only). There is no deployment-wide fallback, on purpose.
 *
 * The token is sealed with the same AES-256-GCM root as mailbox tokens and
 * has no SELECT grant for `authenticated`. Reading it back is the only
 * service-role step: by row id AND the org_id the caller's own RLS read
 * returned, never an id or org taken from input.
 */

export type LawmaticsConnection = {
  id: string;
  org_id: string;
  status: "active" | "invalid" | "revoked";
  token_hint: string | null;
  last_verified_at: string | null;
  last_import_at: string | null;
  last_error: string | null;
  created_at: string;
};

const COLUMNS = "id, org_id, status, token_hint, last_verified_at, last_import_at, last_error, created_at";

export type ConnectionRead = { ok: true; connection: LawmaticsConnection | null } | { ok: false };

/** The calling firm's connection, through RLS. Never reads the token. */
export async function getLawmaticsConnection(): Promise<ConnectionRead> {
  const supabase = await getScopedClient();
  const { data, error } = await supabase.from("lawmatics_connection").select(COLUMNS).maybeSingle();
  if (error) return { ok: false };
  return { ok: true, connection: (data as LawmaticsConnection | null) ?? null };
}

export class LawmaticsNotConnectedError extends Error {
  constructor(message = "Lawmatics isn't connected for your firm. Connect it in Settings → Integrations.") {
    super(message);
    this.name = "LawmaticsNotConnectedError";
  }
}

/** A read-only Lawmatics client built from the calling firm's own token. */
export async function firmLawmaticsClient(fetchImpl?: FetchLike): Promise<LawmaticsClient> {
  const root = rootKeyOrNull();
  if (!root) throw new LawmaticsNotConnectedError("Integrations aren't set up on this deployment yet (no encryption key).");

  const read = await getLawmaticsConnection();
  if (!read.ok) throw new Error("Couldn't read your firm's Lawmatics connection. Try again shortly.");
  const conn = read.connection;
  if (!conn) throw new LawmaticsNotConnectedError();
  if (conn.status !== "active") {
    throw new LawmaticsNotConnectedError("Lawmatics rejected your firm's token. Reconnect it in Settings → Integrations.");
  }

  const { data, error } = await getAdminClient()
    .from("lawmatics_connection")
    .select("token_enc")
    .eq("id", conn.id)
    .eq("org_id", conn.org_id)
    .maybeSingle();
  if (error || !data?.token_enc) throw new LawmaticsNotConnectedError();
  return createLawmaticsClient({ token: openToken(root, data.token_enc), fetchImpl });
}

/** What a pasted token must look like before anything is sent anywhere. */
export function checkTokenShape(raw: string): { ok: true; token: string } | { ok: false; reason: string } {
  const token = raw.trim();
  if (!token) return { ok: false, reason: "Paste your Lawmatics API token." };
  if (/\s/.test(token)) return { ok: false, reason: "That token has spaces in it. Copy it again from Lawmatics." };
  if (token.length < 20 || token.length > 4096) return { ok: false, reason: "That doesn't look like a Lawmatics API token." };
  return { ok: true, token };
}

export function tokenHint(token: string): string {
  return `…${token.slice(-4)}`;
}

/**
 * Confirms Lawmatics accepts the token with one small read before it is
 * stored. Read-only: the client has no write methods.
 */
export async function verifyLawmaticsToken(
  token: string,
  opts: { fetchImpl?: FetchLike; baseUrl?: string } = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const client = createLawmaticsClient({ token, fetchImpl: opts.fetchImpl, baseUrl: opts.baseUrl });
    await client.get("/prospects", { "page[size]": "1" });
    return { ok: true };
  } catch (err) {
    if (err instanceof LawmaticsApiError && (err.status === 401 || err.status === 403)) {
      return { ok: false, reason: "Lawmatics didn't accept that token. Check it and try again." };
    }
    return { ok: false, reason: "We couldn't reach Lawmatics to check the token. Try again shortly." };
  }
}

export type SaveResult = { ok: true } | { ok: false; reason: string };

/**
 * Stores (or replaces) the firm's token as the signed-in admin, through RLS:
 * 0072's policies refuse anyone below senior_admin and any other org.
 */
export async function saveLawmaticsToken(args: { root: Buffer; orgId: string; userId: string; token: string }): Promise<SaveResult> {
  const supabase = await getScopedClient();
  const now = new Date().toISOString();
  const sealed = {
    token_enc: sealToken(args.root, args.token),
    token_hint: tokenHint(args.token),
    status: "active",
    last_verified_at: now,
    last_error: null,
    updated_at: now,
  };

  const read = await getLawmaticsConnection();
  if (!read.ok) return { ok: false, reason: "Couldn't read your firm's Lawmatics connection. Try again shortly." };

  if (read.connection) {
    const { data, error } = await supabase
      .from("lawmatics_connection")
      .update(sealed)
      .eq("id", read.connection.id)
      .select("id");
    if (error || !data?.length) return { ok: false, reason: "You don't have permission to change the Lawmatics connection." };
    return { ok: true };
  }

  const { error } = await supabase
    .from("lawmatics_connection")
    .insert({ ...sealed, org_id: args.orgId, created_by: args.userId });
  if (error) {
    return {
      ok: false,
      reason: error.code === "42501" ? "You don't have permission to connect Lawmatics." : "Couldn't save the connection. Try again shortly.",
    };
  }
  return { ok: true };
}

/** Removes the firm's connection (and with it the token). Through RLS. */
export async function disconnectLawmatics(): Promise<SaveResult> {
  const read = await getLawmaticsConnection();
  if (!read.ok) return { ok: false, reason: "Couldn't read your firm's Lawmatics connection." };
  if (!read.connection) return { ok: true };
  const supabase = await getScopedClient();
  const { data, error } = await supabase.from("lawmatics_connection").delete().eq("id", read.connection.id).select("id");
  if (error || !data?.length) return { ok: false, reason: "You don't have permission to disconnect Lawmatics." };
  return { ok: true };
}

/** Records the outcome of an import run on the connection row. Best effort. */
export async function recordLawmaticsOutcome(outcome: { imported?: boolean; rejected?: boolean; error?: string | null }): Promise<void> {
  const read = await getLawmaticsConnection();
  if (!read.ok || !read.connection) return;
  const now = new Date().toISOString();
  const supabase = await getScopedClient();
  await supabase
    .from("lawmatics_connection")
    .update({
      ...(outcome.imported ? { last_import_at: now } : {}),
      ...(outcome.rejected ? { status: "invalid" } : {}),
      last_error: outcome.error ? outcome.error.slice(0, 1000) : null,
      updated_at: now,
    })
    .eq("id", read.connection.id);
}
