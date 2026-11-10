import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The send path under "Send from Outlook now": the scope flag (off by default, never required, refreshed only when
 * granted) and the draft check (read back first: still a draft, addressed to the recipient; only then the send).
 */

// providers.ts reads process.env directly (env.ts is server-only and providers.ts is reachable from client components).
function setSendFlag(v: string | undefined) {
  envState.MAILBOX_SEND_SCOPE = v;
  if (v === undefined) delete process.env.MAILBOX_SEND_SCOPE;
  else process.env.MAILBOX_SEND_SCOPE = v;
}
const envState = vi.hoisted(() => ({ MAILBOX_SEND_SCOPE: undefined as string | undefined }));
vi.mock("@/lib/env", () => ({ env: new Proxy({}, { get: (_t, k: string) => (envState as Record<string, unknown>)[k] }) }));

const { authorizeUrl, exchangeCode, refreshAccessToken, missingScopes, hasSendScope, sendScopeRequested } = await import("@/lib/mailbox/providers");
const { sendCheckedDraft, recipientsInclude, SEND_SCOPE } = await import("@/lib/mailbox/outlook-send");

const creds = { clientId: "cid", clientSecret: "secret" };
const scopesOf = (mailbox: "personal" | "firm" = "personal") =>
  new URL(authorizeUrl({ provider: "microsoft", clientId: "cid", redirectUri: "https://x/cb/", nonce: "n", verifier: "v".repeat(43), mailbox })).searchParams.get("scope")!.split(" ");
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  setSendFlag(undefined);
});

describe("the send permission is behind a flag", () => {
  it("is not asked for by default", () => {
    expect(sendScopeRequested()).toBe(false);
    expect(scopesOf()).not.toContain(SEND_SCOPE);
  });

  it("is asked for with MAILBOX_SEND_SCOPE=on, Microsoft only, and never required", async () => {
    setSendFlag("on");
    expect(scopesOf()).toContain(SEND_SCOPE);
    // A firm (shared) mailbox never sends, so it is never asked.
    expect(scopesOf("firm")).not.toContain(SEND_SCOPE);
    const google = new URL(authorizeUrl({ provider: "google", clientId: "cid", redirectUri: "https://x/cb/", nonce: "n", verifier: "v".repeat(43) })).searchParams.get("scope")!;
    expect(google).not.toMatch(/send/i);
    expect(missingScopes("microsoft", ["Mail.Read", "Mail.ReadWrite"])).toEqual([]);
    // Declining it still connects.
    const fetchImpl = vi.fn(async () => json({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "Mail.Read Mail.ReadWrite" }));
    await expect(exchangeCode({ provider: "microsoft", creds, code: "c", verifier: "v", redirectUri: "https://x/cb/", fetchImpl, now: 0 })).resolves.toBeTruthy();
  });

  it("any value but 'on' is off", () => {
    setSendFlag("true");
    expect(scopesOf()).not.toContain(SEND_SCOPE);
  });

  it("refresh asks for it only when the connection granted it", async () => {
    const asked = async (granted: string[]) => {
      const fetchImpl = vi.fn(async (_u: string, init?: RequestInit) => {
        void init;
        return json({ access_token: "a", expires_in: 3600 });
      });
      await refreshAccessToken({ provider: "microsoft", creds, refreshToken: "r", grantedScopes: granted, fetchImpl: fetchImpl as unknown as typeof fetch, now: 0 });
      const body = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as URLSearchParams;
      return body.get("scope")!.split(" ");
    };
    setSendFlag("on");
    expect(await asked(["Mail.Read", "Mail.ReadWrite"])).not.toContain(SEND_SCOPE);
    expect(await asked(["Mail.Read", "Mail.ReadWrite", "https://graph.microsoft.com/Mail.Send"])).toContain(SEND_SCOPE);
  });

  it("hasSendScope normalises like the calendar check", () => {
    expect(hasSendScope("microsoft", ["https://graph.microsoft.com/mail.send"])).toBe(true);
    expect(hasSendScope("microsoft", [" Mail.Send "])).toBe(true);
    expect(hasSendScope("microsoft", ["Mail.ReadWrite"])).toBe(false);
    expect(hasSendScope("microsoft", null)).toBe(false);
    expect(hasSendScope("google", ["Mail.Send"])).toBe(false);
  });
});

describe("sendCheckedDraft", () => {
  const draft = (over: object = {}) => json({ isDraft: true, toRecipients: [{ emailAddress: { address: "Ana@Example.com" } }], ...over });

  it("reads the draft back, then sends it by id", async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.endsWith("/send") ? new Response(null, { status: 202 }) : draft()));
    expect(await sendCheckedDraft({ accessToken: "t", draftId: "AAMk-1=", recipient: "ana@example.com", fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ ok: true });
    const urls = fetchImpl.mock.calls.map((c) => c[0]);
    expect(urls[0]).toBe("https://graph.microsoft.com/v1.0/me/messages/AAMk-1%3D?$select=isDraft,toRecipients,subject,createdDateTime");
    expect(urls[1]).toBe("https://graph.microsoft.com/v1.0/me/messages/AAMk-1%3D/send");
    expect((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].method).toBe("POST");
  });

  it.each([
    ["a sent message", draft({ isDraft: false }), "not-a-draft"],
    ["another recipient", draft({ toRecipients: [{ emailAddress: { address: "x@example.com" } }] }), "wrong-recipient"],
    ["a missing message", new Response(null, { status: 404 }), "gone"],
    ["a refused token", new Response(null, { status: 401 }), "reauth"],
    ["a server error", new Response(null, { status: 500 }), "failed"],
  ])("never sends %s", async (_n, first, reason) => {
    const fetchImpl = vi.fn(async () => first);
    expect(await sendCheckedDraft({ accessToken: "t", draftId: "AAMk1", recipient: "ana@example.com", fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ ok: false, reason });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refuses an id that could carry a path, without a call", async () => {
    const fetchImpl = vi.fn();
    for (const id of ["../me", "a/b", "a?x=1", "a b", ""]) {
      expect(await sendCheckedDraft({ accessToken: "t", draftId: id, recipient: "ana@example.com", fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ ok: false, reason: "bad-id" });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("a send refused after the check is reported, not assumed sent", async () => {
    const fetchImpl = vi.fn(async (url: string) => (url.endsWith("/send") ? new Response(null, { status: 403 }) : draft()));
    expect(await sendCheckedDraft({ accessToken: "t", draftId: "AAMk1", recipient: "ana@example.com", fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual({ ok: false, reason: "reauth" });
  });

  it("recipient matching is exact, case-insensitive", () => {
    expect(recipientsInclude(["Ana@Example.com"], " ana@example.com ")).toBe(true);
    expect(recipientsInclude(["ana@example.com.evil"], "ana@example.com")).toBe(false);
    expect(recipientsInclude(["a@b.c"], null)).toBe(false);
  });
});

describe("the draft must be the one made for this approval", async () => {
  const { draftMatchesApproval } = await import("@/lib/mailbox/outlook-send");
  const at = "2026-11-10T15:00:00.000Z";
  it("needs the same subject and a draft made at or after the approval", () => {
    expect(draftMatchesApproval({ subject: " Next  steps ", createdDateTime: "2026-11-10T15:00:05Z" }, { subject: "next steps", approvedAt: at })).toBe(true);
    expect(draftMatchesApproval({ subject: "Other", createdDateTime: "2026-11-10T15:00:05Z" }, { subject: "Next steps", approvedAt: at })).toBe(false);
    expect(draftMatchesApproval({ subject: "Next steps", createdDateTime: "2026-11-01T09:00:00Z" }, { subject: "Next steps", approvedAt: at })).toBe(false);
    expect(draftMatchesApproval({ subject: "Next steps", createdDateTime: null }, { subject: "Next steps", approvedAt: at })).toBe(false);
    expect(draftMatchesApproval({ subject: "Next steps", createdDateTime: "2026-11-10T15:00:05Z" }, { subject: "Next steps", approvedAt: null })).toBe(false);
  });
});
