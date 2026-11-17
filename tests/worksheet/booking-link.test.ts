import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { handleWorksheetPost, type WorksheetDeps } from "@/lib/worksheet/handle";
import { SlidingWindowThrottle } from "@/lib/intake-forms/spam";
import { attendeeCopy } from "@/lib/worksheet/email";
import { parseWorksheetBody } from "@/lib/worksheet/schema";
import { pickBookingLink } from "@/lib/worksheet/booking-link";
import { STRATEGY_SESSION_URL } from "@/lib/worksheet/answers";
import { publicConfig, defaultIntakeConfig } from "@/lib/intake-forms/config";
import type { IntakeHandle } from "@/lib/intake-forms/public";

const ORIGIN = "https://masterclass.rpblawfirm.com";
const UUID = "3f1c2b9e-8a4d-4c6e-9b1a-2d3e4f5a6b7c";
const PERSONAL = "https://app.lawmatics.com/forms/share/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const SENTENCE = "Your booking form is already filled in with your details.";

const HANDLE: IntakeHandle = {
  formId: "form-rpb",
  orgId: "org-rpb",
  slug: "masterclass",
  name: "Master class worksheet",
  sourceTag: "Master Class",
  kind: "intake",
  config: { questions: [], packs: [] } as never,
  orgName: "RPB Law Firm",
  receivesReferrals: false,
};

const BODY = {
  submissionId: UUID,
  submittedAt: "2026-11-17T23:30:00.000Z",
  source: "ip-masterclass-worksheet",
  event: "E",
  contact: { firstName: "Ana", lastName: "Rivera", email: "Ana@Example.com", business: "Rivera Roasters", mobile: "555 123 4567" },
  consent: { given: true, text: "Send me a copy of my worksheet and follow-up from RPB Law Firm by email." },
  answers: {
    groups: { business: [{ name: "Rivera Roasters", using: "Already using", where: "Both" }], slogan: [{ name: "", using: "", where: "" }] },
    extra: { dba: "", searched: "No", handles: "@rivera" },
    logo: { has: "Yes", who: "I did", contractors: ["None of these"], agreement: "" },
    creativeWork: { written: "A blog", visual: "", registered: "No" },
    nextStep: { priority: "Rivera Roasters", talk: "Yes, I'd like to book a Legal Strategy Session" },
  },
  summaryText: "x",
};

function run(bookingLinkFor?: WorksheetDeps["bookingLinkFor"]) {
  const rows = new Map<string, string>();
  const mail = vi.fn<WorksheetDeps["mail"]>(async () => ({ status: "sent" }));
  const deps: WorksheetDeps = {
    readHandle: async () => ({ status: "ok", handle: HANDLE }),
    start: async (_h, s, ctx) => {
      rows.set(ctx.token, s.contact.email);
      return { ok: true, submissionId: "sub-1", token: ctx.token, leadId: "lead-1" };
    },
    complete: async (_h, token, answers, mode) => {
      const email = rows.get(token);
      if (!email) return { ok: false, reason: "not_found" };
      return { ok: true, submissionId: "sub-1", submission: { mode, contact: { name: "A", email, phone: "", company: "" }, answers }, alreadyDone: false, noteBody: "n", utm: {} };
    },
    recordEvent: async () => {},
    mail,
    ...(bookingLinkFor ? { bookingLinkFor } : {}),
    now: () => new Date("2026-11-17T23:30:00Z"),
    ipThrottle: new SlidingWindowThrottle(20, 600_000),
    emailThrottle: new SlidingWindowThrottle(4, 600_000),
    inFlight: new Set(),
    config: {
      slug: "masterclass",
      allowedOrigins: [ORIGIN],
      notifyTo: ["support@rpblawfirm.com"],
      from: "RPB <events@rpblawfirm.com>",
      replyTo: null,
      resendKey: "re_test",
      tokenKey: "salt",
      lawmaticsSync: false,
    },
  };
  const m = new Map<string, string>([["origin", ORIGIN], ["content-type", "application/json"], ["x-forwarded-for", "203.0.113.9"]]);
  const post = () => handleWorksheetPost({ headers: { get: (k) => m.get(k.toLowerCase()) ?? null }, rawBody: JSON.stringify(BODY) }, deps);
  const sent = () => {
    const calls = mail.mock.calls.map((c) => c[0]);
    return { copy: calls.find((c) => c.to[0] === "Ana@Example.com".toLowerCase() || c.to.includes("ana@example.com"))!, notice: calls.find((c) => c.to.includes("support@rpblawfirm.com"))! };
  };
  return { post, sent };
}

describe("personal booking link in the attendee email", () => {
  it("uses the personal link, matched case-insensitively on the email", async () => {
    const lookup = vi.fn(async (..._a: string[]) => PERSONAL);
    const s = run(lookup);
    await s.post();
    expect(lookup).toHaveBeenCalledWith("form-rpb", "ana@example.com");
    const { copy } = s.sent();
    expect(copy.html).toContain(`href="${PERSONAL}"`);
    expect(copy.html).toContain(SENTENCE);
    expect(copy.text).toContain(PERSONAL);
    expect(copy.text).toContain(SENTENCE);
    expect(copy.html).not.toContain("rpblawfirm.com/sessions");
    expect(copy.text).not.toContain(STRATEGY_SESSION_URL);
  });

  it.each([
    ["no match", async () => null],
    ["malformed link", async () => "http://app.lawmatics.com/forms/share/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"],
    ["wrong host", async () => "https://evil.example/forms/share/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"],
    ["read throws", async () => { throw new Error("db down"); }],
  ])("falls back to the general link: %s", async (_n, fn) => {
    const s = run(fn as never);
    const r = await s.post();
    expect(r.status).toBe(200);
    const { copy } = s.sent();
    expect(copy.html).toContain(STRATEGY_SESSION_URL.replace(/&/g, "&amp;"));
    expect(copy.text).toContain(STRATEGY_SESSION_URL);
    expect(copy.html).not.toContain(SENTENCE);
    expect(copy.text).not.toContain(SENTENCE);
  });

  it("keeps the personal link out of the response and the firm notice", async () => {
    const s = run(async () => PERSONAL);
    const r = await s.post();
    expect(JSON.stringify(r)).not.toContain("lawmatics");
    const { notice } = s.sent();
    expect(JSON.stringify(notice)).not.toContain(PERSONAL);
    expect(JSON.stringify(notice)).not.toContain(SENTENCE);
  });

  it("general output is byte-identical to the pre-change email", () => {
    const p = parseWorksheetBody(JSON.stringify(BODY));
    if (!p.ok) throw new Error("bad body");
    const m = attendeeCopy(p.value, { now: new Date("2026-11-17T23:30:00Z") });
    const h = (x: string) => createHash("sha256").update(x).digest("hex");
    // Hashes taken from the unchanged code at origin/main before this change.
    expect(h(m.text)).toBe("854fa9e3064b16a70254e3f5efae74b19853aa6e15de35b26fc1ba707f2ceb73");
    expect(h(m.html!)).toBe("76cf7a74f19643767c65c0ed0285ab429e8b0e6b1d48cd2717b718f5c55016f4");
  });
});

describe("pickBookingLink", () => {
  it("reads only an exact lowercased key with a well-formed link", () => {
    const cfg = { bookingLinks: { "ana@example.com": PERSONAL, "bad@example.com": "https://x.example/" } };
    expect(pickBookingLink(cfg, "  Ana@Example.com ")).toBe(PERSONAL);
    expect(pickBookingLink(cfg, "bad@example.com")).toBeNull();
    expect(pickBookingLink(cfg, "other@example.com")).toBeNull();
    expect(pickBookingLink(cfg, "__proto__")).toBeNull();
    expect(pickBookingLink(null, "a@b.co")).toBeNull();
    expect(pickBookingLink({ bookingLinks: [PERSONAL] }, "a@b.co")).toBeNull();
  });
});

describe("public reads never carry bookingLinks", () => {
  it("publicConfig drops it", () => {
    const cfg = { ...defaultIntakeConfig([]), bookingLinks: { "ana@example.com": PERSONAL } };
    const json = JSON.stringify(publicConfig(cfg as never, { orgName: "RPB", receivesReferrals: false }));
    expect(json).not.toContain("bookingLinks");
    expect(json).not.toContain("lawmatics.com");
  });
});
