import { beforeEach, describe, expect, it, vi } from "vitest";
import { hashErrorCode, normalizeSignInCode, signInErrorMessage } from "@/lib/auth/sign-in-errors";
import { SIGN_IN_CODE_BAD, SIGN_IN_CODE_FORMAT, SIGN_IN_EXPIRED } from "@/lib/ui/words";

describe("hashErrorCode (Supabase's bounce puts the reason in the URL fragment)", () => {
  it("reads the real bounce a member got", () => {
    const hash = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=";
    expect(hashErrorCode(hash)).toBe("otp_expired");
    expect(signInErrorMessage(hashErrorCode(hash))).toBe(SIGN_IN_EXPIRED);
  });
  it("falls back to error= and ignores fragments with no error", () => {
    expect(hashErrorCode("#error=access_denied")).toBe("access_denied");
    for (const h of ["", "#", "#access_token=abc", null, undefined]) expect(hashErrorCode(h)).toBeNull();
  });
  it("never echoes an unknown value", () => {
    expect(signInErrorMessage(hashErrorCode("#error_code=<b>someone@x.com</b>"))).not.toContain("someone");
  });
});

describe("normalizeSignInCode", () => {
  it("accepts 6 digits, with spaces or dashes", () => {
    expect(normalizeSignInCode("123456")).toBe("123456");
    expect(normalizeSignInCode(" 123 456 ")).toBe("123456");
    expect(normalizeSignInCode("123-456")).toBe("123456");
  });
  it("refuses anything else", () => {
    for (const v of ["12345", "1234567", "abcdef", "", null, 123456]) expect(normalizeSignInCode(v)).toBeNull();
  });
});

describe("verifySignInCode", () => {
  const verifyOtp = vi.fn();
  const redirect = vi.fn(() => {
    throw new Error("REDIRECT");
  });
  beforeEach(() => {
    vi.resetModules();
    verifyOtp.mockReset();
    redirect.mockClear();
    vi.doMock("next/navigation", () => ({ redirect }));
    vi.doMock("@/lib/db/scoped-client", () => ({ getScopedClient: async () => ({ auth: { verifyOtp } }) }));
    vi.doMock("@/lib/site-origin", () => ({ getSiteOrigin: async () => "https://app.example.com" }));
  });
  const form = (email: string, code: string, next = "/dashboard/review/") => {
    const f = new FormData();
    f.set("email", email);
    f.set("code", code);
    f.set("next", next);
    return f;
  };

  it("checks the code with Supabase and goes on to the safe next path", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const { verifySignInCode } = await import("@/app/sign-in/actions");
    await expect(verifySignInCode({}, form("Rita@Firm.com", "123 456"))).rejects.toThrow("REDIRECT");
    expect(verifyOtp).toHaveBeenCalledWith({ email: "rita@firm.com", token: "123456", type: "email" });
    expect(redirect).toHaveBeenCalledWith("/dashboard/review/");
  });
  it("never redirects off the app", async () => {
    verifyOtp.mockResolvedValue({ error: null });
    const { verifySignInCode } = await import("@/app/sign-in/actions");
    await expect(verifySignInCode({}, form("a@b.com", "123456", "https://evil.example"))).rejects.toThrow("REDIRECT");
    expect(redirect).not.toHaveBeenCalledWith("https://evil.example");
  });
  it("a malformed code never reaches Supabase", async () => {
    const { verifySignInCode } = await import("@/app/sign-in/actions");
    expect(await verifySignInCode({}, form("a@b.com", "12ab"))).toEqual({ error: SIGN_IN_CODE_FORMAT });
    expect(verifyOtp).not.toHaveBeenCalled();
  });
  it("a refused code is one fixed sentence, never the provider's text", async () => {
    verifyOtp.mockResolvedValue({ error: { status: 403, message: "Token has expired or is invalid for someone@x.com" } });
    const { verifySignInCode } = await import("@/app/sign-in/actions");
    expect(await verifySignInCode({}, form("a@b.com", "123456"))).toEqual({ error: SIGN_IN_CODE_BAD });
    expect(redirect).not.toHaveBeenCalled();
  });
});
