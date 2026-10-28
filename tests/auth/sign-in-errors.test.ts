import { beforeEach, describe, expect, it, vi } from "vitest";
import { signInErrorMessage } from "@/lib/auth/sign-in-errors";
import { SIGN_IN_ERROR_FALLBACK, SIGN_IN_EXPIRED, SIGN_IN_GENERIC } from "@/lib/ui/words";

const SENTINEL = "SENTINEL-provider-text-for-someone@example.com";

describe("signInErrorMessage (the ?error= value from the address bar)", () => {
  it.each(["otp_expired", "access_denied", "OTP_EXPIRED", " access_denied "])("maps %j to the expired-link sentence", (code) => {
    expect(signInErrorMessage(code)).toBe("That sign-in link has expired or was already used. Enter your email to get a new one.");
    expect(signInErrorMessage(code)).toBe(SIGN_IN_EXPIRED);
  });

  it("maps anything else, a sentinel included, to one fixed sentence that does not echo it", () => {
    for (const raw of [SENTINEL, "server_error", "", undefined, null, "<script>alert(1)</script>"]) {
      const out = signInErrorMessage(raw as string | undefined);
      expect(out).toBe(SIGN_IN_ERROR_FALLBACK);
      if (typeof raw === "string" && raw) expect(out).not.toContain(raw);
    }
  });
});

describe("sendMagicLink", () => {
  const signInWithOtp = vi.fn();
  beforeEach(() => {
    vi.resetModules();
    signInWithOtp.mockReset();
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ auth: { signInWithOtp } }) }));
    vi.doMock("@/lib/site-origin", () => ({ getSiteOrigin: async () => "https://app.example.com" }));
  });
  const form = (email: string) => {
    const f = new FormData();
    f.set("email", email);
    return f;
  };

  it("never returns the provider's text when sending fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signInWithOtp.mockResolvedValue({ error: { message: SENTINEL, status: 500 } });
    const { sendMagicLink } = await import("@/app/sign-in/actions");
    const res = await sendMagicLink({}, form("a@example.com"));
    expect(res).toEqual({ error: "We couldn't send the link. Check the address and try again." });
    expect(res.error).toBe(SIGN_IN_GENERIC);
    expect(JSON.stringify(res)).not.toContain("SENTINEL");
  });

  it("still succeeds when the link is sent", async () => {
    signInWithOtp.mockResolvedValue({ error: null });
    const { sendMagicLink } = await import("@/app/sign-in/actions");
    expect(await sendMagicLink({}, form("a@example.com"))).toEqual({ ok: true, email: "a@example.com" });
  });
});

describe("the sign-in page", () => {
  it("draws the mapped sentence, never the raw query value", async () => {
    vi.resetModules();
    vi.doMock("next/navigation", () => ({ redirect: vi.fn() }));
    vi.doMock("@/app/sign-in/LoginForm", () => ({ default: () => null }));
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: Page } = await import("@/app/sign-in/page");
    const html = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ error: "otp_expired" }) }));
    expect(html).toContain(SIGN_IN_EXPIRED);
    expect(html).not.toContain("otp_expired");
    const other = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ error: SENTINEL }) }));
    expect(other).toContain(SIGN_IN_ERROR_FALLBACK.replace(/'/g, "&#x27;"));
    expect(other).not.toContain("SENTINEL");
  });
});
