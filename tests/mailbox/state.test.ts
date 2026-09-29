import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import {
  STATE_TTL_MS,
  checkState,
  encodeStateCookie,
  newState,
  pkceChallenge,
} from "@/lib/mailbox/state";

const root = randomBytes(32);
const session = { userId: "user-1", orgId: "org-1" };

function fresh(now = 1_000_000) {
  const state = newState({ provider: "google", scope: "personal", ...session }, now);
  return { state, cookie: encodeStateCookie(root, state) };
}

describe("OAuth state", () => {
  it("accepts the round trip it started", () => {
    const { state, cookie } = fresh();
    const r = checkState(root, { cookie, stateParam: state.nonce, provider: "google", session, now: 1_000_500 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.verifier).toBe(state.verifier);
  });

  it("rejects a missing cookie or state parameter", () => {
    const { state, cookie } = fresh();
    expect(checkState(root, { cookie: undefined, stateParam: state.nonce, provider: "google", session })).toEqual({ ok: false, reason: "missing" });
    expect(checkState(root, { cookie, stateParam: null, provider: "google", session })).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects a state parameter that isn't this browser's nonce (CSRF / login swap)", () => {
    const { cookie } = fresh();
    const r = checkState(root, { cookie, stateParam: "someone-elses-nonce", provider: "google", session, now: 1_000_001 });
    expect(r).toEqual({ ok: false, reason: "mismatch" });
  });

  it("rejects a cookie whose payload was edited to point at another firm", () => {
    const { state, cookie } = fresh();
    const [, sig] = cookie.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ ...state, orgId: "org-2" })).toString("base64url");
    const r = checkState(root, {
      cookie: `${forgedBody}.${sig}`,
      stateParam: state.nonce,
      provider: "google",
      session: { ...session, orgId: "org-2" },
      now: 1_000_001,
    });
    expect(r).toEqual({ ok: false, reason: "forged" });
  });

  it("rejects a cookie signed with a different key", () => {
    const { state } = fresh();
    const cookie = encodeStateCookie(randomBytes(32), state);
    expect(checkState(root, { cookie, stateParam: state.nonce, provider: "google", session, now: 1_000_001 }).ok).toBe(false);
  });

  it("expires after the TTL", () => {
    const { state, cookie } = fresh(1_000_000);
    const r = checkState(root, { cookie, stateParam: state.nonce, provider: "google", session, now: 1_000_000 + STATE_TTL_MS + 1 });
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects finishing on a different provider's callback", () => {
    const { state, cookie } = fresh();
    const r = checkState(root, { cookie, stateParam: state.nonce, provider: "microsoft", session, now: 1_000_001 });
    expect(r).toEqual({ ok: false, reason: "wrong-provider" });
  });

  it("rejects when the caller switched firm or account mid-flow", () => {
    const { state, cookie } = fresh();
    const base = { cookie, stateParam: state.nonce, provider: "google", now: 1_000_001 };
    expect(checkState(root, { ...base, session: { userId: "user-1", orgId: "org-2" } })).toEqual({ ok: false, reason: "wrong-session" });
    expect(checkState(root, { ...base, session: { userId: "user-2", orgId: "org-1" } })).toEqual({ ok: false, reason: "wrong-session" });
  });

  it("generates a PKCE verifier within RFC 7636 bounds and its S256 challenge", () => {
    const { state } = fresh();
    expect(state.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(pkceChallenge(state.verifier)).toBe(createHash("sha256").update(state.verifier).digest("base64url"));
  });
});
