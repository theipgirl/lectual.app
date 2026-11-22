import { randomBytes } from "node:crypto";
import { signState, verifyStateSignature } from "@/lib/mailbox/crypto";
import { withTimeout } from "@/lib/http/timeout";
import { adobeAccessPoint, sameAccessPoint } from "./host-rule";
import { ADOBE_CALL_TIMEOUT_MS, AdobeHostRefused, type AdobeFetch } from "./adobe-client";

/**
 * "Connect Adobe Acrobat Sign": the OAuth half of a firm's OWN Adobe connection (Sprint 5a, contract item 2). No PKCE (D13):
 * the signed `state` cookie bound to the user and the firm is the protection, and Adobe's refresh token does not rotate.
 *
 * From Adobe's documentation (read 2026-11-17, `adobe-sign-design.md` §1.1; NOT run against a live account):
 *   authorize  GET  https://secure.adobesign.com/public/oauth/v2 ?response_type=code&client_id&redirect_uri&scope&state
 *              → the redirect back carries `code`, `state` and the firm's `api_access_point` (and `web_access_point`).
 *   token      POST <api_access_point>/oauth/v2/token   (form) grant_type=authorization_code, code, client_id, client_secret, redirect_uri
 *   refresh    POST <api_access_point>/oauth/v2/refresh (form) grant_type=refresh_token, client_id, client_secret, refresh_token
 *              → a new access token and NO new refresh token (keep the stored one).
 *   revoke     POST <api_access_point>/oauth/v2/revoke  (form) token
 *   user       GET  <api_access_point>/api/rest/v6/users/me (the "Connected as" email; the shape is unverified)
 *
 * THE HOST RULE COMES FIRST. The `api_access_point` on the redirect is checked BEFORE the token POST, which carries Lectual's
 * `client_secret`; the token answer's own `api_access_point` must equal it, and its `web_access_point` must pass the rule too.
 * Nothing here logs or returns Adobe's text.
 */

export const DEFAULT_ADOBE_AUTHORIZE_URL = "https://secure.adobesign.com/public/oauth/v2";
/** The minimum, all `:self` (never `:group` / `:account`). */
export const ADOBE_SCOPES = ["user_read:self", "agreement_read:self", "agreement_write:self", "webhook_write:self"] as const;

export type AdobeClientCredentials = { clientId: string; clientSecret: string };

export type AdobeTokenSet = {
  accessToken: string;
  refreshToken: string;
  /** ISO. */
  accessExpiresAt: string;
  apiAccessPoint: string;
  webAccessPoint: string | null;
};

export type AdobeOAuthErrorCode = "host-refused" | "exchange-failed" | "reauth" | "refresh-failed";

export class AdobeOAuthError extends Error {
  constructor(readonly code: AdobeOAuthErrorCode) {
    super(`adobe_oauth:${code}`);
    this.name = "AdobeOAuthError";
  }
}

/* ─────────────────────────────── state cookie ─────────────────────────────── */

export const ADOBE_STATE_COOKIE = "lx_adobe_sign_oauth";
export const ADOBE_STATE_PATH = "/api/esign/callback/";
export const ADOBE_STATE_TTL_MS = 10 * 60 * 1000;

export type AdobeOAuthState = { nonce: string; orgId: string; userId: string; issuedAt: number };

export type AdobeStateCheck =
  | { ok: true; state: AdobeOAuthState }
  | { ok: false; reason: "missing" | "forged" | "mismatch" | "expired" | "wrong-session" };

export function newAdobeState(input: { orgId: string; userId: string }, now = Date.now()): AdobeOAuthState {
  return { orgId: input.orgId, userId: input.userId, nonce: randomBytes(16).toString("base64url"), issuedAt: now };
}

export function encodeAdobeStateCookie(root: Buffer, state: AdobeOAuthState): string {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${signState(root, body, "lectual-adobe-sign")}`;
}

/** The cookie from /connect is the only thing trusted about who started this: nonce, age, user and firm must all match. */
export function checkAdobeState(
  root: Buffer,
  args: { cookie: string | undefined; stateParam: string | null; session: { userId: string; orgId: string }; now?: number },
): AdobeStateCheck {
  const { cookie, stateParam, session, now = Date.now() } = args;
  if (!cookie || !stateParam) return { ok: false, reason: "missing" };
  const dot = cookie.lastIndexOf(".");
  if (dot < 1) return { ok: false, reason: "forged" };
  const body = cookie.slice(0, dot);
  let signed = false;
  try {
    signed = verifyStateSignature(root, body, cookie.slice(dot + 1), "lectual-adobe-sign");
  } catch {
    signed = false;
  }
  if (!signed) return { ok: false, reason: "forged" };
  let state: AdobeOAuthState;
  try {
    state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdobeOAuthState;
  } catch {
    return { ok: false, reason: "forged" };
  }
  if (!state || typeof state.nonce !== "string" || typeof state.issuedAt !== "number" || typeof state.orgId !== "string" || typeof state.userId !== "string") {
    return { ok: false, reason: "forged" };
  }
  if (state.nonce !== stateParam) return { ok: false, reason: "mismatch" };
  if (!(now - state.issuedAt >= 0 && now - state.issuedAt <= ADOBE_STATE_TTL_MS)) return { ok: false, reason: "expired" };
  if (state.userId !== session.userId || state.orgId !== session.orgId) return { ok: false, reason: "wrong-session" };
  return { ok: true, state };
}

/* ─────────────────────────────── authorize ──────────────────────────────── */

export function adobeAuthorizeUrl(args: { clientId: string; redirectUri: string; nonce: string; authorizeUrl?: string }): string {
  const url = new URL(args.authorizeUrl || DEFAULT_ADOBE_AUTHORIZE_URL);
  const p = url.searchParams;
  p.set("response_type", "code");
  p.set("client_id", args.clientId);
  p.set("redirect_uri", args.redirectUri);
  p.set("scope", ADOBE_SCOPES.join(" "));
  p.set("state", args.nonce);
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

function expiresAt(body: Record<string, unknown> | null, now: number): string {
  const expiresIn = typeof body?.expires_in === "number" && body.expires_in > 0 ? body.expires_in : 3600;
  return new Date(now + expiresIn * 1000).toISOString();
}

async function postForm(fetchImpl: AdobeFetch, url: string, form: Record<string, string>): Promise<Response> {
  return fetchImpl(
    url,
    withTimeout(
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams(form).toString(),
        cache: "no-store",
      },
      ADOBE_CALL_TIMEOUT_MS,
    ),
  );
}

/**
 * Exchanges the code at the FIRM's access point. The access point from the redirect is checked BEFORE the POST (which carries
 * the client secret); the answer's `api_access_point` must be the same one, and its `web_access_point` must pass the rule.
 */
export async function exchangeAdobeCode(args: {
  creds: AdobeClientCredentials;
  code: string;
  redirectUri: string;
  /** `api_access_point` from the redirect's query string. */
  accessPoint: string | null;
  fetchImpl?: AdobeFetch;
  now?: number;
}): Promise<AdobeTokenSet> {
  const origin = adobeAccessPoint(args.accessPoint);
  if (!origin) throw new AdobeOAuthError("host-refused");
  const fetchImpl = args.fetchImpl ?? (globalThis.fetch as AdobeFetch);
  let res: Response;
  try {
    res = await postForm(fetchImpl, `${origin}/oauth/v2/token`, {
      grant_type: "authorization_code",
      code: args.code,
      client_id: args.creds.clientId,
      client_secret: args.creds.clientSecret,
      redirect_uri: args.redirectUri,
    });
  } catch {
    throw new AdobeOAuthError("exchange-failed");
  }
  if (!res.ok) throw new AdobeOAuthError("exchange-failed");
  const body = await readJson(res);
  const accessToken = str(body?.access_token);
  const refreshToken = str(body?.refresh_token);
  if (!accessToken || !refreshToken) throw new AdobeOAuthError("exchange-failed");
  // The answer must name the SAME shard the redirect did; anything else is refused and nothing is stored.
  if (!sameAccessPoint(body?.api_access_point, origin)) throw new AdobeOAuthError("host-refused");
  const web = body?.web_access_point;
  let webAccessPoint: string | null = null;
  if (web !== undefined && web !== null) {
    webAccessPoint = adobeAccessPoint(web);
    if (!webAccessPoint) throw new AdobeOAuthError("host-refused");
  }
  return { accessToken, refreshToken, accessExpiresAt: expiresAt(body, args.now ?? Date.now()), apiAccessPoint: origin, webAccessPoint };
}

/** True when the access token has under `skewMs` (5 minutes) left. */
export function adobeNeedsRefresh(accessExpiresAt: string | null, now: number, skewMs = 5 * 60 * 1000): boolean {
  if (!accessExpiresAt) return true;
  const at = Date.parse(accessExpiresAt);
  return !Number.isFinite(at) || at - now <= skewMs;
}

/** A new access token. Adobe's refresh token does not rotate: the stored one is kept. A refused grant is `reauth`. */
export async function refreshAdobeToken(args: {
  creds: AdobeClientCredentials;
  refreshToken: string;
  accessPoint: string;
  fetchImpl?: AdobeFetch;
  now?: number;
}): Promise<{ accessToken: string; accessExpiresAt: string }> {
  const origin = adobeAccessPoint(args.accessPoint);
  if (!origin) throw new AdobeOAuthError("host-refused");
  const fetchImpl = args.fetchImpl ?? (globalThis.fetch as AdobeFetch);
  let res: Response;
  try {
    res = await postForm(fetchImpl, `${origin}/oauth/v2/refresh`, {
      grant_type: "refresh_token",
      client_id: args.creds.clientId,
      client_secret: args.creds.clientSecret,
      refresh_token: args.refreshToken,
    });
  } catch {
    throw new AdobeOAuthError("refresh-failed");
  }
  const body = await readJson(res);
  if (res.status === 401 || (res.status === 400 && str(body?.error) === "invalid_grant")) throw new AdobeOAuthError("reauth");
  if (!res.ok) throw new AdobeOAuthError("refresh-failed");
  const accessToken = str(body?.access_token);
  if (!accessToken) throw new AdobeOAuthError("refresh-failed");
  return { accessToken, accessExpiresAt: expiresAt(body, args.now ?? Date.now()) };
}

/** Revokes the refresh token (and with it its access tokens). Best effort; never throws; never sends to a refused host. */
export async function revokeAdobeToken(args: { accessPoint: string; token: string; fetchImpl?: AdobeFetch }): Promise<boolean> {
  const origin = adobeAccessPoint(args.accessPoint);
  if (!origin) return false;
  try {
    const res = await postForm(args.fetchImpl ?? (globalThis.fetch as AdobeFetch), `${origin}/oauth/v2/revoke`, { token: args.token });
    return res.ok;
  } catch {
    return false;
  }
}

/** GET /users/me → the account email, or null. A refused host throws before any request. */
export async function readAdobeAccountEmail(args: { accessPoint: string; accessToken: string; fetchImpl?: AdobeFetch }): Promise<string | null> {
  const origin = adobeAccessPoint(args.accessPoint);
  if (!origin) throw new AdobeHostRefused();
  try {
    const res = await (args.fetchImpl ?? (globalThis.fetch as AdobeFetch))(
      `${origin}/api/rest/v6/users/me`,
      withTimeout({ method: "GET", headers: { Authorization: `Bearer ${args.accessToken}`, Accept: "application/json" }, cache: "no-store" }, ADOBE_CALL_TIMEOUT_MS),
    );
    if (!res.ok) return null;
    const email = str((await readJson(res))?.email);
    return email && email.length <= 320 && email.includes("@") ? email : null;
  } catch {
    return null;
  }
}
