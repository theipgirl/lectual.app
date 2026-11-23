import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));

import { createRateLimiter } from "@/lib/feedback/rate-limit";
import { LINK_UNAVAILABLE, SIGN_LINK_MESSAGES } from "@/lib/loe/client-words";
import { readSigningLink } from "@/lib/loe/email-signing/link-read";
import { recordConsent, recordOpened } from "@/lib/loe/email-signing/link-actions";
import { checkSignature, signByLink, MAX_SIGNATURE_PNG_BYTES } from "@/lib/loe/email-signing/sign";
import { sameToken, verifyLinkPair, type VerifyDeps } from "@/lib/loe/email-signing/verify";
import { resetSigningNotSetUp, signingNotSetUp } from "@/lib/loe/email-signing/not-set-up";
import { consentSha256 } from "@/lib/loe/signing-words";
import { SignByLinkPage } from "@/components/client-proposal/sign-link/SignByLinkPage";
import type { LetterCopyCheck } from "@/lib/loe/editor-state";
import { fakeSigningDb, ok, err, ORG, WORDS_ROW, type Row } from "./fake-db";
import { withLoe } from "../loe-fixtures";
import { callum } from "../../proposals/fixture";

const PUB = "P".repeat(43);
const OTHER_PUB = "Q".repeat(43);
const SIGN = "s".repeat(42) + "A";
const SHA = createHash("sha256").update(SIGN).digest("hex");
const REQ = "11111111-2222-4333-8444-555555555555";
const NOW = new Date("2026-10-20T15:00:00.000Z");
const TEXT = "First paragraph of the final letter.\n\nSecond paragraph, with a name: Sam Client.";
const sha = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");

beforeEach(() => resetSigningNotSetUp());

function world(over: { request?: Row; proposal?: Row; letter?: LetterCopyCheck; gateOn?: boolean; rpcs?: Record<string, never> } = {}) {
  const proposal: Row = { id: "p-1", org_id: ORG, public_token: PUB, status: "sent", content: withLoe(callum()), accepted_snapshot: null, pay_url: "https://pay.example/x", title: "T", ...over.proposal };
  const request: Row = {
    id: REQ,
    org_id: ORG,
    proposal_id: "p-1",
    token_sha256: SHA,
    status: "open",
    expires_at: "2026-10-25T00:00:00.000Z",
    opened_at: null,
    consent_at: null,
    signed_at: null,
    signature_id: null,
    agreement_text: TEXT,
    agreement_sha256: sha(TEXT),
    consent_line: WORDS_ROW.consent_line,
    consent_text: WORDS_ROW.consent_text,
    consent_sha256: sha(WORDS_ROW.consent_text),
    sign_line: WORDS_ROW.sign_line,
    box_note: WORDS_ROW.box_note,
    signer_name: "Sam Client",
    ...over.request,
  };
  const f = fakeSigningDb(
    {
      client_proposal: [proposal],
      client_proposal_signing_request: [request],
      crm_org: [{ id: ORG, name: "Sample Firm", slug: "sample-firm", modules: ["proposals"] }],
      crm_org_profile: [{ org_id: ORG, time_zone: "America/New_York", display_name: "Sample Firm" }],
    },
    {
      client_proposal_signing_opened: ok("open"),
      client_proposal_signing_consent: ok(true),
      client_proposal_signing_close: ok(true),
      client_proposal_signing_sign: ok([{ signature_id: "sig-1", signed_now: true, proposal_id: "p-1", signed_at: "2026-10-20T15:00:01.000Z" }]),
      ...(over.rpcs ?? {}),
    },
    { embed: (r) => ({ ...r, proposal: (proposalsById([proposal])[r.proposal_id as string] ?? null) }) },
  );
  const keys: string[] = [];
  const spy = () => {
    const inner = createRateLimiter({ max: 1000, windowMs: 3_600_000 });
    return { allowed: (k: string) => (keys.push(k), inner.allowed(k)), record: (k: string) => inner.record(k) };
  };
  const deps: VerifyDeps & { db: typeof f.db; audit: { ip: string | null; userAgent: string | null } } = {
    db: f.db,
    now: NOW,
    ip: "203.0.113.5",
    gate: async () => (over.gateOn === false ? { on: false, reason: "switch_off" } : { on: true, words: { ...WORDS_ROW }, from: "x@firm.example" }),
    letterCheck: async () => over.letter ?? "current",
    limiters: { token: spy(), address: spy() },
    audit: { ip: "203.0.113.5", userAgent: "TestBrowser/1.0" },
  };
  return { f, deps, keys, request, proposal };
}

function proposalsById(rows: Row[]): Record<string, Row> {
  return Object.fromEntries(rows.map((r) => [r.id as string, { public_token: r.public_token, status: r.status, org_id: r.org_id, content: r.content, accepted_snapshot: r.accepted_snapshot, pay_url: r.pay_url, title: r.title }]));
}

const writes = (w: ReturnType<typeof world>) => [...w.f.rpcCalls, ...w.f.calls.filter((c) => c.op === "update")];

describe("T14 the GET render writes nothing; the pair is verified before any write", () => {
  it("a valid pair reads the open letter, with no rpc and no write", async () => {
    const w = world();
    const r = await readSigningLink(PUB, SIGN, w.deps);
    expect(r.kind).toBe("open");
    if (r.kind === "open") {
      expect(r.view.paragraphs).toEqual(["First paragraph of the final letter.", "Second paragraph, with a name: Sam Client."]);
      expect(r.view.consentSha256).toBe(consentSha256(WORDS_ROW.consent_text));
      expect(JSON.stringify(r)).not.toContain(SHA);
      expect(JSON.stringify(r)).not.toContain("Sam Client\"");
    }
    expect(writes(w)).toEqual([]);
  });
  it("wrong pair, expired, gate off: unavailable, still no rpc and no write", async () => {
    for (const w of [world({ proposal: { public_token: OTHER_PUB } }), world({ request: { expires_at: "2026-10-01T00:00:00Z" } }), world({ gateOn: false })]) {
      expect(await readSigningLink(PUB, SIGN, w.deps)).toEqual({ kind: "unavailable" });
      expect(writes(w)).toEqual([]);
    }
  });
  it("a valid signing token with ANOTHER proposal's /p/ token writes nothing in read, opened, consent and sign, and answers the same", async () => {
    const w = world({ proposal: { public_token: OTHER_PUB } });
    expect(await readSigningLink(PUB, SIGN, w.deps)).toEqual({ kind: "unavailable" });
    await recordOpened(PUB, SIGN, w.deps);
    expect(await recordConsent(PUB, SIGN, sha(WORDS_ROW.consent_text), w.deps)).toEqual({ ok: false, message: LINK_UNAVAILABLE });
    expect(await signByLink({ publicToken: PUB, signToken: SIGN, typedName: "Sam Client", signature: { kind: "typed", style: "print" } }, { ...w.deps, notify: async () => {} })).toEqual({
      ok: false,
      message: LINK_UNAVAILABLE,
    });
    expect(writes(w)).toEqual([]);
  });
  it("the limiters are keyed by the signing token's sha256, never the raw token", async () => {
    const w = world();
    await readSigningLink(PUB, SIGN, w.deps);
    expect(w.keys).toContain(`s:${SHA}`);
    expect(w.keys.join(" ")).not.toContain(SIGN);
  });
  it("opened is written only by the browser's POST, after verification, and only once", async () => {
    const w = world();
    await recordOpened(PUB, SIGN, w.deps);
    expect(w.f.rpcCalls.map((c) => c.fn)).toEqual(["client_proposal_signing_opened"]);
    expect(w.f.rpcCalls[0].args).toEqual({ p_token_sha256: SHA, p_ip: "203.0.113.5", p_user_agent: "TestBrowser/1.0" });
    const again = world({ request: { opened_at: "2026-10-20T14:00:00Z" } });
    await recordOpened(PUB, SIGN, again.deps);
    expect(again.f.rpcCalls).toEqual([]);
  });
  it("gate off on a POST: no write", async () => {
    const w = world({ gateOn: false });
    await recordOpened(PUB, SIGN, w.deps);
    expect(await recordConsent(PUB, SIGN, sha(WORDS_ROW.consent_text), w.deps)).toEqual({ ok: false, message: LINK_UNAVAILABLE });
    expect(writes(w)).toEqual([]);
  });
});

describe("T8 every unusable link is the same answer, compared in constant time; an unverified text is never drawn", () => {
  it("wrong, expired, closed, other-proposal, malformed: all unavailable; the page markup is identical", async () => {
    const cases = [
      () => readSigningLink(PUB, "t".repeat(42) + "B", world().deps),
      () => readSigningLink(PUB, SIGN, world({ request: { expires_at: "2026-10-01T00:00:00Z" } }).deps),
      () => readSigningLink(PUB, SIGN, world({ request: { status: "closed" } }).deps),
      () => readSigningLink(PUB, SIGN, world({ proposal: { public_token: OTHER_PUB } }).deps),
      () => readSigningLink(PUB, "short", world().deps),
    ];
    for (const c of cases) expect(await c()).toEqual({ kind: "unavailable" });
    const html = renderToStaticMarkup(<SignByLinkPage state="unavailable" backHref="/p/x/" />);
    expect(html).toContain(LINK_UNAVAILABLE);
    expect(html).not.toMatch(/expired|closed|wrong|another/i);
  });
  it("the pair check is a constant-time compare", () => {
    expect(readFileSync("src/lib/loe/email-signing/verify.ts", "utf8")).toMatch(/timingSafeEqual/);
    expect(sameToken(PUB, PUB)).toBe(true);
    expect(sameToken(PUB, OTHER_PUB)).toBe(false);
    expect(sameToken(PUB, "short")).toBe(false);
  });
  it("a stored text that fails its sha256 is not drawn, and one line names only the proposal and the step", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = world({ request: { agreement_sha256: "0".repeat(64) } });
    expect(await readSigningLink(PUB, SIGN, w.deps)).toEqual({ kind: "unavailable" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toBe("[proposals] signed letter does not match its recorded fingerprint proposal=p-1 step=signing_link");
    log.mockRestore();
  });
  it("a missing table on the read sets the runtime memo", async () => {
    const f = fakeSigningDb({}, {}, { tableErrors: { client_proposal_signing_request: { code: "42P01" } } });
    await verifyLinkPair(PUB, SIGN, { db: f.db, now: NOW, gate: async () => ({ on: false, reason: "switch_off" }) });
    expect(signingNotSetUp()).toBe(true);
  });
});

describe("T16 a replaced letter", () => {
  it("the read: unavailable with no write", async () => {
    const w = world({ letter: "stale" });
    expect(await readSigningLink(PUB, SIGN, w.deps)).toEqual({ kind: "unavailable" });
    expect(writes(w)).toEqual([]);
  });
  it("consent and sign: ONE signing_close(proposal_changed), then unavailable", async () => {
    for (const run of [
      (w: ReturnType<typeof world>) => recordConsent(PUB, SIGN, sha(WORDS_ROW.consent_text), w.deps),
      (w: ReturnType<typeof world>) => signByLink({ publicToken: PUB, signToken: SIGN, typedName: "Sam Client", signature: { kind: "typed", style: "print" } }, { ...w.deps, notify: async () => {} }),
    ]) {
      const w = world({ letter: "stale", request: { consent_at: "2026-10-20T14:00:00Z", opened_at: "2026-10-20T14:00:00Z" } });
      expect(await run(w)).toEqual({ ok: false, message: LINK_UNAVAILABLE });
      expect(w.f.rpcCalls).toEqual([{ fn: "client_proposal_signing_close", args: { p_request_id: REQ, p_reason: "proposal_changed" } }]);
    }
  });
  it("past its expiry on a POST: signing_opened closes it", async () => {
    const w = world({ request: { expires_at: "2026-10-01T00:00:00Z" } });
    expect(await recordConsent(PUB, SIGN, sha(WORDS_ROW.consent_text), w.deps)).toEqual({ ok: false, message: LINK_UNAVAILABLE });
    expect(w.f.rpcCalls.map((c) => c.fn)).toEqual(["client_proposal_signing_opened"]);
  });
  it("signing_letter_replaced from the sign rpc: unavailable", async () => {
    const w = world({ request: { consent_at: "x", opened_at: "x" }, rpcs: { client_proposal_signing_sign: err("23514", "signing_letter_replaced: x") as never } });
    expect(await signByLink({ publicToken: PUB, signToken: SIGN, typedName: "Sam Client", signature: { kind: "typed", style: "print" } }, { ...w.deps, notify: async () => {} })).toEqual({ ok: false, message: LINK_UNAVAILABLE });
  });
});

describe("consent", () => {
  it("records opened first when missing, then consent with the drawn text's sha256", async () => {
    const w = world();
    expect(await recordConsent(PUB, SIGN, sha(WORDS_ROW.consent_text), w.deps)).toEqual({ ok: true });
    expect(w.f.rpcCalls.map((c) => c.fn)).toEqual(["client_proposal_signing_opened", "client_proposal_signing_consent"]);
    expect(w.f.rpcCalls[1].args.p_consent_sha256).toBe(sha(WORDS_ROW.consent_text));
  });
  it("maps the refusals", async () => {
    const mk = (e: unknown) => world({ request: { opened_at: "x" }, rpcs: { client_proposal_signing_consent: e as never } });
    expect(await recordConsent(PUB, SIGN, "a".repeat(64), mk(err("23514", "signing_consent_mismatch: x")).deps)).toEqual({ ok: false, message: SIGN_LINK_MESSAGES.reload });
    expect(await recordConsent(PUB, SIGN, "a".repeat(64), mk(err("40P01")).deps)).toEqual({ ok: false, message: SIGN_LINK_MESSAGES.try_again });
    expect(await recordConsent(PUB, SIGN, "a".repeat(64), mk(err("42883")).deps)).toEqual({ ok: false, message: LINK_UNAVAILABLE });
    expect(signingNotSetUp()).toBe(true);
  });
});

const PNG = (n: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n)]);
const dataUrl = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

describe("T10 / T18 signing", () => {
  const consented = { consent_at: "2026-10-20T14:00:00Z", opened_at: "2026-10-20T14:00:00Z" };
  it("folds the name ASCII-only; the rpc gets the CLEANED name, the same string the typed hash covers", async () => {
    const w = world({ request: consented });
    const notify = vi.fn(async () => {});
    const r = await signByLink({ publicToken: PUB, signToken: SIGN, typedName: "  sam   CLIENT ", signature: { kind: "typed", style: "print" } }, { ...w.deps, notify });
    expect(r).toEqual({ ok: true, signedLine: "Signed October 20, 2026 at 11:00 AM EDT by Sam Client", payUrl: "https://pay.example/x" });
    const args = w.f.rpcCalls[0].args;
    expect(args.p_typed_name).toBe("sam CLIENT");
    expect(args.p_signature_sha256).toBe(sha(`print\u001fsam CLIENT`));
    expect(args).toMatchObject({ p_token_sha256: SHA, p_signature_kind: "typed", p_typed_style: "print", p_signature_png: null, p_ip: "203.0.113.5" });
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it("refuses a name that differs (and ZOË for Zoë) before the rpc", async () => {
    for (const [typed, frozen] of [["Sam Clients", "Sam Client"], ["ZOË", "Zoë"]]) {
      const w = world({ request: { ...consented, signer_name: frozen } });
      expect(await signByLink({ publicToken: PUB, signToken: SIGN, typedName: typed, signature: { kind: "typed", style: "print" } }, { ...w.deps, notify: async () => {} })).toEqual({
        ok: false,
        message: SIGN_LINK_MESSAGES.name_mismatch,
      });
      expect(w.f.rpcCalls).toEqual([]);
    }
  });
  it("PNG checks: magic, size, data URL; a drawn signature's hash is computed here and its bytes go as bytea hex", async () => {
    expect(checkSignature({ kind: "drawn", png: dataUrl(Buffer.from("not a png at all")) }, "x")).toBeNull();
    expect(checkSignature({ kind: "drawn", png: dataUrl(PNG(MAX_SIGNATURE_PNG_BYTES)) }, "x")).toBeNull();
    expect(checkSignature({ kind: "drawn", png: "data:image/jpeg;base64,AAAA" }, "x")).toBeNull();
    expect(checkSignature({ kind: "typed", style: "script" }, "x")).toBeNull();
    const png = PNG(100);
    const w = world({ request: consented });
    await signByLink({ publicToken: PUB, signToken: SIGN, typedName: "Sam Client", signature: { kind: "drawn", png: dataUrl(png) } }, { ...w.deps, notify: async () => {} });
    expect(w.f.rpcCalls[0].args).toMatchObject({ p_signature_kind: "drawn", p_signature_sha256: sha(png), p_signature_png: `\\x${png.toString("hex")}`, p_typed_style: null });
  });
  it("maps refusals; follow-ups only when signed_now is true; nothing is logged", async () => {
    const spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    const cases: Array<[unknown, { ok: false; message: string; needConsent?: true }]> = [
      [err("23514", "signing_name_mismatch: x"), { ok: false, message: SIGN_LINK_MESSAGES.name_mismatch }],
      [err("23514", "signing_no_consent: x"), { ok: false, message: SIGN_LINK_MESSAGES.reload, needConsent: true }],
      [err("23514", "signing_link_closed: x"), { ok: false, message: LINK_UNAVAILABLE }],
      [err("23514", "signing_changed: x"), { ok: false, message: LINK_UNAVAILABLE }],
      [err("42883"), { ok: false, message: LINK_UNAVAILABLE }],
      [err("40P01"), { ok: false, message: SIGN_LINK_MESSAGES.retry }],
      [err("XX000", "?"), { ok: false, message: SIGN_LINK_MESSAGES.retry }],
    ];
    for (const [answer, want] of cases) {
      const w = world({ request: consented, rpcs: { client_proposal_signing_sign: answer as never } });
      const notify = vi.fn(async () => {});
      expect(await signByLink({ publicToken: PUB, signToken: SIGN, typedName: "Sam Client", signature: { kind: "typed", style: "print" } }, { ...w.deps, notify })).toEqual(want);
      expect(notify).not.toHaveBeenCalled();
    }
    const repeat = world({ request: consented, rpcs: { client_proposal_signing_sign: ok([{ signature_id: "s", signed_now: false, proposal_id: "p-1", signed_at: "2026-10-20T15:00:01.000Z" }]) as never } });
    const notify = vi.fn(async () => {});
    expect((await signByLink({ publicToken: PUB, signToken: SIGN, typedName: "Sam Client", signature: { kind: "typed", style: "print" } }, { ...repeat.deps, notify })).ok).toBe(true);
    expect(notify).not.toHaveBeenCalled();
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
  it("no consent yet: back to consent, no rpc", async () => {
    const w = world();
    expect(await signByLink({ publicToken: PUB, signToken: SIGN, typedName: "Sam Client", signature: { kind: "typed", style: "print" } }, { ...w.deps, notify: async () => {} })).toEqual({
      ok: false,
      message: SIGN_LINK_MESSAGES.reload,
      needConsent: true,
    });
    expect(w.f.rpcCalls).toEqual([]);
  });
  it("D11: a signed link shows the done screen only for the request that signed it", async () => {
    const signed = { status: "signed", signed_at: "2026-10-20T15:00:01.000Z", signature_id: "sig-1" };
    const mine = world({ request: signed, proposal: { status: "accepted", accepted_snapshot: { agreement: { signing_request_id: REQ, signed_at: "2026-10-20T15:00:01.000Z" } } } });
    expect((await readSigningLink(PUB, SIGN, mine.deps)).kind).toBe("signed");
    const reset = world({ request: signed, proposal: { status: "sent" } });
    expect((await readSigningLink(PUB, SIGN, reset.deps)).kind).toBe("unavailable");
    const other = world({ request: signed, proposal: { status: "accepted", accepted_snapshot: { agreement: { signing_request_id: "someone-else" } } } });
    expect((await readSigningLink(PUB, SIGN, other.deps)).kind).toBe("unavailable");
  });
});
