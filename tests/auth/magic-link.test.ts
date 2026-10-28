import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ otp: vi.fn(), otpError: null as null | { status?: number; message: string } }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/site-origin", () => ({ getSiteOrigin: async () => "https://app.test" }));
vi.mock("@/lib/db/scoped-client", () => ({
  getScopedClient: async () => ({
    auth: {
      signInWithOtp: async (args: unknown) => {
        h.otp(args);
        return { error: h.otpError };
      },
    },
  }),
}));

const { createMagicLinkLimiter, MAGIC_LINK_GAP_MS, MAGIC_LINK_WINDOW_MS } = await import("@/lib/auth/magic-link-limit");
const { SIGN_IN_GENERIC, SIGN_IN_WAIT } = await import("@/lib/ui/words");

describe("magic link limiter", () => {
  it("allows one per address per 30 seconds and five per ten minutes, per address", () => {
    let now = 1_000_000;
    const limiter = createMagicLinkLimiter(() => now);
    expect(limiter.take("a@x.com")).toBe(true);
    expect(limiter.take("a@x.com")).toBe(false);
    expect(limiter.take("b@x.com")).toBe(true);
    for (let i = 0; i < 4; i++) {
      now += MAGIC_LINK_GAP_MS;
      expect(limiter.take("a@x.com")).toBe(true);
    }
    now += MAGIC_LINK_GAP_MS;
    expect(limiter.take("a@x.com")).toBe(false);
    now += MAGIC_LINK_WINDOW_MS;
    expect(limiter.take("a@x.com")).toBe(true);
  });
});

describe("sendMagicLink", () => {
  const form = (email: string) => {
    const f = new FormData();
    f.set("email", email);
    f.set("next", "/dashboard/");
    return f;
  };
  beforeEach(() => {
    h.otp.mockClear();
    h.otpError = null;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-28T12:00:00Z"));
  });

  it("sends, then refuses a second request inside 30 seconds without calling the provider, then sends again", async () => {
    const { sendMagicLink } = await import("@/app/sign-in/actions");
    const first = await sendMagicLink({}, form("Rita@Firm.com"));
    expect(first).toEqual({ ok: true, email: "rita@firm.com" });
    const second = await sendMagicLink({}, form("rita@firm.com"));
    expect(second).toEqual({ error: SIGN_IN_WAIT });
    expect(h.otp).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(MAGIC_LINK_GAP_MS + 1);
    expect((await sendMagicLink({}, form("rita@firm.com"))).ok).toBe(true);
    expect(h.otp).toHaveBeenCalledTimes(2);
  });

  it("refuses the sixth within ten minutes; other addresses are independent", async () => {
    const { sendMagicLink } = await import("@/app/sign-in/actions");
    for (let i = 0; i < 5; i++) {
      expect((await sendMagicLink({}, form("six@firm.com"))).ok).toBe(true);
      vi.advanceTimersByTime(MAGIC_LINK_GAP_MS + 1);
    }
    expect(await sendMagicLink({}, form("six@firm.com"))).toEqual({ error: SIGN_IN_WAIT });
    expect((await sendMagicLink({}, form("other@firm.com"))).ok).toBe(true);
  });

  it("a provider error is the generic sentence, with no provider text or address logged", async () => {
    const { sendMagicLink } = await import("@/app/sign-in/actions");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    h.otpError = { status: 500, message: "SMTP failed for err@firm.com" };
    const res = await sendMagicLink({}, form("err@firm.com"));
    expect(res).toEqual({ error: SIGN_IN_GENERIC });
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/err@firm\.com|SMTP/);
    spy.mockRestore();
    vi.useRealTimers();
  });
});
