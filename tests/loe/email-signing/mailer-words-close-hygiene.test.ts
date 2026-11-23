import { beforeEach, describe, expect, it, vi } from "vitest";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/server", () => ({ after: () => {} }));

import { createRateLimiter } from "@/lib/feedback/rate-limit";
import { MAX_ATTACHMENT_BYTES, sendInternalMail } from "@/lib/mail/internal-mail";
import { closeOnChange } from "@/lib/loe/email-signing/close-on-change";
import { runApproveWords, runSaveWordsDraft, runStartWordsDraft, type WordsDeps } from "@/lib/loe/signing-words-actions";
import { wordsErrorSentence, WORDS_NOT_ALLOWED, WORDS_NOT_SET_UP } from "@/lib/loe/signing-words-errors";
import type { Role } from "@/lib/auth/roles";
import { fakeDb } from "../../proposals/public-db-double";
import { NOW, TOKEN, world } from "../../proposals/signing-world";

/* ── T7 the mailer ─────────────────────────────────────────────────────────────────────────────────────────────────── */

function capture(status = 200) {
  const bodies: Array<Record<string, unknown>> = [];
  const headers: Array<Record<string, string>> = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)));
    headers.push(init.headers as Record<string, string>);
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
  return { bodies, headers, fetchImpl };
}
const base = { apiKey: "re_test", from: "Sample Firm <s@firm.example>", to: ["client@example.com"], subject: "S", text: "T" };

describe("T7 the one mailer", () => {
  it("attachments go base64-encoded as Resend's { filename, content }", async () => {
    const c = capture();
    const bytes = new Uint8Array([1, 2, 3, 250]);
    expect(await sendInternalMail({ ...base, fetchImpl: c.fetchImpl, attachments: [{ filename: "a.pdf", content: bytes, contentType: "application/pdf" }], idempotencyKey: "signing-link:r1" })).toEqual({ status: "sent" });
    expect(c.bodies[0].attachments).toEqual([{ filename: "a.pdf", content: Buffer.from(bytes).toString("base64") }]);
    expect(c.headers[0]["Idempotency-Key"]).toBe("signing-link:r1");
  });
  it("over 2 attachments or over 10 MB: failed, and NO request is made", async () => {
    const c = capture();
    const one = { filename: "a.pdf", content: new Uint8Array(1), contentType: "application/pdf" as const };
    expect(await sendInternalMail({ ...base, fetchImpl: c.fetchImpl, attachments: [one, one, one] })).toEqual({ status: "failed", http: null, local: true });
    expect(await sendInternalMail({ ...base, fetchImpl: c.fetchImpl, attachments: [{ ...one, content: new Uint8Array(MAX_ATTACHMENT_BYTES + 1) }] })).toEqual({ status: "failed", http: null, local: true });
    expect(c.bodies).toEqual([]);
  });
  it("existing callers' request bodies are unchanged (no attachments key)", async () => {
    const c = capture();
    await sendInternalMail({ ...base, replyTo: "r@x.example", html: "<p>h</p>", fetchImpl: c.fetchImpl });
    expect(c.bodies[0]).toEqual({ from: base.from, to: base.to, reply_to: "r@x.example", subject: "S", text: "T", html: "<p>h</p>" });
  });
  it("an HTTP refusal keeps its status; no answer is http null (uncertain)", async () => {
    expect(await sendInternalMail({ ...base, fetchImpl: capture(422).fetchImpl })).toEqual({ status: "failed", http: 422 });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await sendInternalMail({ ...base, fetchImpl: (async () => Promise.reject(new Error("net"))) as unknown as typeof fetch })).toEqual({ status: "failed", http: null });
    err.mockRestore();
  });
});

/* ── T13 the close action ──────────────────────────────────────────────────────────────────────────────────────────── */

describe("T13 closeSigningLinkAction's core", () => {
  const limiter = () => createRateLimiter({ max: 20, windowMs: 3_600_000 });
  function closing(proposal: Record<string, unknown> = {}) {
    return world({
      proposal: { expires_on: "2026-12-31", ...proposal },
      rpcImpl: (fn, args, tables) => {
        if (fn !== "client_proposal_signing_close") return { data: null, error: { code: "42883" } };
        const r = (tables.client_proposal_signing_request ?? []).find((x) => x.id === args.p_request_id && (x.status === "open" || x.status === "sending"));
        if (r) r.status = "closed";
        return { data: !!r, error: null };
      },
    });
  }
  it("closes the in-flight request of THIS proposal with proposal_changed", async () => {
    const w = closing();
    w.tables.client_proposal_signing_request = [
      { id: "r-open", proposal_id: "prop-2", org_id: "org-1", status: "open", created_at: "2026-10-20T00:00:00Z" },
      { id: "r-old", proposal_id: "prop-2", org_id: "org-1", status: "closed", created_at: "2026-10-19T00:00:00Z" },
      { id: "r-other", proposal_id: "prop-9", org_id: "org-1", status: "open", created_at: "2026-10-20T00:00:00Z" },
    ];
    expect(await closeOnChange(TOKEN, { db: w.db, now: NOW, limiter: limiter() })).toEqual({ closed: true });
    expect(w.rpcCalls).toEqual([{ fn: "client_proposal_signing_close", args: { p_request_id: "r-open", p_reason: "proposal_changed" } }]);
  });
  it("a bad token, a withdrawn proposal or the limiter writes nothing", async () => {
    const w = closing({ status: "withdrawn" });
    w.tables.client_proposal_signing_request = [{ id: "r-open", proposal_id: "prop-2", org_id: "org-1", status: "open" }];
    expect(await closeOnChange(TOKEN, { db: w.db, now: NOW, limiter: limiter() })).toEqual({ closed: false });
    expect(await closeOnChange("bad", { db: w.db, now: NOW, limiter: limiter() })).toEqual({ closed: false });
    const live = closing();
    live.tables.client_proposal_signing_request = [{ id: "r-open", proposal_id: "prop-2", org_id: "org-1", status: "open" }];
    expect(await closeOnChange(TOKEN, { db: live.db, now: NOW, limiter: createRateLimiter({ max: 0, windowMs: 1 }) })).toEqual({ closed: false });
    expect([...w.rpcCalls, ...live.rpcCalls]).toEqual([]);
  });
  it("nothing in flight: closed false", async () => {
    const w = closing();
    expect(await closeOnChange(TOKEN, { db: w.db, now: NOW, limiter: limiter() })).toEqual({ closed: false });
    expect(fakeDb).toBeTypeOf("function");
  });
});

/* ── T5 the signing words actions ──────────────────────────────────────────────────────────────────────────────────── */

const WORDS = {
  consent_line: "L",
  consent_text: "T",
  sign_line: "S",
  box_note: "B",
  link_subject: "Subj",
  link_body: "Body {{signing_link}}",
  copy_subject: "CS",
  copy_body: "CB",
};
const ID = "0c0c0c0c-0000-4000-8000-000000000003";
function form(values: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}
function deps(role: Role | null, over: Partial<WordsDeps> = {}) {
  const order: string[] = [];
  const d: WordsDeps = {
    requireModule: async () => void order.push("module"),
    role: async () => (order.push("role"), role),
    isApprover: async () => true,
    orgId: async () => "org",
    readVersion: async () => (order.push("read"), { status: "ok", version: { ...WORDS, id: ID, version: 1, status: "draft", updatedAt: "x", approvedAt: null } }),
    createDraft: async () => (order.push("create"), { ok: true, id: ID }),
    saveDraft: async () => (order.push("save"), { ok: true, id: ID }),
    approve: async () => (order.push("approve"), { ok: true, id: ID }),
    revalidate: () => {},
    ...over,
  };
  return { d, order };
}

describe("T5 the signing words actions", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("the module gate and the role come BEFORE any read; a non-admin is refused", async () => {
    const { d, order } = deps("paralegal");
    expect(await runStartWordsDraft(d, form(WORDS))).toEqual({ error: WORDS_NOT_ALLOWED });
    expect(await runSaveWordsDraft(d, form({ ...WORDS, id: ID }))).toEqual({ error: WORDS_NOT_ALLOWED });
    expect(order).toEqual(["module", "role", "module", "role"]);
  });
  it("the admin tier starts and saves a draft", async () => {
    const { d, order } = deps("admin");
    expect(await runStartWordsDraft(d, form(WORDS))).toEqual({ saved: true });
    expect(await runSaveWordsDraft(d, form({ ...WORDS, id: ID }))).toEqual({ saved: true });
    expect(order).toEqual(["module", "role", "create", "module", "role", "save"]);
  });
  it("a draft may hold a merge-field problem but not an empty field; Approve refuses both", async () => {
    const { d } = deps("admin");
    expect((await runStartWordsDraft(d, form({ ...WORDS, consent_text: " " }))).error).toBe("Consent text is empty.");
    const saved = await runSaveWordsDraft(d, form({ ...WORDS, id: ID, link_body: "no link" }));
    expect(saved.saved).toBe(true);
    expect(saved.issues?.[0].message).toBe("Signing link email body uses a merge field it may not use.");
    const bad = deps("attorney", { readVersion: async () => ({ status: "ok", version: { ...WORDS, link_body: "no link", id: ID, version: 1, status: "draft", updatedAt: "x", approvedAt: null } }) });
    expect((await runApproveWords(bad.d, form({ id: ID }))).error).toBe("Signing link email body uses a merge field it may not use.");
  });
  it("Approve: a named approver with a writing role only", async () => {
    expect(await runApproveWords(deps("viewer").d, form({ id: ID }))).toEqual({ error: WORDS_NOT_ALLOWED });
    expect((await runApproveWords(deps("attorney", { isApprover: async () => false }).d, form({ id: ID }))).error).toBe("Only the firm's named approvers can approve the signing words.");
    expect((await runApproveWords(deps("attorney", { isApprover: async () => null }).d, form({ id: ID }))).error).toMatch(/couldn't be loaded/);
    expect(await runApproveWords(deps("attorney").d, form({ id: ID }))).toEqual({ saved: true, notice: "Approved. New signing links use these words." });
  });
  it("0117's prefixes map to fixed sentences; a missing table is 'not switched on'", () => {
    for (const p of ["signing_words_not_approver", "signing_words_edit_admin_only", "signing_words_frozen", "signing_words_bad_transition", "signing_words_fields_invalid"]) {
      expect(wordsErrorSentence({ message: `${p}: raw database text` })).not.toMatch(/raw database text|signing_words/);
    }
    expect(wordsErrorSentence({ code: "42P01" })).toBe(WORDS_NOT_SET_UP);
    expect(wordsErrorSentence({ code: "42501", message: "x" })).toBe(WORDS_NOT_ALLOWED);
    expect(wordsErrorSentence({ code: "23505" })).toMatch(/already a draft/);
  });
  it("no words text in any log", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    await runStartWordsDraft(deps("admin", { createDraft: async () => ({ ok: false, error: "x" }) }).d, form(WORDS));
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    for (const f of ["src/lib/loe/signing-words.ts", "src/lib/loe/signing-words-actions.ts", "src/lib/loe/signing-words-store.ts", "src/lib/loe/signing-words-errors.ts"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(/\bconsole\./);
    }
  });
});

/* ── T12 hygiene ───────────────────────────────────────────────────────────────────────────────────────────────────── */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const BASE = "62868c1";

describe("T12 hygiene", () => {
  it("no new dependency; pricing.ts has no diff", () => {
    const pkg = execSync(`git diff ${BASE} -- package.json pnpm-lock.yaml`, { encoding: "utf8" });
    expect(pkg).toBe("");
    expect(execSync(`git diff ${BASE} -- src/lib/proposals/pricing.ts`, { encoding: "utf8" })).toBe("");
  });
  it("api.resend.com appears only in the one mailer", () => {
    const hits = walk("src").filter((f) => readFileSync(f, "utf8").includes("api.resend.com"));
    expect(hits).toEqual([join("src", "lib", "mail", "internal-mail.ts")]);
  });
  it("no console call and no admin import in the email-signing modules apart from the public entry's use of the public module", () => {
    for (const f of walk("src/lib/loe/email-signing")) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/\bconsole\./);
      expect(src, f).not.toMatch(/@\/lib\/db\/admin|getAdminClient/);
    }
    for (const f of walk("src/components/client-proposal/sign-link")) expect(readFileSync(f, "utf8"), f).not.toMatch(/\bconsole\.|dangerouslySetInnerHTML/);
  });
  it("every string in item 19's table is present verbatim, and none uses legal-sounding words", async () => {
    const w = await import("@/lib/loe/client-words");
    const ui = await import("@/lib/ui/words");
    const table: Array<[string, string]> = [
      [w.EMAIL_LINK_LABEL, "Email me a link to sign"],
      [w.linkSentNote("{masked}"), "We emailed a signing link to {masked}. It works for 7 days."],
      [w.LINK_UNAVAILABLE, "This link is no longer available."],
      [w.LINK_CLOSED_NOTE, "Your earlier signing link no longer works. Email yourself a new one on step 3."],
      [w.SEND_MESSAGES.unavailable, "Something on this page changed. Reload the page to continue."],
      [w.SEND_MESSAGES.send_failed, "We couldn't send the email. Try again."],
      [w.SEND_MESSAGES.sign_here_instead, "We couldn't send the email. Reload the page to sign here instead."],
      [w.SEND_MESSAGES.uncertain, "We may not have sent the email. Check your inbox. If the link isn't there in a few minutes, press the button again."],
      [w.SEND_MESSAGES.superseded, "This proposal changed or a newer link was sent. Reload the page."],
      [w.SIGN_MESSAGES.signing_by_email, "Reload this page to get your signing link by email."],
      [w.SIGN_LINK_MESSAGES.name_mismatch, "Type your full legal name as it appears on the letter."],
      [w.SIGN_LINK_MESSAGES.retry, "We couldn't record your signature. Please try again."],
      [w.SIGN_LINK_MESSAGES.reload, "Reload this page."],
      [w.SIGN_LINK_MESSAGES.try_again, "Please try again."],
      [w.CONSENT_STEP_NAME, "Before you sign"],
      [w.SIGNATURE_STEP_NAME, "Your signature"],
      [w.CLEAR_LABEL, "Clear"],
      [w.TYPE_INSTEAD_LABEL, "Type it instead"],
      [w.DRAW_INSTEAD_LABEL, "Draw it instead"],
      [w.TYPED_SIGNATURE_LABEL, "Typed signature"],
      [ui.SIGNING_WORDS_STATUS_ON, "Clients get a signing link by email. If a check fails, they sign on the proposal page as before."],
    ];
    const denied = /legally binding|electronic signature act|\bESIGN\b|\bUETA\b|consent to/i;
    for (const [got, want] of table) {
      expect(got).toBe(want);
      expect(got).not.toMatch(denied);
    }
    // Nothing the builders added in this sprint uses those words anywhere in the client words file or the signing words labels.
    const added = readFileSync("src/lib/loe/client-words.ts", "utf8").split("The emailed signing link (lectual 0117")[1] ?? "";
    expect(added.length).toBeGreaterThan(0);
    expect(added).not.toMatch(denied);
    const settings = readFileSync("src/lib/ui/words.ts", "utf8").split("// Signing words (lectual 0117")[1] ?? "";
    expect(settings).not.toMatch(denied);
  });
  it("the only /p/<token>/ URL builder is still client-link-origin.ts, and the ?sign= link is built from it", () => {
    expect(readFileSync("src/lib/loe/email-signing/link-send.ts", "utf8")).toMatch(/signingLinkUrl\(clientLinkUrl\(origin, token\), signToken\)/);
  });
});
