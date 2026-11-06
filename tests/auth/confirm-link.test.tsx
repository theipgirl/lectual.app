import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { parseConfirmLink } from "@/lib/auth/sign-in-errors";

const h = vi.hoisted(() => ({ verifyOtp: vi.fn(), redirect: vi.fn((to: string) => { throw new Error(`REDIRECT ${to}`); }) }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ auth: { verifyOtp: h.verifyOtp } }) }));

const HASH = "pkce_0123456789abcdef0123456789abcdef";

describe("parseConfirmLink", () => {
  it("accepts a url-safe hash and the email link types, defaulting to email", () => {
    expect(parseConfirmLink(HASH, undefined)).toEqual({ tokenHash: HASH, type: "email" });
    expect(parseConfirmLink(HASH, "magiclink")?.type).toBe("magiclink");
    expect(parseConfirmLink(HASH, "invite")?.type).toBe("invite");
  });
  it("refuses other types and odd hashes", () => {
    for (const [h, t] of [[HASH, "recovery"], [HASH, "email_change"], ["short", "email"], ["a b<c>d e f g h", "email"], [undefined, "email"], ["x".repeat(300), "email"]]) {
      expect(parseConfirmLink(h, t)).toBeNull();
    }
  });
});

describe("the confirm page spends nothing on load", () => {
  beforeEach(() => { h.verifyOtp.mockReset(); h.redirect.mockClear(); });
  it("renders a Sign in button carrying the hash and a safe next, and never calls Supabase", async () => {
    const { default: Page } = await import("@/app/auth/confirm/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ token_hash: HASH, type: "email", next: "https://evil.example" }) }));
    expect(html).toContain(">Sign in<");
    expect(html).toContain(`value="${HASH}"`);
    expect(html).toContain('name="next" value="/dashboard/"');
    expect(h.verifyOtp).not.toHaveBeenCalled();
  });
  it("a bad link shows the expired sentence and a way back", async () => {
    const { default: Page } = await import("@/app/auth/confirm/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ token_hash: "bad", type: "email" }) }));
    expect(html).toContain("expired or was already used");
    expect(html).toContain('href="/sign-in/"');
  });
});

describe("confirmSignIn (the button press)", () => {
  beforeEach(() => { h.verifyOtp.mockReset(); h.redirect.mockClear(); });
  const form = (hash: string, next = "/dashboard/review/") => {
    const f = new FormData();
    f.set("token_hash", hash); f.set("type", "email"); f.set("next", next);
    return f;
  };
  it("verifies the token hash and goes to the safe next path", async () => {
    h.verifyOtp.mockResolvedValue({ error: null });
    const { confirmSignIn } = await import("@/app/auth/confirm/actions");
    await expect(confirmSignIn(form(HASH))).rejects.toThrow("REDIRECT /dashboard/review/");
    expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: HASH, type: "email" });
  });
  it("a spent token goes back to sign-in with the expired code, keeping next", async () => {
    h.verifyOtp.mockResolvedValue({ error: { status: 403, message: "Email link is invalid or has expired" } });
    const { confirmSignIn } = await import("@/app/auth/confirm/actions");
    await expect(confirmSignIn(form(HASH))).rejects.toThrow("REDIRECT /sign-in/?error=otp_expired&next=%2Fdashboard%2Freview%2F");
  });
  it("a malformed hash never reaches Supabase", async () => {
    const { confirmSignIn } = await import("@/app/auth/confirm/actions");
    await expect(confirmSignIn(form("bad"))).rejects.toThrow("REDIRECT /sign-in/?error=otp_expired");
    expect(h.verifyOtp).not.toHaveBeenCalled();
  });
});
