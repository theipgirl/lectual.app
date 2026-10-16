import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { STATE_TTL_MS, checkZoomState, encodeZoomStateCookie, newZoomState, pkceChallenge } from "@/lib/meetings/state";
import { encodeLawPayStateCookie, newLawPayState } from "@/lib/payments/lawpay-state";

const root = randomBytes(32);
const session = { userId: "u1", orgId: "o1" };

function issued(now = 1_000_000) {
  const state = newZoomState(session, now);
  return { state, cookie: encodeZoomStateCookie(root, state) };
}

describe("Zoom OAuth state cookie", () => {
  it("accepts the untouched cookie with its own nonce, same user and firm, in time", () => {
    const { state, cookie } = issued();
    const check = checkZoomState(root, { cookie, stateParam: state.nonce, session, now: 1_000_000 + 1000 });
    expect(check.ok).toBe(true);
    expect(pkceChallenge(state.verifier)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("rejects an edited body (e.g. re-pointed at another firm)", () => {
    const { state, cookie } = issued();
    const [body, sig] = [cookie.slice(0, cookie.lastIndexOf(".")), cookie.slice(cookie.lastIndexOf(".") + 1)];
    const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), orgId: "other-firm" })).toString("base64url");
    expect(checkZoomState(root, { cookie: `${edited}.${sig}`, stateParam: state.nonce, session: { ...session, orgId: "other-firm" }, now: 1_000_000 })).toEqual({ ok: false, reason: "forged" });
  });

  it("rejects a forged signature, a missing cookie, a nonce mismatch, an expired cookie and a different session", () => {
    const { state, cookie } = issued();
    expect(checkZoomState(root, { cookie: cookie.slice(0, -2) + "xx", stateParam: state.nonce, session, now: 1_000_000 }).ok).toBe(false);
    expect(checkZoomState(randomBytes(32), { cookie, stateParam: state.nonce, session, now: 1_000_000 })).toEqual({ ok: false, reason: "forged" });
    expect(checkZoomState(root, { cookie: undefined, stateParam: state.nonce, session })).toEqual({ ok: false, reason: "missing" });
    expect(checkZoomState(root, { cookie, stateParam: "other", session, now: 1_000_000 })).toEqual({ ok: false, reason: "mismatch" });
    expect(checkZoomState(root, { cookie, stateParam: state.nonce, session, now: 1_000_000 + STATE_TTL_MS + 1 })).toEqual({ ok: false, reason: "expired" });
    expect(checkZoomState(root, { cookie, stateParam: state.nonce, session: { userId: "u2", orgId: "o1" }, now: 1_000_000 })).toEqual({ ok: false, reason: "wrong-session" });
  });

  it("a LawPay state cookie (same root key, other HKDF context) cannot finish a Zoom connection", () => {
    const lp = newLawPayState(session, 1_000_000);
    const cookie = encodeLawPayStateCookie(root, lp);
    expect(checkZoomState(root, { cookie, stateParam: lp.nonce, session, now: 1_000_000 })).toEqual({ ok: false, reason: "forged" });
  });
});
