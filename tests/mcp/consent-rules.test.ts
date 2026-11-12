import { describe, expect, it } from "vitest";
import {
  type ConsentFacts,
  consentPath,
  consentSignInPath,
  decideConsent,
  needsDetails,
  parseAuthorizationId,
  readDetails,
  sameOriginPost,
} from "@/lib/mcp/consent-rules";
import { DEFAULT_MCP_REDIRECTS, parseAllowedRedirects, redirectUriAllowed, redirectUrlAllowed } from "@/lib/mcp/redirects";
import { safeNext } from "@/lib/auth/safe-next";

const ID = "abcDEF123_-xyz";
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";
const ok = { kind: "ok" as const, userId: "u1", firmName: "Hartwell IP", you: "Ada Lovelace" };
const ask = { kind: "ask" as const, authorizationId: ID, redirectUri: CLAUDE, userId: "u1" };
const base: ConsentFacts = { authorizationId: ID, session: ok, moduleOn: true, details: ask, allowedRedirects: DEFAULT_MCP_REDIRECTS };

describe("the redirect allow-list", () => {
  it("defaults to Claude's two callbacks", () => {
    expect(parseAllowedRedirects(undefined)).toEqual(["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]);
    expect(parseAllowedRedirects("  ")).toEqual([...DEFAULT_MCP_REDIRECTS]);
  });

  it("keeps exact https URLs and drops anything else, never falling back to the defaults", () => {
    expect(parseAllowedRedirects(" https://a.example/cb , http://b.example/cb, https://c.example/cb?x=1, nonsense ")).toEqual(["https://a.example/cb"]);
    expect(parseAllowedRedirects("http://only-http.example/cb")).toEqual([]);
  });

  it("compares a redirect URI exactly", () => {
    expect(redirectUriAllowed(CLAUDE, DEFAULT_MCP_REDIRECTS)).toBe(true);
    expect(redirectUriAllowed(`${CLAUDE}/`, DEFAULT_MCP_REDIRECTS)).toBe(false);
    expect(redirectUriAllowed("https://claude.ai.evil.example/api/mcp/auth_callback", DEFAULT_MCP_REDIRECTS)).toBe(false);
    expect(redirectUriAllowed(null, DEFAULT_MCP_REDIRECTS)).toBe(false);
  });

  it("holds a complete redirect URL to the same list, query aside", () => {
    expect(redirectUrlAllowed(`${CLAUDE}?code=x&state=y`, DEFAULT_MCP_REDIRECTS)).toBe(true);
    expect(redirectUrlAllowed("https://evil.example/api/mcp/auth_callback?code=x", DEFAULT_MCP_REDIRECTS)).toBe(false);
    expect(redirectUrlAllowed("https://user:pw@claude.ai/api/mcp/auth_callback?code=x", DEFAULT_MCP_REDIRECTS)).toBe(false);
    expect(redirectUrlAllowed("not a url", DEFAULT_MCP_REDIRECTS)).toBe(false);
  });
});

describe("decideConsent", () => {
  it("asks when everything holds", () => {
    expect(decideConsent(base)).toEqual({ kind: "ask", authorizationId: ID, firmName: "Hartwell IP", you: "Ada Lovelace" });
  });

  it("refuses a missing or malformed request id", () => {
    expect(decideConsent({ ...base, authorizationId: null })).toEqual({ kind: "refuse", reason: "missing" });
    expect(parseAuthorizationId("../../admin")).toBeNull();
    expect(parseAuthorizationId("a b c d e f g h")).toBeNull();
    expect(parseAuthorizationId(["x"])).toBeNull();
    expect(parseAuthorizationId(ID)).toBe(ID);
  });

  it("signed out goes to sign-in, carrying the consent path", () => {
    expect(decideConsent({ ...base, session: { kind: "signed-out" }, moduleOn: false, details: null })).toEqual({
      kind: "sign-in",
      to: `/sign-in/?next=${encodeURIComponent(`/oauth/consent/?authorization_id=${ID}`)}`,
    });
  });

  it("refuses no firm and a firm without the connector, with the same neutral reason", () => {
    expect(decideConsent({ ...base, session: { kind: "no-access" } })).toEqual({ kind: "refuse", reason: "not-available" });
    expect(decideConsent({ ...base, moduleOn: false })).toEqual({ kind: "refuse", reason: "not-available" });
  });

  it("refuses a client whose redirect URI is not Claude's", () => {
    expect(decideConsent({ ...base, details: { ...ask, redirectUri: "https://evil.example/cb" } })).toEqual({ kind: "refuse", reason: "app-not-allowed" });
  });

  it("refuses a Supabase error, an unread request, and a request for someone else", () => {
    expect(decideConsent({ ...base, details: { kind: "error" } })).toEqual({ kind: "refuse", reason: "expired" });
    expect(decideConsent({ ...base, details: null })).toEqual({ kind: "refuse", reason: "expired" });
    expect(decideConsent({ ...base, details: { ...ask, userId: "u2" } })).toEqual({ kind: "refuse", reason: "expired" });
  });

  it("already consented: redirects only to an allowed URL, after the same firm and switch checks", () => {
    const consented = { kind: "consented" as const, redirectUrl: `${CLAUDE}?code=c&state=s` };
    expect(decideConsent({ ...base, details: consented })).toEqual({ kind: "redirect", url: `${CLAUDE}?code=c&state=s` });
    expect(decideConsent({ ...base, details: { kind: "consented", redirectUrl: "https://evil.example/cb?code=c" } })).toEqual({ kind: "refuse", reason: "app-not-allowed" });
    expect(decideConsent({ ...base, moduleOn: false, details: consented })).toEqual({ kind: "refuse", reason: "not-available" });
  });

  it("asks Supabase only once everything before it passed", () => {
    expect(needsDetails({ authorizationId: ID, session: ok, moduleOn: true, allowedRedirects: [] })).toBe(true);
    expect(needsDetails({ authorizationId: ID, session: ok, moduleOn: false, allowedRedirects: [] })).toBe(false);
    expect(needsDetails({ authorizationId: ID, session: { kind: "signed-out" }, moduleOn: true, allowedRedirects: [] })).toBe(false);
  });
});

describe("readDetails", () => {
  it("reduces Supabase's two answers and treats anything else as an error", () => {
    expect(readDetails({ authorization_id: ID, redirect_uri: CLAUDE, user: { id: "u1", email: "a@b" }, client: {}, scope: "" }, null)).toEqual(ask);
    expect(readDetails({ redirect_url: `${CLAUDE}?code=1` }, null)).toEqual({ kind: "consented", redirectUrl: `${CLAUDE}?code=1` });
    expect(readDetails(null, { message: "nope" })).toEqual({ kind: "error" });
    expect(readDetails({ authorization_id: ID }, null)).toEqual({ kind: "error" });
    expect(readDetails({ something: 1 }, null)).toEqual({ kind: "error" });
  });
});

describe("sign-in round trip (safeNext is not loosened)", () => {
  it("safeNext keeps the consent path with its request id exactly", () => {
    expect(safeNext(consentPath(ID))).toBe(`/oauth/consent/?authorization_id=${ID}`);
    const next = new URL(consentSignInPath(ID), "https://x.invalid").searchParams.get("next");
    expect(safeNext(next)).toBe(consentPath(ID));
  });

  it("still refuses off-site destinations dressed as a consent path", () => {
    expect(safeNext("//evil.example/oauth/consent/?authorization_id=x")).toBe("/dashboard/");
    expect(safeNext("https://evil.example/oauth/consent/")).toBe("/dashboard/");
    expect(safeNext("/\\evil.example/oauth/consent/")).toBe("/dashboard/");
  });
});

describe("sameOriginPost", () => {
  it("needs an Origin naming this host", () => {
    expect(sameOriginPost("https://app.lectual.app", "app.lectual.app")).toBe(true);
    expect(sameOriginPost("https://evil.example", "app.lectual.app")).toBe(false);
    expect(sameOriginPost(null, "app.lectual.app")).toBe(false);
    expect(sameOriginPost("null", "app.lectual.app")).toBe(false);
  });
});
