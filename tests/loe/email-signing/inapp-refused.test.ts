import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ after: vi.fn(), runAcceptanceFollowups: vi.fn(async () => {}) }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/proposals/accept-followups", () => ({ runAcceptanceFollowups: mocks.runAcceptanceFollowups }));

import { SIGN_MESSAGES } from "@/lib/loe/client-words";
import { markSigningNotSetUp, resetSigningNotSetUp } from "@/lib/loe/email-signing/not-set-up";
import { noteLocalFailure, resetLocalFailures } from "@/lib/loe/email-signing/failure-memo";
import { acceptPublicProposal, readPublicProposal } from "@/lib/proposals/public";
import { fakeDb, signAndAcceptImpl, type Row } from "../../proposals/public-db-double";
import { browserSigning, NOW, TOKEN } from "../../proposals/signing-world";
import { fullLetterBody } from "../full-letter-fixture";
import { twoBrandPerMark, withLoe } from "../loe-fixtures";
import { ON_ENV, ORG, WORDS_ROW } from "./fake-db";

/**
 * T11: in-app signing is refused (`signing_by_email`, its step sentence, no rpc) ONLY while the emailed path is positively ready;
 * every way it can be off leaves today's in-app path exactly as it was (and the page draws today's markup: `emailSigning` unset).
 */

beforeEach(() => {
  resetSigningNotSetUp();
  resetLocalFailures();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(ON_ENV)) vi.stubEnv(k, v);
});

function readyWorld(over: { probe?: unknown; readiness?: unknown; templateVersion?: number } = {}) {
  const proposal: Row = {
    id: "prop-2",
    org_id: ORG,
    family_id: "prop-1",
    version: 2,
    public_token: TOKEN,
    title: "Trademark Proposal",
    client_name: "Sam Client",
    client_email: "client@example.com",
    status: "sent",
    content: withLoe(twoBrandPerMark()),
    expires_on: "2026-12-31",
    pay_url: "https://pay.example/x",
    sent_at: "2026-10-19T00:00:00Z",
    accepted_at: null,
    accepted_selection: null,
    accepted_snapshot: null,
  };
  return fakeDb(
    {
      client_proposal: [proposal],
      crm_org: [{ id: ORG, name: "Sample Firm", slug: "sample-firm", modules: ["proposals"] }],
      crm_org_profile: [{ org_id: ORG, time_zone: "America/New_York" }],
      client_proposal_event: [],
      client_proposal_signing_words: [{ ...WORDS_ROW }],
      client_proposal_loe_template: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          org_id: ORG,
          kind: "trademark",
          status: "approved",
          version: over.templateVersion ?? 3,
          title: "Engagement letter",
          body: fullLetterBody(),
          updated_at: "2026-10-01T00:00:00Z",
          approved_at: "2026-10-01T00:00:00Z",
        },
      ],
    },
    {
      rpcImpl: (fn, args, tables) => {
        if (fn === "client_proposal_signing_probe") return (over.probe as never) ?? { data: 117, error: null };
        if (fn === "client_proposal_signing_readiness") return (over.readiness as never) ?? { data: { state: "ok", failures: 0 }, error: null };
        return signAndAcceptImpl(fn, args, tables);
      },
    },
  );
}

async function signInApp(w: ReturnType<typeof readyWorld>) {
  const b = await browserSigning(w.db, { typedName: "Sam Client" });
  return acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.signing);
}

describe("T11 in-app signing while the emailed path is on", () => {
  it("positively ready: the read says so, and an in-app signing is refused with its step sentence and NO sign rpc", async () => {
    const w = readyWorld();
    const read = await readPublicProposal(TOKEN, NOW, w.db);
    expect(read.status === "ok" && read.view.letter?.emailSigning).toBe(true);
    const r = await signInApp(w);
    expect(r).toEqual({ ok: false, reason: "signing_by_email", message: SIGN_MESSAGES.signing_by_email });
    expect(SIGN_MESSAGES.signing_by_email).toBe("Reload this page to get your signing link by email.");
    expect(w.rpcCalls.map((c) => c.fn)).not.toContain("client_proposal_sign_and_accept");
    expect((w.tables.client_proposal[0] as Row).status).toBe("sent");
  });

  const offCases: Array<[string, () => ReturnType<typeof readyWorld>]> = [
    ["the switch is off", () => (vi.stubEnv("LOE_EMAIL_SIGNING", ""), readyWorld())],
    ["the probe is missing", () => readyWorld({ probe: { data: null, error: { code: "42883", message: "no" } } })],
    ["the runtime memo is set", () => (markSigningNotSetUp(), readyWorld())],
    ["the fallback has tripped (database count)", () => readyWorld({ readiness: { data: { state: "ok", failures: 3 }, error: null } })],
    ["the fallback has tripped (this instance's memo)", () => (noteLocalFailure("prop-2"), noteLocalFailure("prop-2"), noteLocalFailure("prop-2"), readyWorld())],
    ["the letter was replaced", () => readyWorld({ templateVersion: 4 })],
    ["readiness can't be read", () => readyWorld({ readiness: { data: null, error: { code: "XX000", message: "?" } } })],
    ["the database reports a precondition", () => readyWorld({ readiness: { data: { state: "letter_replaced", failures: 0 }, error: null } })],
  ];
  for (const [name, make] of offCases) {
    it(`NOT refused when ${name}: today's in-app path signs, and the page is today's`, async () => {
      const w = make();
      const read = await readPublicProposal(TOKEN, NOW, w.db);
      expect(read.status === "ok" && read.view.letter?.emailSigning).toBeUndefined();
      const r = await signInApp(w);
      expect(r.ok).toBe(true);
      expect(w.rpcCalls.map((c) => c.fn)).toContain("client_proposal_sign_and_accept");
    });
  }
});
