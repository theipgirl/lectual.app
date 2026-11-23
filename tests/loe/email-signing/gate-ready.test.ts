import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { emailSigningGate } from "@/lib/loe/email-signing/gate";
import { emailSigningReadiness } from "@/lib/loe/email-signing/ready";
import { markSigningNotSetUp, resetSigningNotSetUp, signingNotSetUp } from "@/lib/loe/email-signing/not-set-up";
import { noteLocalFailure, resetLocalFailures } from "@/lib/loe/email-signing/failure-memo";
import { signingWordsStatus } from "@/lib/loe/email-signing/settings-status";
import { fakeSigningDb, err, ok, ON_ENV, ORG, WORDS_ROW } from "./fake-db";
import { withLoe } from "../loe-fixtures";
import { callum } from "../../proposals/fixture";

beforeEach(() => {
  resetSigningNotSetUp();
  resetLocalFailures();
});

const words = () => ({ client_proposal_signing_words: [{ ...WORDS_ROW }] });

describe("T15 the gate", () => {
  it("switch off: off, and nothing is read", async () => {
    const f = fakeSigningDb(words(), { client_proposal_signing_probe: ok(117) });
    expect(await emailSigningGate(ORG, { db: () => f.db, env: { ...ON_ENV, LOE_EMAIL_SIGNING: undefined } })).toEqual({ on: false, reason: "switch_off" });
    expect(f.rpcCalls).toEqual([]);
    expect(f.calls).toEqual([]);
  });
  it("no mail entry for THIS firm: off, nothing read", async () => {
    const f = fakeSigningDb(words(), { client_proposal_signing_probe: ok(117) });
    expect(await emailSigningGate(ORG, { db: () => f.db, env: { ...ON_ENV, FIRM_CLIENT_MAIL_FROM: "{}" } })).toEqual({ on: false, reason: "no_mail" });
    expect(f.rpcCalls).toEqual([]);
  });
  it("on, with the approved words and the firm's sender", async () => {
    const f = fakeSigningDb(words(), { client_proposal_signing_probe: ok(117) });
    const g = await emailSigningGate(ORG, { db: () => f.db, env: ON_ENV });
    expect(g.on).toBe(true);
    if (g.on) {
      expect(g.words.id).toBe(WORDS_ROW.id);
      expect(g.from).toBe("Sample Firm <signing@sample-firm.example>");
    }
  });
  for (const code of ["42883", "PGRST202", "42P01", "PGRST205"]) {
    it(`a missing probe (${code}): not_set_up, the memo is set, and the next call reads nothing`, async () => {
      const f = fakeSigningDb(words(), { client_proposal_signing_probe: err(code) });
      expect(await emailSigningGate(ORG, { db: () => f.db, env: ON_ENV })).toEqual({ on: false, reason: "not_set_up" });
      expect(signingNotSetUp()).toBe(true);
      const g = fakeSigningDb(words(), { client_proposal_signing_probe: ok(117) });
      expect(await emailSigningGate(ORG, { db: () => g.db, env: ON_ENV })).toEqual({ on: false, reason: "not_set_up" });
      expect(g.rpcCalls).toEqual([]);
    });
  }
  it("any other probe failure or a wrong number is unreadable; no approved words is no_words; a missing words table not_set_up", async () => {
    expect(await emailSigningGate(ORG, { db: () => fakeSigningDb(words(), { client_proposal_signing_probe: err("XX000") }).db, env: ON_ENV })).toEqual({ on: false, reason: "unreadable" });
    expect(await emailSigningGate(ORG, { db: () => fakeSigningDb(words(), { client_proposal_signing_probe: ok(116) }).db, env: ON_ENV })).toEqual({ on: false, reason: "unreadable" });
    expect(await emailSigningGate(ORG, { db: () => fakeSigningDb({}, { client_proposal_signing_probe: ok(117) }).db, env: ON_ENV })).toEqual({ on: false, reason: "no_words" });
    const missing = fakeSigningDb({}, { client_proposal_signing_probe: ok(117) }, { tableErrors: { client_proposal_signing_words: { code: "42P01" } } });
    expect(await emailSigningGate(ORG, { db: () => missing.db, env: ON_ENV })).toEqual({ on: false, reason: "not_set_up" });
  });
  it("a memo set by another call (a 42883 from signing_open or signing_sign) answers not_set_up without a read", async () => {
    markSigningNotSetUp();
    const f = fakeSigningDb(words(), { client_proposal_signing_probe: ok(117) });
    expect(await emailSigningGate(ORG, { db: () => f.db, env: ON_ENV })).toEqual({ on: false, reason: "not_set_up" });
    expect(f.rpcCalls).toEqual([]);
  });
});

function proposalRow(over: Record<string, unknown> = {}) {
  return { id: "p-1", org_id: ORG, family_id: "f-1", version: 2, status: "sent", content: withLoe(callum()), client_email: "client@example.com", ...over };
}

describe("T20 readiness over the fake (each uncertainty is in-app signing)", () => {
  const handle = { proposalId: "p-1", orgId: ORG };
  const deps = (f: ReturnType<typeof fakeSigningDb>, letter: "current" | "stale" | "unreadable" = "current") => ({ db: () => f.db, env: ON_ENV, letterCheck: async () => letter });
  const world = (readiness: unknown, rowOver: Record<string, unknown> = {}) =>
    fakeSigningDb({ ...words(), client_proposal: [proposalRow(rowOver)] }, { client_proposal_signing_probe: ok(117), client_proposal_signing_readiness: readiness as never });

  it("ready when the gate, the letter, the address and the database all say so", async () => {
    const r = await emailSigningReadiness(handle, deps(world(ok({ state: "ok", failures: 0 }))));
    expect(r.ready).toBe(true);
  });
  it("not ready: a replaced or unreadable letter, a bad address, a database state, three failures, local failures, an error, a missing function", async () => {
    expect((await emailSigningReadiness(handle, deps(world(ok({ state: "ok", failures: 0 })), "stale"))).ready).toBe(false);
    expect((await emailSigningReadiness(handle, deps(world(ok({ state: "ok", failures: 0 })), "unreadable"))).ready).toBe(false);
    expect((await emailSigningReadiness(handle, deps(world(ok({ state: "ok", failures: 0 }), { client_email: "not an address" })))).ready).toBe(false);
    expect((await emailSigningReadiness(handle, deps(world(ok({ state: "letter_replaced", failures: 0 }))))).ready).toBe(false);
    expect((await emailSigningReadiness(handle, deps(world(ok({ state: "ok", failures: 3 }))))).ready).toBe(false);
    noteLocalFailure("p-1");
    expect((await emailSigningReadiness(handle, deps(world(ok({ state: "ok", failures: 2 }))))).ready).toBe(false);
    resetLocalFailures();
    expect((await emailSigningReadiness(handle, deps(world(err("XX000"))))).ready).toBe(false);
    expect((await emailSigningReadiness(handle, deps(world(ok("nonsense"))))).ready).toBe(false);
    expect((await emailSigningReadiness(handle, deps(world(err("42883"))))).ready).toBe(false);
    expect(signingNotSetUp()).toBe(true);
  });
  it("a withdrawn row is not ready", async () => {
    expect((await emailSigningReadiness(handle, deps(world(ok({ state: "ok", failures: 0 }), { status: "withdrawn" })))).ready).toBe(false);
  });
});

describe("T21 the Settings status line reads through the scoped client only", () => {
  function scoped(result: { data: unknown; error: unknown }) {
    const seen: string[] = [];
    const db = {
      from(t: string) {
        seen.push(t);
        const q = { select: () => q, eq: () => q, limit: () => Promise.resolve(result) };
        return q;
      },
      rpc() {
        throw new Error("no rpc may be called");
      },
    };
    return { db: db as never, seen };
  }
  it("switch_off and no_mail make no read", async () => {
    const a = scoped({ data: [], error: null });
    expect(await signingWordsStatus(ORG, a.db, { ...ON_ENV, LOE_EMAIL_SIGNING: "yes" })).toBe("switch_off");
    expect(await signingWordsStatus(ORG, a.db, { ...ON_ENV, RESEND_API_KEY: "" })).toBe("no_mail");
    expect(await signingWordsStatus(ORG, a.db, { ...ON_ENV, FIRM_CLIENT_MAIL_FROM: undefined })).toBe("no_mail");
    expect(a.seen).toEqual([]);
  });
  it("one scoped read: missing table, error, none, one", async () => {
    expect(await signingWordsStatus(ORG, scoped({ data: null, error: { code: "42P01" } }).db, ON_ENV)).toBe("not_set_up");
    expect(await signingWordsStatus(ORG, scoped({ data: null, error: { code: "PGRST205" } }).db, ON_ENV)).toBe("not_set_up");
    expect(await signingWordsStatus(ORG, scoped({ data: null, error: { code: "XX000" } }).db, ON_ENV)).toBe("unreadable");
    expect(await signingWordsStatus(ORG, scoped({ data: [], error: null }).db, ON_ENV)).toBe("no_words");
    const one = scoped({ data: [{ id: "w" }], error: null });
    expect(await signingWordsStatus(ORG, one.db, ON_ENV)).toBe("on");
    expect(one.seen).toEqual(["client_proposal_signing_words"]);
  });
  it("settings-status.ts and the settings page import no admin client and call no rpc", () => {
    for (const f of ["src/lib/loe/email-signing/settings-status.ts", "src/app/dashboard/settings/proposals/signing-words/page.tsx", "src/app/dashboard/settings/proposals/signing-words/actions.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/@\/lib\/db\/admin|getAdminClient/);
      expect(src, f).not.toMatch(/signing_probe|\.rpc\(/);
    }
  });
});
