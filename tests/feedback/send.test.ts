import { describe, it, expect, vi } from "vitest";
import { sendFeedback, type FeedbackDeps } from "@/lib/feedback/submit";
import { createRateLimiter } from "@/lib/feedback/rate-limit";
import { feedbackSubject } from "@/lib/feedback/email";
import { buildFeedbackForm } from "@/lib/feedback/form";
import { ROLES } from "@/lib/auth/roles";
import { recordRoute, emptyTrail, serializeTrail } from "@/lib/feedback/trail";

const OK_SESSION = (over: Record<string, unknown> = {}) =>
  ({
    kind: "ok",
    user: { id: "user-1", email: "ana@firm.example" },
    org: { id: "org-1", name: "Firm LLP", slug: "firm", modules: [] },
    role: "attorney",
    actingAsStaff: false,
    ...over,
  }) as never;

function setup(over: { session?: unknown; env?: FeedbackDeps["env"]; mail?: FeedbackDeps["mail"]; now?: () => number } = {}) {
  const mail = vi.fn<FeedbackDeps["mail"]>(over.mail ?? (async () => ({ status: "sent" })));
  const limiter = createRateLimiter({ max: 5, windowMs: 3_600_000, now: over.now });
  const deps: FeedbackDeps = {
    session: async () => (over.session ?? OK_SESSION()) as never,
    env: over.env ?? { FEEDBACK_TO: "bugs@lectual.app", RESEND_API_KEY: "re_key" },
    mail,
    limiter,
    deployment: () => ({ vercelEnv: "production", commitSha: "abc123" }),
  };
  return { deps, mail, run: (f: FormData) => sendFeedback(deps, f) };
}
function mk(o: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ type: "bug", description: "It broke", ...o })) f.set(k, v);
  return f;
}

describe("validation: fixed sentences, nothing sent", () => {
  it("refuses signed-out, an unknown type, empty text, over-long text and non-strings", async () => {
    const out = setup({ session: { kind: "signed-out", redirectTo: "/" } });
    expect((await out.run(mk({}))).ok).toBe(false);
    const s = setup();
    expect(await s.run(mk({ type: "rant" }))).toEqual({ ok: false, error: "Choose Bug, Request, Question or Other." });
    expect((await s.run(mk({ description: "   \n " }))).ok).toBe(false);
    expect((await s.run(mk({ description: "a".repeat(5001) }))).ok).toBe(false);
    const nonString = new FormData();
    nonString.set("type", "bug");
    nonString.set("description", new Blob(["x"]));
    expect((await s.run(nonString)).ok).toBe(false);
    expect((await s.run(new FormData())).ok).toBe(false);
    expect(s.mail).not.toHaveBeenCalled();
    expect(out.mail).not.toHaveBeenCalled();
  });
  it("accepts exactly 5,000 characters", async () => {
    const s = setup();
    expect(await s.run(mk({ description: "a".repeat(5000) }))).toEqual({ ok: true });
  });
});

describe("role and session", () => {
  it.each([...ROLES])("%s can send", async (role) => {
    const s = setup({ session: OK_SESSION({ role }) });
    expect(await s.run(mk({}))).toEqual({ ok: true });
  });
  it("an unresolvable firm session is refused", async () => {
    const s = setup({ session: { kind: "no-access", user: {} } });
    expect((await s.run(mk({}))).ok).toBe(false);
    expect(s.mail).not.toHaveBeenCalled();
  });
});

describe("env", () => {
  it.each([{}, { FEEDBACK_TO: " , ,", RESEND_API_KEY: "k" }, { FEEDBACK_TO: "a@b.co" }])("%o -> not set up, mailer not called, limit not consumed", async (env) => {
    const s = setup({ env });
    for (let i = 0; i < 7; i++) expect(await s.run(mk({}))).toEqual({ ok: false, error: "Feedback isn't set up yet." });
    expect(s.mail).not.toHaveBeenCalled();
    expect(s.deps.limiter.allowed("user-1")).toBe(true);
  });
});

describe("email content", () => {
  it("one send to FEEDBACK_TO with the sender as reply_to and the context and trail in the body", async () => {
    const trail = serializeTrail(recordRoute(emptyTrail(), "/dashboard/queue/?x=1", "2026-10-22T12:00:00.000Z"));
    const s = setup({ env: { FEEDBACK_TO: " a@lectual.app , b@lectual.app ", RESEND_API_KEY: "k", FEEDBACK_FROM: "Me <m@lectual.app>" } });
    const f = buildFeedbackForm({ type: "request", description: "Please add\nfoo", trailJson: trail });
    f.set("to", "victim@client.example");
    f.set("from", "evil@client.example");
    f.set("reply_to", "x@y.z");
    expect(await s.run(f)).toEqual({ ok: true });
    expect(s.mail).toHaveBeenCalledTimes(1);
    const m = s.mail.mock.calls[0][0];
    expect(m.to).toEqual(["a@lectual.app", "b@lectual.app"]);
    expect(m.from).toBe("Me <m@lectual.app>");
    expect(m.replyTo).toBe("ana@firm.example");
    expect(m.subject).toBe("[Lectual feedback] Request: Please add foo");
    for (const part of ["Please add\nfoo", "Firm LLP", "org-1", "ana@firm.example", "attorney", "production", "abc123", "/dashboard/queue/"]) expect(m.text).toContain(part);
    expect(m.text).not.toContain("x=1");
    expect(m.text).not.toContain("victim@client.example");
  });
  it("defaults the From and cuts the subject at 60 characters", async () => {
    const s = setup();
    await s.run(mk({}));
    expect(s.mail.mock.calls[0][0].from).toBe("Lectual feedback <noreply@lectual.app>");
    for (const n of [59, 60, 61]) {
      const subj = feedbackSubject("bug", "a".repeat(n));
      expect(subj).toBe(`[Lectual feedback] Bug: ${"a".repeat(Math.min(n, 60))}`);
    }
  });
  it("a missing or unreadable trail still sends", async () => {
    const s = setup();
    await s.run(mk({ trail: "{nope" }));
    expect(s.mail.mock.calls[0][0].text).toContain("Routes (0");
  });
});

describe("failure handling", () => {
  const log = () => vi.spyOn(console, "error").mockImplementation(() => {});
  it.each([
    ["non-2xx", async () => ({ status: "failed", http: 403 }) as const],
    ["rejected", async () => ({ status: "failed", http: null }) as const],
    ["thrown", async () => { throw new Error("secret Resend body for ana@firm.example"); }],
  ])("%s returns the fixed sentence, does not throw, does not consume a slot", async (_n, mail) => {
    const spy = log();
    const s = setup({ mail });
    const r = await s.run(mk({}));
    expect(r).toEqual({ ok: false, error: "We couldn't send your feedback. Please try again in a moment." });
    expect(JSON.stringify(r)).not.toMatch(/secret|Resend/);
    expect(s.deps.limiter.allowed("user-1")).toBe(true);
    expect(spy.mock.calls.flat().join(" ")).not.toMatch(/secret/);
    spy.mockRestore();
  });
});

describe("the real mailer through a fetch spy", () => {
  it("non-2xx, rejection and timeout never leak the body or message", async () => {
    const { sendInternalMail } = await import("@/lib/mail/internal-mail");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const base = { apiKey: "k", from: "a@b.co", to: ["c@d.co"], subject: "s", text: "t" };
    const refused = await sendInternalMail({ ...base, fetchImpl: (async () => new Response("RESEND SECRET BODY", { status: 422 })) as typeof fetch });
    const rejected = await sendInternalMail({ ...base, fetchImpl: (async () => { throw new Error("boom ana@firm.example"); }) as typeof fetch });
    const timedOut = await sendInternalMail({ ...base, fetchImpl: (async () => { throw new DOMException("timed out", "TimeoutError"); }) as typeof fetch });
    expect([refused, rejected, timedOut].map((r) => r.status)).toEqual(["failed", "failed", "failed"]);
    expect(JSON.stringify([refused, rejected, timedOut])).not.toMatch(/SECRET|boom/);
    expect(spy.mock.calls.flat().join(" ")).not.toMatch(/SECRET|boom|ana@/);
    spy.mockRestore();
  });
  it("posts to Resend with reply_to when given", async () => {
    const { sendInternalMail } = await import("@/lib/mail/internal-mail");
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendInternalMail({ apiKey: "k", from: "a@b.co", to: ["c@d.co"], replyTo: "r@d.co", subject: "s", text: "t", fetchImpl: f as unknown as typeof fetch });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(JSON.parse(init.body as string)).toMatchObject({ reply_to: "r@d.co", to: ["c@d.co"] });
  });
});

describe("rate limit", () => {
  it("5 per person per rolling hour, then the 6th is refused; the clock moves it on; others unaffected", async () => {
    let now = 1_000_000;
    const s = setup({ now: () => now });
    for (let i = 0; i < 5; i++) {
      expect(await s.run(mk({}))).toEqual({ ok: true });
      now += 1000;
    }
    expect(await s.run(mk({}))).toEqual({ ok: false, error: "You've sent a lot of feedback just now. Please try again later." });
    expect(s.mail).toHaveBeenCalledTimes(5);
    // A posted "userId" changes nothing.
    expect((await s.run(mk({ userId: "someone-else", user_id: "x" }))).ok).toBe(false);
    const other = sendFeedback({ ...s.deps, session: async () => OK_SESSION({ user: { id: "user-2", email: "b@firm.example" } }) }, mk({}));
    expect(await other).toEqual({ ok: true });
    now = 1_000_000 + 3_600_000 + 1;
    expect(await s.run(mk({}))).toEqual({ ok: true });
  });
});
