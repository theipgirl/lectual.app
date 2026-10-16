import { describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  STATE_TTL_MS,
  checkLawPayState,
  encodeLawPayStateCookie,
  newLawPayState,
  pkceChallenge,
} from "@/lib/payments/lawpay-state";
import { encodeStateCookie, newState } from "@/lib/mailbox/state";
import { openToken, sealToken } from "@/lib/mailbox/crypto";
import {
  LawPayOAuthError,
  deauthorizeLawPay,
  exchangeLawPayCode,
  fetchGatewayCredentials,
  lawPayAuthorizeUrl,
  needsRefresh,
  parseGatewayCredentials,
  parseTokenResponse,
  readTrustFlag,
  refreshLawPayToken,
} from "@/lib/payments/lawpay-oauth";

/** Mocked HTTP only. */

const root = randomBytes(32);
const session = { userId: "user-1", orgId: "org-1" };
const T0 = 5_000_000;

function fresh(now = T0) {
  const state = newLawPayState(session, now);
  return { state, cookie: encodeLawPayStateCookie(root, state) };
}

describe("LawPay OAuth state cookie", () => {
  it("accepts its own round trip", () => {
    const { state, cookie } = fresh();
    const r = checkLawPayState(root, { cookie, stateParam: state.nonce, session, now: T0 + 1000 });
    expect(r.ok).toBe(true);
  });

  it("rejects a tampered payload (re-pointed at another firm)", () => {
    const { state, cookie } = fresh();
    const [, sig] = cookie.split(".");
    const forged = Buffer.from(JSON.stringify({ ...state, orgId: "org-2" })).toString("base64url");
    const r = checkLawPayState(root, { cookie: `${forged}.${sig}`, stateParam: state.nonce, session: { ...session, orgId: "org-2" }, now: T0 + 1 });
    expect(r).toEqual({ ok: false, reason: "forged" });
  });

  it("rejects a flipped signature byte and a different key", () => {
    const { state, cookie } = fresh();
    const flipped = cookie.slice(0, -2) + (cookie.endsWith("A") ? "BB" : "AA");
    expect(checkLawPayState(root, { cookie: flipped, stateParam: state.nonce, session, now: T0 + 1 }).ok).toBe(false);
    expect(checkLawPayState(randomBytes(32), { cookie, stateParam: state.nonce, session, now: T0 + 1 }).ok).toBe(false);
  });

  it("rejects a mailbox state cookie (separate HKDF context)", () => {
    const mailbox = newState({ provider: "google", scope: "personal", ...session }, T0);
    const cookie = encodeStateCookie(root, mailbox);
    expect(checkLawPayState(root, { cookie, stateParam: mailbox.nonce, session, now: T0 + 1 })).toEqual({ ok: false, reason: "forged" });
  });

  it("rejects a state parameter that isn't this browser's nonce, or a missing one", () => {
    const { state, cookie } = fresh();
    expect(checkLawPayState(root, { cookie, stateParam: "other", session, now: T0 + 1 })).toEqual({ ok: false, reason: "mismatch" });
    expect(checkLawPayState(root, { cookie, stateParam: null, session })).toEqual({ ok: false, reason: "missing" });
    expect(checkLawPayState(root, { cookie: undefined, stateParam: state.nonce, session })).toEqual({ ok: false, reason: "missing" });
  });

  it("expires after the TTL and refuses a timestamp from the future", () => {
    const { state, cookie } = fresh();
    expect(checkLawPayState(root, { cookie, stateParam: state.nonce, session, now: T0 + STATE_TTL_MS + 1 })).toEqual({ ok: false, reason: "expired" });
    expect(checkLawPayState(root, { cookie, stateParam: state.nonce, session, now: T0 - 1 })).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a different signed-in user or active firm", () => {
    const { state, cookie } = fresh();
    expect(checkLawPayState(root, { cookie, stateParam: state.nonce, session: { ...session, orgId: "org-2" }, now: T0 + 1 })).toEqual({ ok: false, reason: "wrong-session" });
    expect(checkLawPayState(root, { cookie, stateParam: state.nonce, session: { ...session, userId: "u2" }, now: T0 + 1 })).toEqual({ ok: false, reason: "wrong-session" });
  });
});

describe("sealing", () => {
  it("a LawPay-sealed secret can't be opened under the mailbox context", () => {
    const sealed = sealToken(root, "sk_secret", "lectual-lawpay");
    expect(openToken(root, sealed, "lectual-lawpay")).toBe("sk_secret");
    expect(() => openToken(root, sealed)).toThrow();
  });
});

describe("authorize URL", () => {
  it("asks for the payments scope with state and S256 PKCE", () => {
    const url = new URL(lawPayAuthorizeUrl({ clientId: "cid", redirectUri: "https://app/api/lawpay/callback/", nonce: "n1", verifier: "v".repeat(43) }));
    expect(url.origin + url.pathname).toBe("https://secure.lawpay.com/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("payments");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("n1");
    expect(url.searchParams.get("code_challenge")).toBe(pkceChallenge("v".repeat(43)));
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

const creds = { clientId: "cid", clientSecret: "csecret" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("token exchange and refresh", () => {
  it("posts the code and PKCE verifier; no documented expiry means expiresAt null", async () => {
    const f = vi.fn(async () => json(200, { access_token: "at", token_type: "bearer", created_at: 1464986958 }));
    const t = await exchangeLawPayCode({ creds, code: "c", redirectUri: "https://r/", verifier: "ver", apiBase: "https://api.test", fetchImpl: f });
    expect(t).toMatchObject({ accessToken: "at", refreshToken: null, expiresAt: null });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/oauth/token");
    expect(JSON.parse(String(init.body))).toMatchObject({ grant_type: "authorization_code", code: "c", code_verifier: "ver", client_id: "cid" });
  });

  it("honours expires_in and refresh_token when LawPay sends them", () => {
    const t = parseTokenResponse({ access_token: "a", refresh_token: "r", expires_in: 3600, created_at: 1000 }, 0);
    expect(t).toMatchObject({ refreshToken: "r", expiresAt: new Date(1000 * 1000 + 3600 * 1000).toISOString() });
  });

  it("needsRefresh only for a known expiry inside the skew", () => {
    expect(needsRefresh(null, Date.now())).toBe(false);
    expect(needsRefresh(new Date(10_000 + 60_000).toISOString(), 10_000)).toBe(true);
    expect(needsRefresh(new Date(10_000 + 3_600_000).toISOString(), 10_000)).toBe(false);
  });

  it("refresh returns new tokens and keeps the old refresh token if none is returned", async () => {
    const f = vi.fn(async () => json(200, { access_token: "at2", expires_in: 60 }));
    const t = await refreshLawPayToken({ creds, refreshToken: "rt1", fetchImpl: f, now: 0 });
    expect(t).toMatchObject({ accessToken: "at2", refreshToken: "rt1" });
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toMatchObject({ grant_type: "refresh_token", refresh_token: "rt1" });
  });

  it("a refused refresh means reconnect", async () => {
    const f = vi.fn(async () => json(401, { error: "invalid_grant" }));
    await expect(refreshLawPayToken({ creds, refreshToken: "rt", fetchImpl: f })).rejects.toMatchObject({ code: "reauth" });
  });
});

describe("gateway credentials", () => {
  const body = {
    merchant: { id: "m_12345678", name: "Hartwell IP" },
    test_accounts: [
      { name: "Operating", type: "MerchantAccount", currency: "USD", id: "acc_op", public_key: "pk_op", secret_key: "sk_op", trust_account: "false" },
      { name: "IOLTA", type: "MerchantAccount", currency: "USD", id: "acc_trust", public_key: "pk_tr", secret_key: "sk_tr", trust_account: true },
      { name: "Mystery", type: "MerchantAccount", id: "acc_q", secret_key: "sk_q", trust_account: "maybe" },
    ],
    live_accounts: [{ name: "Operating", type: "AchAccount", id: "acc_live", public_key: "pk_l", secret_key: "sk_l", trust_account: false }],
  };

  it("normalises the string trust flag, keeps secrets out of accounts, and drops unreadable ones", () => {
    const g = parseGatewayCredentials(body);
    expect(g.accounts.map((a) => [a.id, a.trust_account, a.mode])).toEqual([
      ["acc_op", false, "test"],
      ["acc_trust", true, "test"],
      ["acc_live", false, "live"],
    ]);
    expect(g.skipped).toBe(1);
    expect(JSON.stringify(g.accounts)).not.toContain("sk_");
    expect(g.secrets).toEqual({ "test:acc_op": "sk_op", "test:acc_trust": "sk_tr", "live:acc_live": "sk_l" });
    expect(g.merchantName).toBe("Hartwell IP");
  });

  it("readTrustFlag never guesses", () => {
    expect(readTrustFlag("true")).toBe(true);
    expect(readTrustFlag(false)).toBe(false);
    expect(readTrustFlag("False")).toBeNull();
    expect(readTrustFlag(0)).toBeNull();
    expect(readTrustFlag(undefined)).toBeNull();
  });

  it("uses the bearer token and maps 401 to reauth", async () => {
    const ok = vi.fn(async () => json(200, body));
    await fetchGatewayCredentials({ accessToken: "at", apiBase: "https://api.test", fetchImpl: ok });
    const [url, init] = ok.mock.calls[0] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("https://api.test/gateway-credentials");
    expect(init.headers.Authorization).toBe("Bearer at");
    const denied = vi.fn(async () => json(401, {}));
    await expect(fetchGatewayCredentials({ accessToken: "at", fetchImpl: denied })).rejects.toBeInstanceOf(LawPayOAuthError);
    await expect(fetchGatewayCredentials({ accessToken: "at", fetchImpl: denied })).rejects.toMatchObject({ code: "reauth" });
  });

  it("no usable accounts is an error, not an empty connection", async () => {
    const f = vi.fn(async () => json(200, { merchant: {}, test_accounts: [], live_accounts: [] }));
    await expect(fetchGatewayCredentials({ accessToken: "at", fetchImpl: f })).rejects.toMatchObject({ code: "no-accounts" });
  });
});

describe("deauthorize", () => {
  it("gets a tenant token, then DELETEs the merchant's authorization", async () => {
    const f = vi.fn(async (url: string) => (url.endsWith("/oauth/token") ? json(200, { access_token: "tenant" }) : new Response(null, { status: 200 })));
    expect(await deauthorizeLawPay({ creds, publicKey: "pk_op", apiBase: "https://api.test", fetchImpl: f })).toBe(true);
    const [tokenUrl, tokenInit] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(tokenUrl).toBe("https://api.test/oauth/token");
    expect(JSON.parse(String(tokenInit.body))).toMatchObject({ grant_type: "client_credentials", scope: "tenant" });
    const [delUrl, delInit] = f.mock.calls[1] as unknown as [string, RequestInit & { headers: Record<string, string> }];
    expect(delUrl).toBe("https://secure.affinipay.com/api/v1/merchants/pk_op/deauthorize_application");
    expect(delInit.method).toBe("DELETE");
    expect(delInit.headers.Authorization).toBe("Bearer tenant");
  });

  it("never throws; a failure is false", async () => {
    const f = vi.fn(async () => {
      throw new Error("down");
    });
    expect(await deauthorizeLawPay({ creds, publicKey: "pk", fetchImpl: f })).toBe(false);
  });
});
