import { pkceChallenge } from "./lawpay-state";

/**
 * "Connect LawPay": the OAuth half of a firm's own LawPay connection.
 *
 * Source: developers.8am.com (AffiniPay's developer portal; LawPay is its legal
 * brand), read 2026-09-27. What is documented, and relied on here:
 *
 *   authorize   GET  https://secure.lawpay.com/oauth/authorize
 *               ?client_id&redirect_uri&scope=payments&response_type=code
 *   token       POST https://api.8am.com/oauth/token (JSON body)
 *               → { access_token, token_type, created_at }
 *   credentials GET  https://api.8am.com/gateway-credentials (Bearer)
 *               → { merchant, test_accounts[], live_accounts[] }, each account
 *                 { id, name, type, currency, public_key, secret_key,
 *                   trust_account }
 *   deauthorize DELETE https://secure.affinipay.com/api/v1/merchants/
 *               {public_key}/deauthorize_application, Bearer of a
 *               client_credentials token with scope `tenant`.
 *
 * THE ACCESS TOKEN IS NOT WHAT A CHARGE IS SENT WITH. It fetches the merchant's
 * per-account gateway credentials, and a charge is HTTP Basic with the chosen
 * account's own `secret_key` (lawpay.ts). So what this file hands back from a
 * connection is two things: the non-secret account list the firm maps from,
 * and the secret keys, which the caller seals and never shows anyone.
 *
 * NOT DOCUMENTED, and handled conservatively rather than guessed:
 *   · `state` and PKCE. Both are sent (this app's OAuth rule: a signed state
 *     cookie and S256 PKCE, copied from the mailbox flow). If LawPay does not
 *     echo `state`, the callback refuses — fail closed, never skip the check.
 *   · Expiry and refresh. No `expires_in` and no refresh token are documented.
 *     If either comes back it is honoured; otherwise the token is treated as
 *     long-lived and a 401 means "reconnect" (status `reauth`).
 *   · `trust_account` arrives as the STRING "false" in the one example. It is
 *     normalised to a boolean from exactly "true"/"false"/true/false; anything
 *     else and the account is left out, because an account whose trust flag we
 *     cannot read is an account nobody may map.
 *
 * Every network call takes `fetchImpl`, so tests never touch the network.
 */

export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal; cache?: RequestCache },
) => Promise<Response>;

export type LawPayMode = "test" | "live";
export type LawPayAccountType = "MerchantAccount" | "AchAccount";

export const DEFAULT_AUTHORIZE_URL = "https://secure.lawpay.com/oauth/authorize";
export const DEFAULT_API_BASE = "https://api.8am.com";
export const DEAUTHORIZE_BASE = "https://secure.affinipay.com/api/v1/merchants";
/** The only documented scope for connecting an existing merchant. */
export const LAWPAY_SCOPE = "payments";

export type LawPayClientCredentials = { clientId: string; clientSecret: string };

/** One merchant account, as the firm may see it. No secret in here, ever. */
export type LawPayAccount = {
  id: string;
  name: string | null;
  type: LawPayAccountType;
  /** LawPay's own flag — never inferred from a name. */
  trust_account: boolean;
  mode: LawPayMode;
  /** Documented as safe to expose in a web page (Hosted Fields needs it). */
  public_key: string | null;
  currency: string | null;
};

export type GatewayCredentials = {
  merchantId: string | null;
  merchantName: string | null;
  accounts: LawPayAccount[];
  /** `${mode}:${accountId}` → secret_key. Sealed by the caller, never rendered. */
  secrets: Record<string, string>;
  /** Accounts left out because a field we must not guess was unreadable. */
  skipped: number;
};

export type LawPayTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  /** ISO, or null when LawPay reported no expiry (the documented case). */
  expiresAt: string | null;
  scopes: string[];
};

export class LawPayOAuthError extends Error {
  constructor(
    message: string,
    readonly code: "exchange-failed" | "reauth" | "refresh-failed" | "fetch-failed" | "no-accounts",
  ) {
    super(message);
    this.name = "LawPayOAuthError";
  }
}

export function secretKeyFor(mode: LawPayMode, accountId: string): string {
  return `${mode}:${accountId}`;
}

function trimBase(url: string): string {
  return url.replace(/\/+$/, "");
}

/* ─────────────────────────────── authorize ──────────────────────────────── */

export function lawPayAuthorizeUrl(args: {
  clientId: string;
  redirectUri: string;
  nonce: string;
  verifier: string;
  authorizeUrl?: string;
}): string {
  const url = new URL(args.authorizeUrl || DEFAULT_AUTHORIZE_URL);
  const p = url.searchParams;
  p.set("client_id", args.clientId);
  p.set("redirect_uri", args.redirectUri);
  p.set("scope", LAWPAY_SCOPE);
  p.set("response_type", "code");
  p.set("state", args.nonce);
  p.set("code_challenge", pkceChallenge(args.verifier));
  p.set("code_challenge_method", "S256");
  return url.toString();
}

/* ─────────────────────────────── tokens ─────────────────────────────────── */

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = (await res.json()) as unknown;
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Turns a token response into a TokenSet. `now` is the fallback issue time. */
export function parseTokenResponse(body: Record<string, unknown> | null, now: number): LawPayTokenSet | null {
  const accessToken = str(body?.access_token);
  if (!accessToken) return null;
  const createdAt = typeof body?.created_at === "number" && Number.isFinite(body.created_at) ? body.created_at * 1000 : now;
  const expiresIn = typeof body?.expires_in === "number" && body.expires_in > 0 ? body.expires_in : null;
  const scope = str(body?.scope);
  return {
    accessToken,
    refreshToken: str(body?.refresh_token),
    expiresAt: expiresIn ? new Date(createdAt + expiresIn * 1000).toISOString() : null,
    scopes: scope ? scope.split(/[\s,]+/).filter(Boolean) : [LAWPAY_SCOPE],
  };
}

async function postToken(
  body: Record<string, string>,
  opts: { apiBase?: string; fetchImpl?: FetchLike },
): Promise<Response> {
  const doFetch = opts.fetchImpl ?? (globalThis.fetch as FetchLike);
  return doFetch(`${trimBase(opts.apiBase || DEFAULT_API_BASE)}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
}

export async function exchangeLawPayCode(args: {
  creds: LawPayClientCredentials;
  code: string;
  redirectUri: string;
  verifier: string;
  apiBase?: string;
  fetchImpl?: FetchLike;
  now?: number;
}): Promise<LawPayTokenSet> {
  let res: Response;
  try {
    res = await postToken(
      {
        client_id: args.creds.clientId,
        client_secret: args.creds.clientSecret,
        grant_type: "authorization_code",
        redirect_uri: args.redirectUri,
        code: args.code,
        code_verifier: args.verifier,
      },
      args,
    );
  } catch {
    throw new LawPayOAuthError("Couldn't reach LawPay to finish signing in.", "exchange-failed");
  }
  if (!res.ok) throw new LawPayOAuthError(`LawPay refused the sign-in (HTTP ${res.status}).`, "exchange-failed");
  const tokens = parseTokenResponse(await readJson(res), args.now ?? Date.now());
  if (!tokens) throw new LawPayOAuthError("LawPay's sign-in answer had no access token.", "exchange-failed");
  return tokens;
}

/** True when the token has a known expiry within `skewMs` of `now`. */
export function needsRefresh(expiresAt: string | null, now: number, skewMs = 5 * 60 * 1000): boolean {
  if (!expiresAt) return false;
  const at = Date.parse(expiresAt);
  return Number.isFinite(at) && at - now <= skewMs;
}

/**
 * Refresh grant. LawPay documents none; this is only reached when a token
 * response actually carried a refresh token. A 400/401 means the grant is dead
 * and only a person reconnecting can fix it.
 */
export async function refreshLawPayToken(args: {
  creds: LawPayClientCredentials;
  refreshToken: string;
  apiBase?: string;
  fetchImpl?: FetchLike;
  now?: number;
}): Promise<LawPayTokenSet> {
  let res: Response;
  try {
    res = await postToken(
      {
        client_id: args.creds.clientId,
        client_secret: args.creds.clientSecret,
        grant_type: "refresh_token",
        refresh_token: args.refreshToken,
      },
      args,
    );
  } catch {
    throw new LawPayOAuthError("Couldn't reach LawPay to refresh the connection.", "refresh-failed");
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new LawPayOAuthError("LawPay no longer accepts this connection. Reconnect LawPay.", "reauth");
  }
  if (!res.ok) throw new LawPayOAuthError(`LawPay refresh failed (HTTP ${res.status}).`, "refresh-failed");
  const tokens = parseTokenResponse(await readJson(res), args.now ?? Date.now());
  if (!tokens) throw new LawPayOAuthError("LawPay's refresh answer had no access token.", "refresh-failed");
  // A refresh that returns no new refresh token keeps the old one.
  return { ...tokens, refreshToken: tokens.refreshToken ?? args.refreshToken };
}

/* ───────────────────────── gateway credentials ──────────────────────────── */

/** `true`/`"true"` → true, `false`/`"false"` → false, anything else → null. */
export function readTrustFlag(value: unknown): boolean | null {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function parseAccounts(list: unknown, mode: LawPayMode, out: GatewayCredentials): void {
  if (!Array.isArray(list)) return;
  for (const raw of list) {
    const a = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const id = str(a?.id);
    const type = a?.type === "MerchantAccount" || a?.type === "AchAccount" ? a.type : null;
    const trust = readTrustFlag(a?.trust_account);
    const secret = str(a?.secret_key);
    if (!id || !type || trust === null || !secret) {
      out.skipped += 1;
      continue;
    }
    out.accounts.push({
      id,
      name: str(a?.name)?.slice(0, 120) ?? null,
      type,
      trust_account: trust,
      mode,
      public_key: str(a?.public_key),
      currency: str(a?.currency),
    });
    out.secrets[secretKeyFor(mode, id)] = secret;
  }
}

/** Pure parse of GET /gateway-credentials. Exported for tests. */
export function parseGatewayCredentials(body: Record<string, unknown> | null): GatewayCredentials {
  const out: GatewayCredentials = { merchantId: null, merchantName: null, accounts: [], secrets: {}, skipped: 0 };
  const merchant = body?.merchant && typeof body.merchant === "object" ? (body.merchant as Record<string, unknown>) : null;
  out.merchantId = str(merchant?.id);
  out.merchantName = (str(merchant?.name) ?? str(merchant?.business_name) ?? str(merchant?.company_name))?.slice(0, 300) ?? null;
  parseAccounts(body?.test_accounts, "test", out);
  parseAccounts(body?.live_accounts, "live", out);
  return out;
}

export async function fetchGatewayCredentials(args: {
  accessToken: string;
  apiBase?: string;
  fetchImpl?: FetchLike;
}): Promise<GatewayCredentials> {
  const doFetch = args.fetchImpl ?? (globalThis.fetch as FetchLike);
  let res: Response;
  try {
    res = await doFetch(`${trimBase(args.apiBase || DEFAULT_API_BASE)}/gateway-credentials`, {
      method: "GET",
      headers: { Authorization: `Bearer ${args.accessToken}`, Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    throw new LawPayOAuthError("Couldn't reach LawPay to read your accounts.", "fetch-failed");
  }
  if (res.status === 401 || res.status === 403) {
    throw new LawPayOAuthError("LawPay no longer accepts this connection. Reconnect LawPay.", "reauth");
  }
  if (!res.ok) throw new LawPayOAuthError(`LawPay didn't return your accounts (HTTP ${res.status}).`, "fetch-failed");
  const parsed = parseGatewayCredentials(await readJson(res));
  if (parsed.accounts.length === 0) {
    throw new LawPayOAuthError("LawPay returned no accounts we can use for this merchant.", "no-accounts");
  }
  return parsed;
}

/* ─────────────────────────────── deauthorize ────────────────────────────── */

/**
 * Tells LawPay to drop Lectual's access for this merchant. Best effort: the
 * caller has already removed our copy of every secret, and returns whether
 * LawPay confirmed. Never throws.
 */
export async function deauthorizeLawPay(args: {
  creds: LawPayClientCredentials;
  publicKey: string;
  apiBase?: string;
  fetchImpl?: FetchLike;
}): Promise<boolean> {
  const doFetch = args.fetchImpl ?? (globalThis.fetch as FetchLike);
  try {
    const tokenRes = await postToken(
      { client_id: args.creds.clientId, client_secret: args.creds.clientSecret, grant_type: "client_credentials", scope: "tenant" },
      args,
    );
    if (!tokenRes.ok) return false;
    const tenant = str((await readJson(tokenRes))?.access_token);
    if (!tenant) return false;
    const res = await doFetch(`${DEAUTHORIZE_BASE}/${encodeURIComponent(args.publicKey)}/deauthorize_application`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tenant}`, Accept: "application/json" },
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}
