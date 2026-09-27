import { createHash, randomBytes } from "node:crypto";
import { signState, verifyStateSignature } from "@/lib/mailbox/crypto";

/**
 * The "Connect LawPay" round trip's memory — the mailbox pattern
 * (src/lib/mailbox/state.ts) with its own cookie, its own path and its own HKDF
 * context, so a mailbox state cookie can never finish a LawPay connection or
 * the reverse.
 *
 * The signed, httpOnly cookie remembers WHO started the flow, for WHICH firm,
 * and the PKCE verifier. The `state` query parameter carries only a nonce that
 * must match it. The callback trusts nothing it is handed in the URL:
 *
 *   · no cookie or no state parameter      → rejected
 *   · signature doesn't verify              → rejected (forged / edited)
 *   · state ≠ the cookie's nonce            → rejected (CSRF / login swap)
 *   · older than STATE_TTL_MS               → rejected (replay)
 *   · signed-in user or active firm differs → rejected: a firm's payment
 *     account must never land in a firm the admin wasn't standing in when
 *     they approved it.
 */

export const LAWPAY_STATE_COOKIE = "lx_lawpay_oauth";
export const LAWPAY_STATE_PATH = "/api/lawpay/callback/";
export const STATE_TTL_MS = 10 * 60 * 1000;

export type LawPayOAuthState = {
  nonce: string;
  verifier: string;
  orgId: string;
  userId: string;
  issuedAt: number;
};

export type LawPayStateCheck =
  | { ok: true; state: LawPayOAuthState }
  | { ok: false; reason: "missing" | "forged" | "mismatch" | "expired" | "wrong-session" };

export function newLawPayState(input: { orgId: string; userId: string }, now = Date.now()): LawPayOAuthState {
  return {
    orgId: input.orgId,
    userId: input.userId,
    nonce: randomBytes(16).toString("base64url"),
    // RFC 7636: 43–128 unreserved chars; 32 bytes base64url = 43.
    verifier: randomBytes(32).toString("base64url"),
    issuedAt: now,
  };
}

/** PKCE S256 challenge for a verifier. */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function encodeLawPayStateCookie(root: Buffer, state: LawPayOAuthState): string {
  const body = Buffer.from(JSON.stringify(state)).toString("base64url");
  return `${body}.${signState(root, body, "lectual-lawpay")}`;
}

export function checkLawPayState(
  root: Buffer,
  args: {
    cookie: string | undefined;
    stateParam: string | null;
    session: { userId: string; orgId: string };
    now?: number;
  },
): LawPayStateCheck {
  const { cookie, stateParam, session, now = Date.now() } = args;
  if (!cookie || !stateParam) return { ok: false, reason: "missing" };

  const dot = cookie.lastIndexOf(".");
  if (dot < 1) return { ok: false, reason: "forged" };
  const body = cookie.slice(0, dot);
  let signed = false;
  try {
    signed = verifyStateSignature(root, body, cookie.slice(dot + 1), "lectual-lawpay");
  } catch {
    signed = false;
  }
  if (!signed) return { ok: false, reason: "forged" };

  let state: LawPayOAuthState;
  try {
    state = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as LawPayOAuthState;
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
