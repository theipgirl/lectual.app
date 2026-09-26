import { randomBytes, createHash } from "node:crypto";
import { signState, verifyStateSignature } from "./crypto";
import type { MailboxProvider, MailboxScope } from "./providers";

/**
 * The OAuth round trip's memory.
 *
 * Between "Connect Gmail" and the provider redirecting back, we must remember
 * WHO asked, for WHICH firm, and the PKCE verifier. That lives in a signed,
 * httpOnly cookie scoped to the callback path; the `state` query parameter
 * carries only a random nonce that must match it. So the callback trusts
 * nothing it is handed in the URL:
 *
 *   · state ≠ the cookie's nonce          → rejected (CSRF / login-swap)
 *   · cookie signature doesn't verify     → rejected (forged cookie)
 *   · older than STATE_TTL_MS             → rejected (replay)
 *   · provider in URL ≠ provider in cookie → rejected
 *   · the signed-in user or active firm is not the one that started the flow
 *     → rejected (someone switched firm or account mid-flow; the token must
 *     never land in a firm the caller wasn't standing in when they consented)
 */

export const STATE_COOKIE = "lx_mbx_oauth";
export const STATE_TTL_MS = 10 * 60 * 1000;

export type OAuthState = {
  nonce: string;
  verifier: string;
  provider: MailboxProvider;
  scope: MailboxScope;
  orgId: string;
  userId: string;
  issuedAt: number;
};

export type StateCheck =
  | { ok: true; state: OAuthState }
  | { ok: false; reason: "missing" | "forged" | "mismatch" | "expired" | "wrong-provider" | "wrong-session" };

export function newState(input: Omit<OAuthState, "nonce" | "verifier" | "issuedAt">, now = Date.now()): OAuthState {
  return {
    ...input,
    nonce: randomBytes(16).toString("base64url"),
    // RFC 7636: 43–128 chars from the unreserved set; 32 bytes base64url = 43.
    verifier: randomBytes(32).toString("base64url"),
    issuedAt: now,
  };
}

/** PKCE S256 challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function encodeStateCookie(root: Buffer, state: OAuthState): string {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${signState(root, body)}`;
}

export function checkState(
  root: Buffer,
  args: {
    cookie: string | undefined;
    stateParam: string | null;
    provider: string;
    session: { userId: string; orgId: string };
    now?: number;
  },
): StateCheck {
  const { cookie, stateParam, provider, session, now = Date.now() } = args;
  if (!cookie || !stateParam) return { ok: false, reason: "missing" };

  const dot = cookie.lastIndexOf(".");
  if (dot < 1) return { ok: false, reason: "forged" };
  const body = cookie.slice(0, dot);
  if (!verifyStateSignature(root, body, cookie.slice(dot + 1))) return { ok: false, reason: "forged" };

  let state: OAuthState;
  try {
    state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as OAuthState;
  } catch {
    return { ok: false, reason: "forged" };
  }

  if (state.nonce !== stateParam) return { ok: false, reason: "mismatch" };
  if (!(now - state.issuedAt >= 0 && now - state.issuedAt <= STATE_TTL_MS)) {
    return { ok: false, reason: "expired" };
  }
  if (state.provider !== provider) return { ok: false, reason: "wrong-provider" };
  if (state.userId !== session.userId || state.orgId !== session.orgId) {
    return { ok: false, reason: "wrong-session" };
  }
  return { ok: true, state };
}
