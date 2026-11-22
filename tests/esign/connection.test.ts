import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { loadAdobeAccess, readAdobeConnection, countWaitingClients } from "@/lib/esign/adobe-connection";
import { inAppBlockedByOpenRequest } from "@/lib/esign/path";
import { openToken, sealToken } from "@/lib/mailbox/crypto";
import { esignDb, fakeAdobe, json, type Row } from "./esign-db";

const ROOT = randomBytes(32);
const CREDS = { clientId: "id", clientSecret: "SECRET" };
const NOW = new Date("2026-10-20T15:00:00.000Z");

function conn(over: Row = {}): Row {
  return {
    id: "conn-1",
    org_id: "org-1",
    status: "active",
    api_access_point: "https://api.na1.adobesign.com/",
    access_token_enc: sealToken(ROOT, "OLD-ACCESS", "lectual-adobe-sign"),
    refresh_token_enc: sealToken(ROOT, "REFRESH", "lectual-adobe-sign"),
    access_expires_at: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
    ...over,
  };
}

describe("the firm's Adobe access (service role, fenced on the row's org)", () => {
  it("a token with an hour left is used as it is, with no Adobe call", async () => {
    const w = esignDb({ adobe_sign_connection: [conn()] });
    const adobe = fakeAdobe({});
    const r = await loadAdobeAccess({ db: w.db, orgId: "org-1", root: ROOT, creds: CREDS, fetchImpl: adobe.fetchImpl, now: NOW });
    expect(r).toMatchObject({ kind: "ok", accessToken: "OLD-ACCESS", accessPoint: "https://api.na1.adobesign.com" });
    expect(adobe.calls).toHaveLength(0);
    expect(w.calls[0].filters).toContainEqual(["eq", "org_id", "org-1"]);
  });

  it("under 5 minutes left → refresh at the firm's access point; the refresh token does not rotate", async () => {
    const w = esignDb({ adobe_sign_connection: [conn({ access_expires_at: new Date(NOW.getTime() + 4 * 60 * 1000).toISOString() })] });
    const adobe = fakeAdobe({ "POST /oauth/v2/refresh": () => json({ access_token: "NEW-ACCESS", expires_in: 3600 }) });
    const r = await loadAdobeAccess({ db: w.db, orgId: "org-1", root: ROOT, creds: CREDS, fetchImpl: adobe.fetchImpl, now: NOW });
    expect(r).toMatchObject({ kind: "ok", accessToken: "NEW-ACCESS", refreshToken: "REFRESH" });
    expect(adobe.calls[0].url).toBe("https://api.na1.adobesign.com/oauth/v2/refresh");
    const row = (w.tables.adobe_sign_connection as Row[])[0];
    expect(openToken(ROOT, row.access_token_enc as string, "lectual-adobe-sign")).toBe("NEW-ACCESS");
    expect(openToken(ROOT, row.refresh_token_enc as string, "lectual-adobe-sign")).toBe("REFRESH");
  });

  it("AT8: invalid_grant (or a 401) on refresh sets reauth", async () => {
    for (const res of [() => json({ error: "invalid_grant" }, 400), () => json({}, 401)]) {
      const w = esignDb({ adobe_sign_connection: [conn({ access_expires_at: null })] });
      const adobe = fakeAdobe({ "POST /oauth/v2/refresh": res });
      expect(await loadAdobeAccess({ db: w.db, orgId: "org-1", root: ROOT, creds: CREDS, fetchImpl: adobe.fetchImpl, now: NOW })).toEqual({ kind: "reauth" });
      expect((w.tables.adobe_sign_connection as Row[])[0].status).toBe("reauth");
    }
  });

  it("a 5xx on refresh is unavailable and does NOT pause the firm", async () => {
    const w = esignDb({ adobe_sign_connection: [conn({ access_expires_at: null })] });
    const adobe = fakeAdobe({ "POST /oauth/v2/refresh": () => json({}, 503) });
    expect(await loadAdobeAccess({ db: w.db, orgId: "org-1", root: ROOT, creds: CREDS, fetchImpl: adobe.fetchImpl, now: NOW })).toEqual({ kind: "unavailable" });
    expect((w.tables.adobe_sign_connection as Row[])[0].status).toBe("active");
  });

  it("AT5: a stored access point that breaks the host rule is never used (no call, no token sent)", async () => {
    const w = esignDb({ adobe_sign_connection: [conn({ api_access_point: "https://adobesign.com.evil.com/", access_expires_at: null })] });
    const adobe = fakeAdobe({});
    expect((await loadAdobeAccess({ db: w.db, orgId: "org-1", root: ROOT, creds: CREDS, fetchImpl: adobe.fetchImpl, now: NOW })).kind).toBe("unavailable");
    expect(adobe.calls).toHaveLength(0);
  });

  it("another firm's row is never returned; reauth and revoked are not access", async () => {
    const w = esignDb({ adobe_sign_connection: [conn({ org_id: "org-2" })] });
    expect(await loadAdobeAccess({ db: w.db, orgId: "org-1", root: ROOT, creds: CREDS, now: NOW })).toEqual({ kind: "none" });
    expect(await loadAdobeAccess({ db: esignDb({ adobe_sign_connection: [conn({ status: "reauth" })] }).db, orgId: "org-1", root: ROOT, creds: CREDS, now: NOW })).toEqual({ kind: "reauth" });
    expect(await loadAdobeAccess({ db: esignDb({ adobe_sign_connection: [conn({ status: "revoked" })] }).db, orgId: "org-1", root: ROOT, creds: CREDS, now: NOW })).toEqual({ kind: "none" });
  });

  it("three-state reads: a missing 0113 table is not-set-up, a failed read is unavailable", async () => {
    expect(await readAdobeConnection(esignDb({}, { failOn: { adobe_sign_connection: { code: "42P01" } } }).db)).toEqual({ state: "not-set-up" });
    expect(await readAdobeConnection(esignDb({}, { failOn: { adobe_sign_connection: { code: "PGRST205" } } }).db)).toEqual({ state: "not-set-up" });
    expect(await readAdobeConnection(esignDb({}, { failOn: { adobe_sign_connection: { code: "57014" } } }).db)).toEqual({ state: "unavailable" });
    expect(await readAdobeConnection(esignDb({ adobe_sign_connection: [] }).db)).toEqual({ state: "ok", connection: null });
    expect(await loadAdobeAccess({ db: esignDb({}, { failOn: { adobe_sign_connection: { code: "42P01" } } }).db, orgId: "org-1", root: ROOT, creds: CREDS })).toEqual({ kind: "not-set-up" });
  });

  it("AT12: the waiting count reads granted columns only; a failed count is null, never 0", async () => {
    const w = esignDb({ client_proposal_esign_request: [{ id: "a", status: "out_for_signature" }, { id: "b", status: "out_for_signature" }, { id: "c", status: "completed" }] });
    expect(await countWaitingClients(w.db)).toBe(2);
    expect(w.calls[0].columns).toBe("id");
    expect(await countWaitingClients(esignDb({}, { failOn: { client_proposal_esign_request: { code: "57014" } } }).db)).toBeNull();
  });
});

describe("AT10: the in-app action is refused while a request is open (page check; the database refuses too)", () => {
  it("AT10: an open request refuses; none, a missing table, or a failed read leave it to the database", async () => {
    const ref = { proposalId: "prop-2", orgId: "org-1" };
    expect(await inAppBlockedByOpenRequest(ref, esignDb({ client_proposal_esign_request: [{ id: "r", proposal_id: "prop-2", org_id: "org-1", status: "out_for_signature" }] }).db)).toBe(true);
    expect(await inAppBlockedByOpenRequest(ref, esignDb({ client_proposal_esign_request: [{ id: "r", proposal_id: "prop-2", org_id: "org-1", status: "failed" }] }).db)).toBe(false);
    expect(await inAppBlockedByOpenRequest(ref, esignDb({ client_proposal_esign_request: [{ id: "r", proposal_id: "prop-2", org_id: "org-9", status: "creating" }] }).db)).toBe(false);
    expect(await inAppBlockedByOpenRequest(ref, esignDb({}, { failOn: { client_proposal_esign_request: { code: "42P01" } } }).db)).toBe(false);
  });
});
