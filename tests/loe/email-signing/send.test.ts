import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ after: vi.fn<(fn: () => unknown) => void>(), runAcceptanceFollowups: vi.fn(async () => {}) }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/proposals/accept-followups", () => ({ runAcceptanceFollowups: mocks.runAcceptanceFollowups }));

import { createHash } from "node:crypto";
import { createRateLimiter } from "@/lib/feedback/rate-limit";
import { SEND_MESSAGES, SIGN_MESSAGES } from "@/lib/loe/client-words";
import { linkExpiresAt, LINK_LIFETIME_MS, sendSigningLink, type SendDeps } from "@/lib/loe/email-signing/link-send";
import { localFailures, resetLocalFailures } from "@/lib/loe/email-signing/failure-memo";
import { resetSigningNotSetUp, signingNotSetUp } from "@/lib/loe/email-signing/not-set-up";
import type { Readiness } from "@/lib/loe/email-signing/ready";
import { wordsSha256 } from "@/lib/loe/signing-words";
import { acceptPublicProposal } from "@/lib/proposals/public";
import type { InternalMail, InternalMailResult } from "@/lib/mail/internal-mail";
import { NOW, TOKEN, browserSigning, world } from "../../proposals/signing-world";
import type { Row } from "../../proposals/public-db-double";
import { TEST_DETAILS } from "../full-letter-fixture";
import { WORDS_ROW } from "./fake-db";
import { defaultSelection } from "@/lib/proposals/pricing";
import { twoBrandPerMark, withLoe } from "../loe-fixtures";

const SELECTION = defaultSelection(withLoe(twoBrandPerMark()));

beforeEach(() => {
  mocks.after.mockReset();
  resetLocalFailures();
  resetSigningNotSetUp();
});

const REQ = "11111111-2222-4333-8444-555555555555";
const BYTES = Buffer.alloc(32, 7);
const SIGN_TOKEN = BYTES.toString("base64url");
const PDF = new Uint8Array([37, 80, 68, 70, 45, 49]);

type Answer = { data: unknown; error: { code?: string; message?: string } | null } | "throw";

/** A world plus a programmable 0117: each signing_* function answers from `plan` (a list is consumed in order). */
function setup(plan: Record<string, Answer | Answer[]> = {}, opts: { readiness?: Readiness | "off"; failuresAfter?: number } = {}) {
  const counters: Record<string, number> = {};
  const w = world({
    proposal: { expires_on: "2026-12-31" },
    rpcImpl: (fn, args, tables) => {
      const p = plan[fn];
      let a: Answer | undefined;
      if (Array.isArray(p)) {
        const i = counters[fn] ?? 0;
        counters[fn] = i + 1;
        a = p[Math.min(i, p.length - 1)];
      } else a = p;
      if (a === "throw") throw new Error("network");
      if (a) return a;
      if (fn === "client_proposal_signing_open") {
        (tables.client_proposal_signing_request ??= []).push({ id: REQ, org_id: "org-1", status: "sending" });
        return { data: REQ, error: null };
      }
      if (fn === "client_proposal_signing_mark_sent") return { data: true, error: null };
      if (fn === "client_proposal_signing_note_failure") return { data: true, error: null };
      if (fn === "client_proposal_signing_close") return { data: true, error: null };
      if (fn === "client_proposal_signing_readiness") return { data: { state: "ok", failures: opts.failuresAfter ?? 1 }, error: null };
      return { data: null, error: { code: "42883", message: "no such function" } };
    },
  });
  const mails: InternalMail[] = [];
  let mailAnswer: InternalMailResult | "throw" = { status: "sent" };
  const readiness: Readiness =
    opts.readiness === "off"
      ? { ready: false, gate: null, failures: null }
      : opts.readiness ?? {
          ready: true,
          gate: { on: true, words: { ...WORDS_ROW }, from: "Sample Firm <signing@sample-firm.example>" },
          row: { orgId: "org-1", proposalId: "prop-2", familyId: "prop-1", version: 2, content: (w.tables.client_proposal[0] as Row).content as never, clientEmail: "  callum@example.com " },
        };
  const deps: SendDeps = {
    db: w.db,
    readiness: async () => readiness,
    mailer: async (m) => {
      mails.push(m);
      if (mailAnswer === "throw") throw new Error("x");
      return mailAnswer;
    },
    randomBytes: () => BYTES,
    linkOrigin: async () => "https://proposals.sample-firm.example",
    reviewPdf: async () => PDF,
    apiKey: "re_test",
    limiters: { token: createRateLimiter({ max: 5, windowMs: 3600_000 }), address: createRateLimiter({ max: 20, windowMs: 3600_000 }) },
  };
  return { w, deps, mails, setMail: (a: InternalMailResult | "throw") => (mailAnswer = a), fns: () => w.rpcCalls.map((c) => c.fn) };
}

const input = (over: Record<string, unknown> = {}) => ({ token: TOKEN, selection: SELECTION as unknown, clientClasses: undefined, details: TEST_DETAILS, ip: "203.0.113.9", now: NOW, ...over });

describe("T6 sending the link", () => {
  it("one open, the stored-text PDF, one email to the PROPOSAL's address with the idempotency key, then mark_sent", async () => {
    const s = setup();
    const r = await sendSigningLink(input({ details: { ...TEST_DETAILS, email: "attacker@evil.example" } }), s.deps);
    expect(r).toEqual({ ok: true, sentTo: "c•••@example.com", expiresText: "October 27, 2026" });
    expect(s.fns()).toEqual(["client_proposal_signing_open", "client_proposal_signing_mark_sent"]);
    const open = s.w.rpcCalls[0].args;
    // Only the token's sha256 goes to the database; the token itself is 43 base64url characters and travels only in the email.
    expect(SIGN_TOKEN).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(open.p_token_sha256).toBe(createHash("sha256").update(SIGN_TOKEN).digest("hex"));
    expect(JSON.stringify(open)).not.toContain(SIGN_TOKEN);
    expect(open.p_words_id).toBe(WORDS_ROW.id);
    expect(open.p_words_sha256).toBe(wordsSha256(WORDS_ROW));
    expect(open.p_signer_name).toBe("Callum Ferreira");
    expect(s.mails).toHaveLength(1);
    const m = s.mails[0];
    expect(m.to).toEqual(["callum@example.com"]);
    expect(m.from).toBe("Sample Firm <signing@sample-firm.example>");
    expect(m.idempotencyKey).toBe(`signing-link:${REQ}`);
    expect(m.text).toContain(`https://proposals.sample-firm.example/p/${TOKEN}/?sign=${SIGN_TOKEN}`);
    expect(m.subject).toBe("Your letter from RPB Law Firm");
    expect(m.attachments?.[0]).toMatchObject({ filename: "Callum-Ferreira-engagement-letter-review.pdf", contentType: "application/pdf" });
    expect(m.attachments?.[0].content).toBe(PDF);
    const stamped = (s.w.tables.client_proposal_signing_request as Row[])[0];
    expect(stamped.review_pdf_sha256).toBe(createHash("sha256").update(PDF).digest("hex"));
  });

  it("the agreement equals the in-app path's for the same inputs (same clock: dates equal too)", async () => {
    const s = setup();
    await sendSigningLink(input(), s.deps);
    const sent = String(s.w.rpcCalls[0].args.p_agreement_text);
    const inApp = world({ proposal: { expires_on: "2026-12-31" } });
    const b = await browserSigning(inApp.db, { typedName: "Callum Ferreira" });
    const r = await acceptPublicProposal(TOKEN, b.selection, NOW, inApp.db, undefined, b.signing);
    expect(r.ok).toBe(true);
    expect(sent).toBe(String(inApp.rpcCalls[0].args.p_agreement_text));
    expect(s.w.rpcCalls[0].args.p_agreement_sha256).toBe(inApp.rpcCalls[0].args.p_agreement_sha256);
  });

  it("gate or readiness off: refused with the reload sentence, nothing written, no mail", async () => {
    const s = setup({}, { readiness: "off" });
    expect(await sendSigningLink(input(), s.deps)).toEqual({ ok: false, message: SEND_MESSAGES.unavailable });
    expect(s.fns()).toEqual([]);
    expect(s.mails).toEqual([]);
  });

  it("the client's own input is refused before ANY rpc and is never counted (limiter, details, an undescribed class, nothing selected)", async () => {
    const s = setup();
    expect(await sendSigningLink(input({ details: { ...TEST_DETAILS, street: "" } }), s.deps)).toEqual({ ok: false, message: SIGN_MESSAGES.details_required });
    expect(await sendSigningLink(input({ selection: { "fold-word": false, "fold-logo": false, "ci-word": false, "ci-logo": false } }), s.deps)).toMatchObject({ ok: false });
    const limited = setup();
    limited.deps.limiters = { token: createRateLimiter({ max: 0, windowMs: 1 }), address: createRateLimiter({ max: 20, windowMs: 1 }) };
    expect(await sendSigningLink(input(), limited.deps)).toEqual({ ok: false, message: SEND_MESSAGES.send_failed });
    expect(s.fns()).toEqual([]);
    expect(limited.fns()).toEqual([]);
    expect(localFailures("prop-2")).toBe(0);
  });

  it("logs nothing: no address, token, letter or words on the console", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    const s = setup();
    s.setMail({ status: "failed", http: 422 });
    await sendSigningLink(input(), s.deps);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("T18 the link's expiry", () => {
  it("now + 7 days - 5 minutes, or the proposal's last day in the firm's zone when earlier", () => {
    expect(linkExpiresAt(NOW, null, "America/New_York").getTime()).toBe(NOW.getTime() + LINK_LIFETIME_MS);
    expect(LINK_LIFETIME_MS).toBe(7 * 86_400_000 - 300_000);
    expect(linkExpiresAt(NOW, "2026-10-22", "America/New_York").toISOString()).toBe("2026-10-23T03:59:59.000Z");
  });
  it("the email went but mark_sent answers false: superseded, nothing counted", async () => {
    const s = setup({ client_proposal_signing_mark_sent: { data: false, error: null } });
    expect(await sendSigningLink(input(), s.deps)).toEqual({ ok: false, message: SEND_MESSAGES.superseded });
    expect(s.fns()).not.toContain("client_proposal_signing_note_failure");
  });
});

describe("T19 every failure after the request exists closes it and is counted", () => {
  const closed = (s: ReturnType<typeof setup>) => s.w.rpcCalls.filter((c) => c.fn === "client_proposal_signing_mark_sent" && c.args.p_sent === false).length;

  it("(a) the review PDF build throws", async () => {
    const s = setup();
    s.deps.reviewPdf = async () => {
      throw new Error("pdf");
    };
    expect(await sendSigningLink(input(), s.deps)).toEqual({ ok: false, message: SEND_MESSAGES.send_failed });
    expect(closed(s)).toBe(1);
    expect(s.mails).toEqual([]);
  });
  it("(b) the review_pdf_sha256 update updates no row", async () => {
    const s = setup({
      client_proposal_signing_open: { data: REQ, error: null },
    });
    expect(await sendSigningLink(input(), s.deps)).toEqual({ ok: false, message: SEND_MESSAGES.send_failed });
    expect(closed(s)).toBe(1);
    expect(s.mails).toEqual([]);
  });
  it("(c) the mailer answers failed with an HTTP status; (d) the mailer throws", async () => {
    for (const a of [{ status: "failed", http: 500 } as InternalMailResult, "throw" as const]) {
      const s = setup();
      s.setMail(a);
      expect(await sendSigningLink(input(), s.deps)).toEqual({ ok: false, message: SEND_MESSAGES.send_failed });
      expect(closed(s)).toBe(1);
      expect(s.w.rpcCalls.some((c) => c.fn === "client_proposal_signing_mark_sent" && c.args.p_sent === true)).toBe(false);
    }
  });
  it("(e) mark_sent(false) errors -> signing_close(send_failed); (f) that errors -> note_failure(close_error); (g) that errors -> local memo", async () => {
    const e = setup({ client_proposal_signing_mark_sent: { data: null, error: { code: "XX000" } } });
    e.setMail({ status: "failed", http: 500 });
    await sendSigningLink(input(), e.deps);
    expect(e.w.rpcCalls.find((c) => c.fn === "client_proposal_signing_close")?.args).toEqual({ p_request_id: REQ, p_reason: "send_failed" });

    const f = setup({ client_proposal_signing_mark_sent: { data: null, error: { code: "XX000" } }, client_proposal_signing_close: { data: null, error: { code: "XX000" } } });
    f.setMail({ status: "failed", http: 500 });
    await sendSigningLink(input(), f.deps);
    expect(f.w.rpcCalls.find((c) => c.fn === "client_proposal_signing_note_failure")?.args).toMatchObject({ p_kind: "close_error" });
    expect(localFailures("prop-2")).toBe(0);

    const g = setup({
      client_proposal_signing_mark_sent: { data: null, error: { code: "XX000" } },
      client_proposal_signing_close: { data: null, error: { code: "XX000" } },
      client_proposal_signing_note_failure: { data: null, error: { code: "XX000" } },
    });
    g.setMail({ status: "failed", http: 500 });
    await sendSigningLink(input(), g.deps);
    expect(localFailures("prop-2")).toBe(1);
  });
  it("(h) mark_sent(true) errors after the mail went -> failSend", async () => {
    const s = setup({ client_proposal_signing_mark_sent: [{ data: null, error: { code: "XX000" } }, { data: true, error: null }] });
    expect(await sendSigningLink(input(), s.deps)).toEqual({ ok: false, message: SEND_MESSAGES.send_failed });
    expect(s.w.rpcCalls.filter((c) => c.fn === "client_proposal_signing_mark_sent").map((c) => c.args.p_sent)).toEqual([true, false]);
  });
  it("(i) no HTTP answer from the mailer is uncertain: the link is kept, mail_uncertain is counted", async () => {
    const s = setup();
    s.setMail({ status: "failed", http: null });
    expect(await sendSigningLink(input(), s.deps)).toEqual({ ok: true, uncertain: true, sentTo: "c•••@example.com", expiresText: "October 27, 2026" });
    expect(s.w.rpcCalls.find((c) => c.fn === "client_proposal_signing_mark_sent")?.args.p_sent).toBe(true);
    expect(s.w.rpcCalls.find((c) => c.fn === "client_proposal_signing_note_failure")?.args.p_kind).toBe("mail_uncertain");
  });
  it("each signing_open answer gives its message and its record", async () => {
    const cases: Array<[Answer, string, string | null, boolean]> = [
      [{ data: null, error: { code: "23514", message: "signing_letter_replaced: x" } }, SEND_MESSAGES.unavailable, null, false],
      [{ data: null, error: { code: "23514", message: "signing_changed: x" } }, SEND_MESSAGES.unavailable, null, false],
      [{ data: null, error: { code: "23514", message: "signing_no_email: x" } }, SEND_MESSAGES.unavailable, null, false],
      [{ data: null, error: { code: "42883" } }, SEND_MESSAGES.unavailable, null, true],
      [{ data: null, error: { code: "PGRST202" } }, SEND_MESSAGES.unavailable, null, true],
      [{ data: null, error: { code: "23514", message: "signing_words_changed: x" } }, SEND_MESSAGES.send_failed, "open_refused", false],
      [{ data: null, error: { code: "23514", message: "signing_invalid: x" } }, SEND_MESSAGES.send_failed, "open_refused", false],
      [{ data: null, error: { code: "23505" } }, SEND_MESSAGES.send_failed, "open_error", false],
      [{ data: null, error: { code: "40P01" } }, SEND_MESSAGES.send_failed, "open_error", false],
      [{ data: null, error: { code: "XX000", message: "?" } }, SEND_MESSAGES.send_failed, "open_error", false],
      ["throw", SEND_MESSAGES.send_failed, "open_error", false],
    ];
    for (const [answer, message, kind, memo] of cases) {
      resetSigningNotSetUp();
      const s = setup({ client_proposal_signing_open: answer });
      expect(await sendSigningLink(input(), s.deps)).toEqual({ ok: false, message });
      const noted = s.w.rpcCalls.find((c) => c.fn === "client_proposal_signing_note_failure");
      expect(noted?.args.p_kind ?? null).toBe(kind);
      expect(signingNotSetUp()).toBe(memo);
      expect(s.mails).toEqual([]);
    }
  });
  it("the third counted failure answers sign_here_instead", async () => {
    const s = setup({ client_proposal_signing_open: { data: null, error: { code: "23505" } } }, { failuresAfter: 3 });
    expect(await sendSigningLink(input(), s.deps)).toEqual({ ok: false, message: SEND_MESSAGES.sign_here_instead });
  });
});
