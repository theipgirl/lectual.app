import { describe, it, expect, vi } from "vitest";
import {
  ProviderError,
  authorizeUrl,
  exchangeCode,
  fetchAccountEmail,
  hasCalendarScope,
  missingScopes,
  redirectUri,
  refreshAccessToken,
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

describe("Calendars.Read (Sprint 15)", () => {
  const authScopes = (provider: "google" | "microsoft") =>
    new URL(authorizeUrl({ provider, clientId: "cid", redirectUri: "https://x/cb/", nonce: "n", verifier: "v".repeat(43) })).searchParams
      .get("scope")!
      .split(" ");

  it("F10: the Microsoft authorize URL asks for Calendars.Read and still never Mail.Send; Google has no calendar scope", () => {
    const ms = authScopes("microsoft");
    expect(ms).toContain("Calendars.Read");
    expect(ms).not.toContain("Mail.Send");
    expect(ms.some((s) => /calendars\.readwrite/i.test(s))).toBe(false);
    expect(authScopes("google").some((s) => /calendar/i.test(s))).toBe(false);
  });

  it("F10: a Microsoft exchange that returns only the mail scopes still connects (the calendar is not required)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "openid email Mail.Read Mail.ReadWrite User.Read" }),
    );
    const t = await exchangeCode({ provider: "microsoft", creds, code: "c", verifier: "v", redirectUri: "https://x/cb/", fetchImpl, now: 0 });
    expect(t.grantedScopes).not.toContain("Calendars.Read");
    expect(missingScopes("microsoft", t.grantedScopes)).toEqual([]);
  });

  it("hasCalendarScope: Microsoft only, case-insensitive, with or without Graph's URL prefix", () => {
    expect(hasCalendarScope("microsoft", ["Mail.Read", "Calendars.Read"])).toBe(true);
    expect(hasCalendarScope("microsoft", ["https://graph.microsoft.com/Calendars.Read"])).toBe(true);
    expect(hasCalendarScope("microsoft", ["calendars.READ"])).toBe(true);
    expect(hasCalendarScope("microsoft", ["Mail.Read", "Mail.ReadWrite"])).toBe(false);
    expect(hasCalendarScope("microsoft", ["Calendars.ReadWrite"])).toBe(false);
    expect(hasCalendarScope("microsoft", [])).toBe(false);
    expect(hasCalendarScope("microsoft", null)).toBe(false);
    expect(hasCalendarScope("microsoft", undefined)).toBe(false);
    expect(hasCalendarScope("google", ["Calendars.Read"])).toBe(false);
  });

  describe("F9: refresh asks only for what was granted", () => {
    const refresh = async (grantedScopes: string[] | null | undefined) => {
      const fetchImpl = vi.fn(async () => jsonResponse({ access_token: "at2", refresh_token: "rt2", expires_in: 3600 }));
      const out = await refreshAccessToken({ provider: "microsoft", creds, refreshToken: "rt", grantedScopes, fetchImpl, now: 0 });
      const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      return { out, scope: new URLSearchParams(init.body as URLSearchParams).get("scope")!.split(" ") };
    };

    it("a mail-only connection's refresh does not request Calendars.Read, and still succeeds", async () => {
      const { out, scope } = await refresh(["Mail.Read", "Mail.ReadWrite", "offline_access"]);
      expect(scope).not.toContain("Calendars.Read");
      expect(scope).toEqual(expect.arrayContaining(["Mail.Read", "Mail.ReadWrite", "offline_access"]));
      expect(out).toMatchObject({ accessToken: "at2", refreshToken: "rt2" });
    });

    it("a connection that granted it asks for it", async () => {
      expect((await refresh(["Mail.Read", "https://graph.microsoft.com/Calendars.Read"])).scope).toContain("Calendars.Read");
    });

    it("an unknown scope list is read as not granted", async () => {
      expect((await refresh(null)).scope).not.toContain("Calendars.Read");
      expect((await refresh(undefined)).scope).not.toContain("Calendars.Read");
    });

    it("Google's refresh sends no scope parameter at all", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ access_token: "g2", expires_in: 3600 }));
      await refreshAccessToken({ provider: "google", creds, refreshToken: "rt", grantedScopes: [], fetchImpl, now: 0 });
      const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
      expect(new URLSearchParams(init.body as URLSearchParams).has("scope")).toBe(false);
    });
  });
});
