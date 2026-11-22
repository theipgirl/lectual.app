import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { adobeAccessPoint, isAdobeAuthorizeUrl, isAdobeSigningUrl } from "@/lib/esign/host-rule";
import {
  ADOBE_STATE_COOKIE,
  adobeAuthorizeUrl,
  checkAdobeState,
  encodeAdobeStateCookie,
  exchangeAdobeCode,
  newAdobeState,
} from "@/lib/esign/adobe-oauth";
import { handleCallback, handleConnect } from "@/lib/esign/routes";
import { adobeSetupFrom, clientSigningOnFrom, type AdobeSetup } from "@/lib/esign/adobe-config";
import { openToken } from "@/lib/mailbox/crypto";
import { readAgreementStatus } from "@/lib/esign/adobe-client";
import { esignDb, fakeAdobe, json, type Row } from "./esign-db";

const ROOT = randomBytes(32);
const CREDS = { clientId: "lectual-client-id", clientSecret: "LECTUAL-CLIENT-SECRET" };
const SETUP: AdobeSetup = { ready: true, creds: CREDS, root: ROOT, authorizeUrl: "https://secure.adobesign.com/public/oauth/v2" };

describe("AT5: the host rule", () => {
  it("AT5: accepts an Adobe access point and refuses evil.com, adobesign.com.evil.com, http, a path and userinfo", () => {
    expect(adobeAccessPoint("https://api.na1.adobesign.com/")).toBe("https://api.na1.adobesign.com");
    expect(adobeAccessPoint("https://api.eu1.echosign.com")).toBe("https://api.eu1.echosign.com");
    for (const bad of [
      "https://evil.com/",
      "https://adobesign.com.evil.com/",
      "http://api.na1.adobesign.com/",
      "https://api.na1.adobesign.com/api/rest",
      "https://user:pass@api.na1.adobesign.com/",
      "https://attacker@api.na1.adobesign.com/",
      "https://adobesign.com/",
      "https://api.na1.adobesign.com:8443/",
      "https://api.na1.adobesign.com/?x=1",
      "",
      null,
    ]) {
      expect(adobeAccessPoint(bad), String(bad)).toBeNull();
    }
  });

  it("AT5: a token is never sent to a refused host (no request at all)", async () => {
    const adobe = fakeAdobe({});
    await expect(readAgreementStatus(adobe.fetchImpl, { accessPoint: "https://adobesign.com.evil.com/", accessToken: "TOKEN" }, "agr-1")).rejects.toThrow();
    expect(adobe.calls).toHaveLength(0);
  });

  it("AT5: in the callback, a bad api_access_point means no token POST (no client_secret sent)", async () => {
    const adobe = fakeAdobe({ "POST /oauth/v2/token": () => json({ access_token: "a", refresh_token: "r", api_access_point: "https://evil.com/" }) });
    for (const ap of ["https://evil.com/", "https://adobesign.com.evil.com/", "http://api.na1.adobesign.com/", null]) {
      await expect(exchangeAdobeCode({ creds: CREDS, code: "c", redirectUri: "https://app.example.com/api/esign/callback/", accessPoint: ap, fetchImpl: adobe.fetchImpl })).rejects.toMatchObject({ code: "host-refused" });
    }
    expect(adobe.calls).toHaveLength(0);
  });

  it("AT5: a token answer naming a different api_access_point (or a bad web_access_point) is refused", async () => {
    for (const body of [
      { access_token: "a", refresh_token: "r", api_access_point: "https://api.eu1.adobesign.com/" },
      { access_token: "a", refresh_token: "r", api_access_point: "https://api.na1.adobesign.com/", web_access_point: "https://evil.com/" },
    ]) {
      const adobe = fakeAdobe({ "POST /oauth/v2/token": () => json(body) });
      await expect(exchangeAdobeCode({ creds: CREDS, code: "c", redirectUri: "r", accessPoint: "https://api.na1.adobesign.com/", fetchImpl: adobe.fetchImpl })).rejects.toMatchObject({ code: "host-refused" });
      expect(adobe.calls).toHaveLength(1);
      expect(adobe.calls[0].url).toBe("https://api.na1.adobesign.com/oauth/v2/token");
    }
  });

  it("AT5: the esignUrl rule: https on an Adobe host only", () => {
    expect(isAdobeSigningUrl("https://secure.na1.adobesign.com/public/apiesign?pid=x")).toBe(true);
    expect(isAdobeSigningUrl("http://secure.na1.adobesign.com/public/apiesign")).toBe(false);
    expect(isAdobeSigningUrl("https://secure.na1.adobesign.com.evil.com/x")).toBe(false);
    expect(isAdobeSigningUrl("https://u:p@secure.na1.adobesign.com/x")).toBe(false);
  });
});

describe("AT6: env and switch", () => {
  it("AT6: client id or secret unset, or a bad ADOBE_SIGN_AUTHORIZE_URL, is not set up", () => {
    expect(adobeSetupFrom({}, ROOT).ready).toBe(false);
    expect(adobeSetupFrom({ ADOBE_SIGN_OAUTH_CLIENT_ID: "x" }, ROOT).ready).toBe(false);
    expect(adobeSetupFrom({ ADOBE_SIGN_OAUTH_CLIENT_SECRET: "x" }, ROOT).ready).toBe(false);
    const both = { ADOBE_SIGN_OAUTH_CLIENT_ID: "x", ADOBE_SIGN_OAUTH_CLIENT_SECRET: "y" };
    expect(adobeSetupFrom(both, ROOT).ready).toBe(true);
    for (const bad of ["http://secure.adobesign.com/public/oauth/v2", "https://evil.com/oauth", "https://adobesign.com.evil.com/x", "https://secure.echosign.com/x"]) {
      expect(adobeSetupFrom({ ...both, ADOBE_SIGN_AUTHORIZE_URL: bad }, ROOT), bad).toEqual({ ready: false, missing: "authorize-url" });
    }
    expect(isAdobeAuthorizeUrl("https://secure.na1.adobesign.com/public/oauth/v2")).toBe(true);
    expect(adobeSetupFrom(both, null)).toEqual({ ready: false, missing: "encryption-key" });
  });

  it("AT6: only the exact value \"on\" switches the client path on", () => {
    expect(clientSigningOnFrom({})).toBe(false);
    for (const v of ["", "off", "ON", "On", "true", "1", " on", "on "]) expect(clientSigningOnFrom({ ADOBE_SIGN_CLIENT_SIGNING: v }), v).toBe(false);
    expect(clientSigningOnFrom({ ADOBE_SIGN_CLIENT_SIGNING: "on" })).toBe(true);
  });

  it("AT6 / AT20: no deployment-wide Adobe token or key variable exists", () => {
    const env = readFileSync("src/lib/env.ts", "utf8");
    const names = env.match(/ADOBE_SIGN_[A-Z_]+/g) ?? [];
    expect([...new Set(names)].sort()).toEqual(["ADOBE_SIGN_AUTHORIZE_URL", "ADOBE_SIGN_CLIENT_SIGNING", "ADOBE_SIGN_OAUTH_CLIENT_ID", "ADOBE_SIGN_OAUTH_CLIENT_SECRET", "ADOBE_SIGN_OAUTH_REDIRECT_URI"]);
  });
});

/* ───────────────────────── AT7: OAuth ───────────────────────── */

type Role = "owner" | "admin" | "senior_admin" | "paralegal" | "viewer";
function session(role: Role, userId = "user-1", orgId = "org-1") {
  return async () =>
    ({ kind: "ok", user: { id: userId }, member: { role, org_id: orgId }, org: { id: orgId, name: "F", slug: "f", modules: [] }, role, isPlatformAdmin: false, actingAsStaff: false, switchableFirms: [], displayName: "X" }) as never;
}
const reqFor = (url: string, cookie?: string) => new NextRequest(url, cookie ? { headers: { cookie: `${ADOBE_STATE_COOKIE}=${cookie}` } } : undefined);

function adobeServer() {
  return fakeAdobe({
    "POST /oauth/v2/token": () => json({ access_token: "ACCESS-1", refresh_token: "REFRESH-1", expires_in: 3600, api_access_point: "https://api.na1.adobesign.com/", web_access_point: "https://secure.na1.adobesign.com/" }),
    "GET /users/me": () => json({ email: "firm@example.com" }),
  });
}

describe("AT7: OAuth", () => {
  it("AT7: a non-admin is refused in /api/esign/connect/ and /api/esign/callback/ even with the page bypassed", async () => {
    for (const role of ["paralegal", "viewer"] as const) {
      const c = await handleConnect(reqFor("https://app.example.com/api/esign/connect/"), { session: session(role), setup: () => SETUP, origin: async () => "https://app.example.com" });
      expect(c.headers.get("location")).toContain("esign_error=forbidden");
      const adobe = adobeServer();
      const st = newAdobeState({ orgId: "org-1", userId: "user-1" });
      const cb = await handleCallback(reqFor(`https://app.example.com/api/esign/callback/?code=c&state=${st.nonce}&api_access_point=https://api.na1.adobesign.com/`, encodeAdobeStateCookie(ROOT, st)), {
        session: session(role),
        setup: () => SETUP,
        origin: async () => "https://app.example.com",
        fetchImpl: adobe.fetchImpl,
        db: async () => esignDb({}).db,
      });
      expect(cb.headers.get("location")).toContain("esign_error=forbidden");
      expect(adobe.calls).toHaveLength(0);
    }
  });

  it("AT7: connect sends no code_challenge and sets a signed state cookie", async () => {
    const r = await handleConnect(reqFor("https://app.example.com/api/esign/connect/"), { session: session("admin"), setup: () => SETUP, origin: async () => "https://app.example.com" });
    const loc = new URL(r.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe("https://secure.adobesign.com/public/oauth/v2");
    expect(loc.searchParams.has("code_challenge")).toBe(false);
    expect(loc.searchParams.get("scope")).toBe("user_read:self agreement_read:self agreement_write:self webhook_write:self");
    expect(r.cookies.get(ADOBE_STATE_COOKIE)?.value).toMatch(/\./);
    expect(adobeAuthorizeUrl({ clientId: "x", redirectUri: "y", nonce: "z" })).not.toContain("code_challenge");
  });

  it("AT7: a bad, expired, other-user or other-firm state is refused", () => {
    const st = newAdobeState({ orgId: "org-1", userId: "user-1" }, 1_000_000);
    const cookie = encodeAdobeStateCookie(ROOT, st);
    const sess = { userId: "user-1", orgId: "org-1" };
    expect(checkAdobeState(ROOT, { cookie, stateParam: st.nonce, session: sess, now: 1_000_001 }).ok).toBe(true);
    expect(checkAdobeState(ROOT, { cookie: `${cookie}x`, stateParam: st.nonce, session: sess, now: 1_000_001 })).toEqual({ ok: false, reason: "forged" });
    expect(checkAdobeState(ROOT, { cookie, stateParam: "other", session: sess, now: 1_000_001 })).toEqual({ ok: false, reason: "mismatch" });
    expect(checkAdobeState(ROOT, { cookie, stateParam: st.nonce, session: sess, now: 1_000_000 + 11 * 60 * 1000 })).toEqual({ ok: false, reason: "expired" });
    expect(checkAdobeState(ROOT, { cookie, stateParam: st.nonce, session: { ...sess, userId: "user-2" }, now: 1_000_001 })).toEqual({ ok: false, reason: "wrong-session" });
    expect(checkAdobeState(ROOT, { cookie, stateParam: st.nonce, session: { ...sess, orgId: "org-2" }, now: 1_000_001 })).toEqual({ ok: false, reason: "wrong-session" });
    expect(checkAdobeState(randomBytes(32), { cookie, stateParam: st.nonce, session: sess, now: 1_000_001 })).toEqual({ ok: false, reason: "forged" });
    // A LawPay- or mailbox-context signature never opens an Adobe state.
    expect(checkAdobeState(ROOT, { cookie: undefined, stateParam: st.nonce, session: sess })).toEqual({ ok: false, reason: "missing" });
  });

  it("AT7: the callback seals both tokens under lectual-adobe-sign and its scoped insert never names an _enc column in a select", async () => {
    const adobe = adobeServer();
    const w = esignDb({ adobe_sign_connection: [] });
    const st = newAdobeState({ orgId: "org-1", userId: "user-1" });
    const r = await handleCallback(reqFor(`https://app.example.com/api/esign/callback/?code=c&state=${st.nonce}&api_access_point=https://api.na1.adobesign.com/`, encodeAdobeStateCookie(ROOT, st)), {
      session: session("admin"),
      setup: () => SETUP,
      origin: async () => "https://app.example.com",
      fetchImpl: adobe.fetchImpl,
      db: async () => w.db,
    });
    expect(r.headers.get("location")).toContain("esign=connected");
    const row = (w.tables.adobe_sign_connection as Row[])[0];
    expect(row.org_id).toBe("org-1");
    expect(openToken(ROOT, row.access_token_enc as string, "lectual-adobe-sign")).toBe("ACCESS-1");
    expect(openToken(ROOT, row.refresh_token_enc as string, "lectual-adobe-sign")).toBe("REFRESH-1");
    expect(() => openToken(ROOT, row.access_token_enc as string, "lectual-lawpay")).toThrow();
    expect(row.account_email).toBe("firm@example.com");
    expect(row).not.toHaveProperty("connected_by");
    for (const c of w.calls) expect(c.columns ?? "", c.op).not.toMatch(/_enc/);
    // The token POST carried the client secret only to the checked host.
    const tokenCall = adobe.calls.find((c) => c.url.endsWith("/oauth/v2/token"))!;
    expect(tokenCall.url).toBe("https://api.na1.adobesign.com/oauth/v2/token");
    expect(String(tokenCall.body)).toContain("client_secret=LECTUAL-CLIENT-SECRET");
    expect(String(tokenCall.body)).not.toContain("code_verifier");
  });

  it("AT7 / AT5: a callback whose redirect names a bad host stores nothing and sends nothing", async () => {
    const adobe = adobeServer();
    const w = esignDb({ adobe_sign_connection: [] });
    const st = newAdobeState({ orgId: "org-1", userId: "user-1" });
    const r = await handleCallback(reqFor(`https://app.example.com/api/esign/callback/?code=c&state=${st.nonce}&api_access_point=https://evil.com/`, encodeAdobeStateCookie(ROOT, st)), {
      session: session("owner"),
      setup: () => SETUP,
      origin: async () => "https://app.example.com",
      fetchImpl: adobe.fetchImpl,
      db: async () => w.db,
    });
    expect(r.headers.get("location")).toContain("esign_error=host");
    expect(adobe.calls).toHaveLength(0);
    expect(w.tables.adobe_sign_connection).toHaveLength(0);
  });
});
