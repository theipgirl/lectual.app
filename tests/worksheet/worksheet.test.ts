import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  corsHeaders,
  handleWorksheetPost,
  preflight,
  worksheetToken,
  WORKSHEET_MESSAGES,
  type WorksheetDeps,
} from "@/lib/worksheet/handle";
import { SlidingWindowThrottle } from "@/lib/intake-forms/spam";
import { parseWorksheetBody, WORKSHEET_BODY_MAX } from "@/lib/worksheet/schema";
import { attendeeCopy, firmNotice } from "@/lib/worksheet/email";
import { STRATEGY_SESSION_URL, WORKSHEET_FOOTER, worksheetIntakeAnswers, worksheetSummary } from "@/lib/worksheet/answers";
import { attendeeHtml, esc, WORKSHEET_LOGO_URL } from "@/lib/worksheet/email-html";
import { sendInternalMail } from "@/lib/mail/internal-mail";
import type { IntakeHandle } from "@/lib/intake-forms/public";

const ORIGIN = "https://masterclass.rpblawfirm.com";
const UUID = "3f1c2b9e-8a4d-4c6e-9b1a-2d3e4f5a6b7c";

const HANDLE: IntakeHandle = {
  formId: "form-rpb",
  orgId: "org-rpb",
  slug: "masterclass-nov-2026",
  name: "Master class worksheet",
  sourceTag: "Master Class Nov 2026",
  kind: "intake",
  config: { questions: [], packs: [] } as never,
  orgName: "RPB Law Firm",
  receivesReferrals: false,
};

function body(over: Record<string, unknown> = {}) {
  return {
    submissionId: UUID,
    submittedAt: "2026-11-17T23:30:00.000Z",
    source: "ip-masterclass-worksheet",
    event: "The Trademark Master Class · November 17, 2026",
    contact: { firstName: "Ana", lastName: "Rivera", email: "Ana@Example.com", business: "Rivera Roasters", mobile: "555 123 4567" },
    consent: { given: true, text: "Send me a copy of my worksheet and follow-up from RPB Law Firm by email." },
    answers: {
      groups: { business: [{ name: "Rivera Roasters", using: "Already using", where: "Both" }], slogan: [{ name: "", using: "", where: "" }] },
      extra: { dba: "", searched: "No", handles: "@rivera" },
      logo: { has: "Yes", who: "I did", contractors: ["None of these"], agreement: "" },
      creativeWork: { written: "A blog", visual: "", registered: "No" },
      nextStep: { priority: "Rivera Roasters", talk: "Yes, I'd like to book a Legal Strategy Session" },
    },
    summaryText: "whatever the browser wrote",
    ...over,
  };
}

function headers(h: Record<string, string>) {
  const m = new Map(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (k: string) => m.get(k.toLowerCase()) ?? null };
}

function setup(over: Partial<Omit<WorksheetDeps, "config">> & { config?: Partial<WorksheetDeps["config"]> } = {}) {
  const rows = new Map<string, { done: boolean; email: string }>();
  const start = vi.fn<WorksheetDeps["start"]>(async (_h, s, ctx) => {
    rows.set(ctx.token, { done: false, email: s.contact.email });
    return { ok: true, submissionId: "sub-1", token: ctx.token, leadId: "lead-1" };
  });
  const complete = vi.fn<WorksheetDeps["complete"]>(async (_h, token, answers, mode) => {
    const row = rows.get(token);
    if (!row) return { ok: false, reason: "not_found" };
    const contact = { name: "Ana Rivera", email: row.email, phone: "", company: "" };
    if (row.done) return { ok: true, submissionId: "sub-1", submission: { mode, contact, answers }, alreadyDone: true, noteBody: "", utm: {} };
    row.done = true;
    return { ok: true, submissionId: "sub-1", submission: { mode, contact, answers }, alreadyDone: false, noteBody: "note", utm: {} };
  });
  const mail = vi.fn<WorksheetDeps["mail"]>(async () => ({ status: "sent" }));
  const readHandle = vi.fn<WorksheetDeps["readHandle"]>(async () => ({ status: "ok", handle: HANDLE }));
  const deps: WorksheetDeps = {
    readHandle,
    start,
    complete,
    recordEvent: vi.fn(async () => {}),
    mail,
    now: () => new Date("2026-11-17T23:30:00Z"),
    ipThrottle: new SlidingWindowThrottle(20, 600_000),
    emailThrottle: new SlidingWindowThrottle(4, 600_000),
    inFlight: new Set(),
    ...over,
    config: {
      slug: "masterclass-nov-2026",
      allowedOrigins: [ORIGIN],
      notifyTo: ["support@rpblawfirm.com", "info@rpblawfirm.com"],
      from: "RPB Law Firm <events@rpblawfirm.com>",
      replyTo: "info@rpblawfirm.com",
      resendKey: "re_test",
      tokenKey: "salt",
      lawmaticsSync: false,
      ...over.config,
    },
  };
  const post = (b: unknown, h: Record<string, string> = {}) =>
    handleWorksheetPost(
      { headers: headers({ origin: ORIGIN, "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...h }), rawBody: typeof b === "string" ? b : JSON.stringify(b) },
      deps,
    );
  return { deps, post, start, complete, mail, readHandle, rows };
}

describe("CORS", () => {
  it("answers the preflight for the worksheet's origin only", () => {
    const ok = preflight(ORIGIN, [ORIGIN]);
    expect(ok.status).toBe(204);
    expect(ok.headers["Access-Control-Allow-Origin"]).toBe(ORIGIN);
    expect(ok.headers["Access-Control-Allow-Methods"]).toContain("POST");
    const bad = preflight("https://evil.example", [ORIGIN]);
    expect(bad.status).toBe(403);
    expect(bad.headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(preflight(null, [ORIGIN]).status).toBe(403);
    expect(corsHeaders("https://masterclass.rpblawfirm.com.evil.example", [ORIGIN])["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("refuses a POST from another origin, or with none, writing nothing", async () => {
    const s = setup();
    for (const origin of ["https://evil.example", ""]) {
      const r = await s.post(body(), { origin });
      expect(r.status).toBe(403);
      expect(r.body.error).toBe(WORKSHEET_MESSAGES.origin);
    }
    expect(s.start).not.toHaveBeenCalled();
    expect(s.mail).not.toHaveBeenCalled();
  });
});

describe("validation", () => {
  it("refuses a body over the size cap, non-JSON and a non-JSON content type", async () => {
    const s = setup();
    expect((await s.post("x".repeat(WORKSHEET_BODY_MAX + 1))).status).toBe(413);
    expect((await s.post("{not json")).status).toBe(400);
    expect((await s.post(body(), { "content-type": "text/plain" })).status).toBe(415);
    expect(s.start).not.toHaveBeenCalled();
  });

  it("needs a uuid, a first and last name, a real email and consent", async () => {
    const s = setup();
    expect((await s.post(body({ submissionId: "nope" }))).status).toBe(400);
    expect((await s.post(body({ contact: { firstName: "", lastName: "R", email: "a@b.co" } }))).status).toBe(400);
    const badEmail = await s.post(body({ contact: { firstName: "A", lastName: "R", email: "not-an-email" } }));
    expect(badEmail.status).toBe(400);
    expect(badEmail.body.error).toBe(WORKSHEET_MESSAGES.email);
    const noConsent = await s.post(body({ consent: { given: false } }));
    expect(noConsent.body.error).toBe(WORKSHEET_MESSAGES.consent);
    expect(s.start).not.toHaveBeenCalled();
  });

  it("caps every field and keeps at most five entries per group", () => {
    const p = parseWorksheetBody(
      JSON.stringify(
        body({
          answers: {
            groups: { business: Array.from({ length: 9 }, (_, i) => ({ name: `N${i}`.repeat(100) })) },
            creativeWork: { written: "w".repeat(9000) },
          },
        }),
      ),
    );
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.value.answers.groups.business).toHaveLength(5);
    expect(p.value.answers.groups.business![0].name.length).toBeLessThanOrEqual(120);
    expect(p.value.answers.creativeWork.written.length).toBe(3000);
  });

  it("tells a bot that fills the honeypot 'ok' and writes nothing", async () => {
    const s = setup();
    const r = await s.post(body({ website: "http://spam.example" }));
    expect(r.status).toBe(200);
    expect(s.start).not.toHaveBeenCalled();
    expect(s.mail).not.toHaveBeenCalled();
  });
});

describe("where it lands", () => {
  it("never takes a firm, org or form from the body: only the configured slug's form", async () => {
    const s = setup();
    const r = await s.post(body({ orgId: "org-other", org_id: "org-other", formId: "f", slug: "someone-else" }));
    expect(r.status).toBe(200);
    expect(s.readHandle).toHaveBeenCalledWith("masterclass-nov-2026");
    expect(s.readHandle).toHaveBeenCalledTimes(1);
    expect(s.start.mock.calls[0][0].orgId).toBe("org-rpb");
  });

  it("files contact first through the public intake, then the answers with server-side question text", async () => {
    const s = setup();
    await s.post(body());
    const startArg = s.start.mock.calls[0][1];
    expect(startArg.contact).toEqual({ name: "Ana Rivera", email: "ana@example.com", phone: "555 123 4567", company: "Rivera Roasters" });
    expect(s.start.mock.calls[0][2].sourceHost).toBe("masterclass.rpblawfirm.com");
    const answers = s.complete.mock.calls.at(-1)![2];
    expect(answers).toContainEqual({ id: "ws_business_1", question: "Your business or brand name: Business / Brand Name", answer: "Rivera Roasters (Already using · Both)" });
    expect(answers.some((a) => a.answer.includes("whatever the browser wrote"))).toBe(false);
  });

  it("keeps a mobile number the contact check would refuse in the answers instead of failing", async () => {
    const s = setup();
    const r = await s.post(body({ contact: { firstName: "A", lastName: "R", email: "a@b.co", business: "", mobile: "call me!" } }));
    expect(r.status).toBe(200);
    expect(s.start.mock.calls[0][1].contact.phone).toBe("");
    expect(s.complete.mock.calls.at(-1)![2][0]).toEqual({ id: "ws_mobile", question: "About you: Mobile (as typed)", answer: "call me!" });
  });

  it("answers 503 and sends nothing when the slug is unset, the form isn't live, or is an assessment", async () => {
    for (const s of [
      setup({ config: { slug: null } }),
      setup({ readHandle: async () => ({ status: "not_found" }) }),
      setup({ readHandle: async () => ({ status: "ok", handle: { ...HANDLE, kind: "assessment" } }) }),
    ]) {
      const r = await s.post(body());
      expect(r.status).toBe(503);
      expect(s.start).not.toHaveBeenCalled();
      expect(s.mail).not.toHaveBeenCalled();
    }
  });

  it("answers 503 when the lead write fails, and sends no email", async () => {
    const s = setup({ start: async () => ({ ok: false }) });
    const r = await s.post(body());
    expect(r.status).toBe(503);
    expect(s.mail).not.toHaveBeenCalled();
  });

  it("a retry with the same uuid writes nothing new", async () => {
    const s = setup();
    expect((await s.post(body())).status).toBe(200);
    expect((await s.post(body())).status).toBe(200);
    expect(s.start).toHaveBeenCalledTimes(1);
    expect(s.rows.size).toBe(1);
  });

  it("derives a stable, resume-token-shaped token per form and uuid", () => {
    const t = worksheetToken("form-a", UUID, "k");
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(worksheetToken("form-a", UUID.toUpperCase(), "k")).toBe(t);
    expect(worksheetToken("form-b", UUID, "k")).not.toBe(t);
  });
});

describe("emails", () => {
  it("sends the attendee copy and the firm notice, with idempotency keys", async () => {
    const s = setup();
    await s.post(body());
    expect(s.mail).toHaveBeenCalledTimes(2);
    const [copy, notice] = s.mail.mock.calls.map((c) => c[0]);
    expect(copy.to).toEqual(["ana@example.com"]);
    expect(copy.replyTo).toBe("info@rpblawfirm.com");
    expect(copy.idempotencyKey).toBe(`worksheet-copy/${UUID}`);
    expect(notice.to).toEqual(["support@rpblawfirm.com", "info@rpblawfirm.com"]);
    expect(notice.replyTo).toBe("ana@example.com");
    expect(notice.text.split("\n")[0]).toMatch(/^WANTS A LEGAL STRATEGY SESSION: YES/);
  });

  it("a failed email still answers 200 once the lead is written", async () => {
    const s = setup({ mail: vi.fn(async () => ({ status: "failed" as const, http: 500 })) });
    expect((await s.post(body())).status).toBe(200);
  });

  it("sends nothing when the sender or key isn't set, and the request still succeeds", async () => {
    const s = setup({ config: { from: null } });
    expect((await s.post(body())).status).toBe(200);
    expect(s.mail).not.toHaveBeenCalled();
  });

  it("on a replayed uuid, mails only the address the row holds", async () => {
    const s = setup();
    await s.post(body());
    s.mail.mockClear();
    await s.post(body({ contact: { firstName: "X", lastName: "Y", email: "victim@example.org" } }));
    expect(s.mail).not.toHaveBeenCalled();
  });

  it("the attendee copy has the summary, the session link and the footer, and never says free or discount", () => {
    const p = parseWorksheetBody(JSON.stringify(body()));
    if (!p.ok) throw new Error("bad fixture");
    const now = new Date("2026-11-17T23:30:00Z");
    const c = attendeeCopy(p.value, { now });
    expect(c.text).toContain("Hi Ana,");
    expect(c.text).toContain("YOUR IP PORTFOLIO");
    expect(c.text).toContain("Business / Brand Name: Rivera Roasters (Already using · Both)");
    expect(c.text).toContain(STRATEGY_SESSION_URL);
    expect(c.text.trimEnd().endsWith(WORKSHEET_FOOTER)).toBe(true);
    const n = firmNotice(p.value, { now, filedAs: "Master Class Nov 2026", copySent: true });
    for (const t of [c.subject, c.text, n.subject, n.text]) expect(t).not.toMatch(/\bfree\b|discount/i);
    expect(n.subject).toContain("[Wants a Strategy Session]");
    expect(n.text).toContain("Email: ana@example.com");
  });

  it("the notice says plainly when they didn't ask for a session", () => {
    const p = parseWorksheetBody(JSON.stringify(body({ answers: { nextStep: { talk: "Not right now" } } })));
    if (!p.ok) throw new Error("bad fixture");
    const n = firmNotice(p.value, { now: new Date(), filedAs: "x", copySent: false });
    expect(n.text.split("\n")[0]).toBe("Legal Strategy Session: not right now.");
    expect(n.subject).not.toContain("Wants");
    expect(worksheetIntakeAnswers(p.value).find((a) => a.id === "ws_talk")?.answer).toBe("Not right now");
  });
});

describe("attendee HTML email", () => {
  const now = new Date("2026-11-17T23:30:00Z");
  const parse = (over: Record<string, unknown> = {}) => {
    const p = parseWorksheetBody(JSON.stringify(body(over)));
    if (!p.ok) throw new Error("bad fixture");
    return p.value;
  };

  it("keeps the plain text exactly as it was, and adds an html part", () => {
    const v = parse();
    const c = attendeeCopy(v, { now });
    const expected = [
      "Hi Ana,",
      "",
      "Thank you for joining The Trademark Master Class with RPB Law Firm. Here is a copy of Your IP Portfolio you filled in, so you can keep it.",
      "",
      worksheetSummary(v, now),
      "",
      "When you're ready to talk with our team about protecting what you've built, you can book a Legal Strategy Session here:",
      STRATEGY_SESSION_URL,
      "",
      "RPB Law Firm",
      "",
      WORKSHEET_FOOTER,
    ].join("\n");
    expect(c.text).toBe(expected);
    expect(c.html).toBeTruthy();
    expect(firmNotice(v, { now, filedAs: "x", copySent: true }).html).toBeUndefined();
  });

  it("has the logo, the button, the footer, the numbered sections and the rows", () => {
    const h = attendeeHtml(parse(), now);
    expect(h).toContain(`src="${WORKSHEET_LOGO_URL}"`);
    expect(h).toContain('alt="RPB Law Firm"');
    expect(h).toContain(`href="${STRATEGY_SESSION_URL.replace(/&/g, "&amp;")}"`);
    expect(h).toContain("Book your Legal Strategy Session");
    expect(h).toContain(WORKSHEET_FOOTER);
    expect(h).toContain("This is a record of what you entered. It is not a legal assessment.");
    expect(h).toContain("Hi Ana,");
    expect(h).toContain("2 · Slogans and taglines");
    expect(h).toContain("Nothing added.");
    expect(h).toContain("Rivera Roasters");
    expect(h).toContain("Already using · Both");
    expect(h).not.toMatch(/\bfree\b|discount|<script/i);
    expect(h.match(/href="/g)).toHaveLength(1);
  });

  it("escapes everything the attendee typed", () => {
    const evil = `<script>alert(1)</script> <a href="http://evil.test">x</a> "q" 'a' &amp; Tom & Jerry`;
    const v = parse({
      contact: { firstName: evil, lastName: "<b>L</b>", email: "a@example.com", business: evil },
      answers: {
        groups: { business: [{ name: evil, using: evil, where: evil }] },
        extra: { dba: evil, searched: evil, handles: evil },
        logo: { has: evil, who: evil, contractors: [evil], agreement: evil },
        creativeWork: { written: evil, visual: evil, registered: evil },
        nextStep: { priority: evil, talk: evil },
      },
    });
    const h = attendeeHtml(v, now);
    expect(h).not.toContain("<script");
    expect(h).not.toContain("<a href=\"http://evil.test");
    expect(h).not.toContain("<b>L</b>");
    expect(h).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(h).toContain("&lt;a href=&quot;http://evil.test&quot;&gt;x&lt;/a&gt;");
    expect(h).toContain("&amp;amp; Tom &amp; Jerry");
    expect(h).toContain("&#39;a&#39;");
    expect(h.match(/href="/g)).toHaveLength(1);
    expect(esc(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("is passed to the mailer for the attendee only, and sent as Resend's html", async () => {
    const s = setup();
    await s.post(body());
    const [copy, notice] = s.mail.mock.calls.map((c) => c[0]);
    expect(copy.html).toContain(WORKSHEET_LOGO_URL);
    expect(notice.html).toBeUndefined();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    await sendInternalMail({ apiKey: "k", from: "a@b.c", to: ["x@y.z"], subject: "s", text: "t", html: "<p>h</p>", fetchImpl: fetchImpl as never });
    const sent = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(sent.html).toBe("<p>h</p>");
    expect(sent.text).toBe("t");
  });
});

describe("rate limit", () => {
  it("refuses a fifth submission for one email within the window, writing nothing for it", async () => {
    const s = setup();
    const ids = ["a", "b", "c", "d", "e"].map((c) => UUID.replace(/^3/, c));
    const codes = [];
    for (const id of ids) codes.push((await s.post(body({ submissionId: id }))).status);
    expect(codes).toEqual([200, 200, 200, 200, 429]);
    expect(s.start).toHaveBeenCalledTimes(4);
  });
});

describe("logging", () => {
  it("the route and handler log no names, addresses or answers", () => {
    const src = readFileSync("src/lib/worksheet/handle.ts", "utf8") + readFileSync("src/app/api/worksheet/route.ts", "utf8");
    const logs = src.split("\n").filter((l) => /console\.(log|error|warn)/.test(l));
    for (const l of logs) expect(l).not.toMatch(/contact|email|input\.|answers|name/);
  });
});
