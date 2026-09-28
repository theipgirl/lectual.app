import { createHash, randomBytes } from "node:crypto";
import { signState, verifyStateSignature } from "@/lib/mailbox/crypto";

/**
 * The "Connect Zoom" round trip's memory: the LawPay pattern
 * (src/lib/payments/lawpay-state.ts) with its own cookie, path and HKDF
 * context, so a mailbox or LawPay state cookie can never finish a Zoom
 * connection or the reverse.
 *
 * The signed, httpOnly cookie remembers WHO started the flow, for WHICH firm,
 * and the PKCE verifier; the `state` parameter carries only a nonce that must
 * match it. Rejected: no cookie / no state, a signature that doesn't verify,
 * a nonce mismatch, older than STATE_TTL_MS, or a different signed-in user or
 * active firm than the one that started it (a firm's Zoom grant must never
 * land in a firm the admin wasn't standing in when they approved it).
 */

export const ZOOM_STATE_COOKIE = "lx_zoom_oauth";
export const ZOOM_STATE_PATH = "/api/meetings/zoom/callback/";
export const STATE_TTL_MS = 10 * 60 * 1000;

export type ZoomOAuthState = { nonce: string; verifier: string; orgId: string; userId: string; issuedAt: number };

export type ZoomStateCheck =
  | { ok: true; state: ZoomOAuthState }
  | { ok: false; reason: "missing" | "forged" | "mismatch" | "expired" | "wrong-session" };

export function newZoomState(input: { orgId: string; userId: string }, now = Date.now()): ZoomOAuthState {
  return {
    orgId: input.orgId,
    userId: input.userId,
    nonce: randomBytes(16).toString("base64url"),
    verifier: randomBytes(32).toString("base64url"),
    issuedAt: now,
  };
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function encodeZoomStateCookie(root: Buffer, state: ZoomOAuthState): string {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${signState(root, body, "lectual-meetings")}`;
}

export function checkZoomState(
  root: Buffer,
  args: { cookie: string | undefined; stateParam: string | null; session: { userId: string; orgId: string }; now?: number },
): ZoomStateCheck {
  const { cookie, stateParam, session, now = Date.now() } = args;
  if (!cookie || !stateParam) return { ok: false, reason: "missing" };
  const dot = cookie.lastIndexOf(".");
  if (dot < 1) return { ok: false, reason: "forged" };
  const body = cookie.slice(0, dot);
  let signed = false;
  try {
    signed = verifyStateSignature(root, body, cookie.slice(dot + 1), "lectual-meetings");
  } catch {
    signed = false;
  }
  if (!signed) return { ok: false, reason: "forged" };
  let state: ZoomOAuthState;
  try {
    state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ZoomOAuthState;
  } catch {
    return { ok: false, reason: "forged" };
  }
  if (!state || typeof state.nonce !== "string" || typeof state.verifier !== "string" || typeof state.issuedAt !== "number") {
    return { ok: false, reason: "forged" };
  }
  if (state.nonce !== stateParam) return { ok: false, reason: "mismatch" };
  if (!(now - state.issuedAt >= 0 && now - state.issuedAt <= STATE_TTL_MS)) return { ok: false, reason: "expired" };
  if (state.userId !== session.userId || state.orgId !== session.orgId) return { ok: false, reason: "wrong-session" };
  return { ok: true, state };
}
