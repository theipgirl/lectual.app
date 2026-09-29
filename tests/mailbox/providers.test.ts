import { describe, it, expect, vi } from "vitest";
import {
  ProviderError,
  authorizeUrl,
  exchangeCode,
  fetchAccountEmail,
  missingScopes,
  redirectUri,
  revokeToken,
} from "@/lib/mailbox/providers";
import { pkceChallenge } from "@/lib/mailbox/state";

const creds = { clientId: "client-id", clientSecret: "client-secret" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("authorize URLs", () => {
  it("Google: offline access, forced consent, PKCE S256, read + compose only", () => {
    const url = new URL(
      authorizeUrl({ provider: "google", clientId: "cid", redirectUri: "https://x/cb/", nonce: "n1", verifier: "v".repeat(43) }),
    );
    const p = url.searchParams;
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("state")).toBe("n1");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toBe(pkceChallenge("v".repeat(43)));
    const scopes = p.get("scope")!.split(" ");
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.compose");
    // Never the send, modify or full-mailbox scopes.
    expect(scopes.some((s) => /gmail\.(send|modify)$|mail\.google\.com/.test(s))).toBe(false);
  });

  it("Microsoft: common tenant, offline_access, Mail.Read + Mail.ReadWrite, no Mail.Send", () => {
    const url = new URL(
      authorizeUrl({ provider: "microsoft", clientId: "cid", redirectUri: "https://x/cb/", nonce: "n2", verifier: "v".repeat(43) }),
    );
    expect(url.pathname).toBe("/common/oauth2/v2.0/authorize");
    const scopes = url.searchParams.get("scope")!.split(" ");
    expect(scopes).toEqual(expect.arrayContaining(["offline_access", "Mail.Read", "Mail.ReadWrite"]));
    expect(scopes).not.toContain("Mail.Send");
  });

  it("builds the callback URI with the trailing slash the app routes use", () => {
    expect(redirectUri("https://app.example.com", "google")).toBe("https://app.example.com/api/mailbox/callback/google/");
  });
});

describe("code exchange", () => {
  const args = { creds, code: "c", verifier: "v", redirectUri: "https://x/cb/", now: 0 };

  it("returns tokens with an absolute expiry", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        access_token: "at",
        refresh_token: "rt",
        expires_in: 3600,
        scope: "openid https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose",
      }),
    );
    const t = await exchangeCode({ ...args, provider: "google", fetchImpl });
    expect(t).toMatchObject({ accessToken: "at", refreshToken: "rt", expiresAt: new Date(3_600_000).toISOString() });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = new URLSearchParams(init.body as URLSearchParams);
    expect(body.get("code_verifier")).toBe("v");
    expect(body.get("grant_type")).toBe("authorization_code");
  });

  it("refuses a grant where the person unticked a mail permission", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: "at", refresh_token: "rt", scope: "openid https://www.googleapis.com/auth/gmail.readonly" }),
    );
    await expect(exchangeCode({ ...args, provider: "google", fetchImpl })).rejects.toMatchObject({ code: "missing-permission" });
  });

  it("refuses a grant with no refresh token (background sync would be impossible)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: "at", scope: "Mail.Read Mail.ReadWrite" }),
    );
    await expect(exchangeCode({ ...args, provider: "microsoft", fetchImpl })).rejects.toMatchObject({ code: "no-refresh-token" });
  });

  it("accepts Graph's URL-prefixed scope names", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        access_token: "at",
        refresh_token: "rt",
        scope: "https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/User.Read",
      }),
    );
    await expect(exchangeCode({ ...args, provider: "microsoft", fetchImpl })).resolves.toMatchObject({ refreshToken: "rt" });
  });

  it("surfaces the provider's error without echoing secrets", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: "invalid_grant", error_description: "Code expired" }, 400));
    const err = await exchangeCode({ ...args, provider: "google", fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.message).toBe("Code expired");
    expect(err.message).not.toContain("client-secret");
  });

  it("missingScopes lists exactly what is absent", () => {
    expect(missingScopes("microsoft", ["Mail.Read"])).toEqual(["mail.readwrite"]);
    expect(missingScopes("microsoft", ["mail.read", "MAIL.READWRITE"])).toEqual([]);
  });
});

describe("account email", () => {
  it("Google: uses the verified email, lower-cased", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ email: "Intake@Firm.com", email_verified: true }));
    await expect(fetchAccountEmail({ provider: "google", accessToken: "at", fetchImpl })).resolves.toBe("intake@firm.com");
  });

  it("Google: refuses an unverified email", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ email: "x@y.com", email_verified: false }));
    await expect(fetchAccountEmail({ provider: "google", accessToken: "at", fetchImpl })).rejects.toMatchObject({ code: "no-email" });
  });

  it("Microsoft: falls back to userPrincipalName when mail is null", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ mail: null, userPrincipalName: "Rebecca@Firm.onmicrosoft.com" }));
    await expect(fetchAccountEmail({ provider: "microsoft", accessToken: "at", fetchImpl })).resolves.toBe("rebecca@firm.onmicrosoft.com");
  });
});

describe("revocation", () => {
  it("revokes at Google and is a no-op for Microsoft", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    await expect(revokeToken({ provider: "google", token: "rt", fetchImpl })).resolves.toBe(true);
    await expect(revokeToken({ provider: "microsoft", token: "rt", fetchImpl })).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
