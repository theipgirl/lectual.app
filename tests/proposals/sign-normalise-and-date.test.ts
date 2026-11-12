import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIGN_MESSAGES } from "@/lib/loe/client-words";
import { canonicalFingerprint } from "@/lib/loe/fingerprint";
import { buildExhibit } from "@/lib/loe/exhibit";
import { FINGERPRINT_DATE, checkSigning, cleanTypedName, pageAgreement, pageSigningPayload, type PageSigningState } from "@/lib/loe/signing";
import { money } from "@/components/client-proposal/format";
import { quoteWithClientClasses } from "@/lib/proposals/client-classes";
import { defaultSelection, normalizeSelection } from "@/lib/proposals/pricing";
import { acceptPublicProposal } from "@/lib/proposals/public";
import type { Row } from "./public-db-double";
import { TEST_DETAILS, fullLetterBody } from "../loe/full-letter-fixture";
import { twoBrandPerMark, withLoe } from "../loe/loe-fixtures";

const mocks = vi.hoisted(() => ({
  after: vi.fn<(fn: () => unknown) => void>(),
  runAcceptanceFollowups: vi.fn<(db: unknown, input: { proposalId: string; orgId: string }) => Promise<void>>(async () => {}),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/proposals/accept-followups", () => ({ runAcceptanceFollowups: mocks.runAcceptanceFollowups }));

beforeEach(() => {
  mocks.after.mockReset();
  mocks.runAcceptanceFollowups.mockReset();
  mocks.runAcceptanceFollowups.mockResolvedValue(undefined);
});

import { NOW, TOKEN, browserSigning, world } from "./signing-world";

/**
 * Review items 3 and 4.
 *
 * 3. The page and the server clean every typed field with ONE normaliser, so how a name is spaced can never make the two
 *    fingerprints disagree. The "browser" here is the real page pipeline (`pageAgreement` / `pageSigningPayload`).
 * 4. The fingerprint does not cover the date: a page opened one day and signed the next succeeds, and the stored text carries
 *    the SERVER's date, with the stored sha256 over that final text.
 */

const NBSP = " ";
const NAMES: Array<[label: string, typed: string]> = [
  ["a double space", "Mary  Smith"],
  ["a tab", "Mary\tSmith"],
  ["a non-breaking space", `Mary${NBSP}Smith`],
  ["leading and trailing spaces", "   Mary Smith  "],
  ["a mix of all of them", ` \tMary ${NBSP} Smith${NBSP}\t `],
];

describe("item 3: one normaliser for what a client types", () => {
  it("cleanTypedName is what checkSigning uses, and every spelling becomes Mary Smith", () => {
    for (const [, typed] of NAMES) {
      expect(cleanTypedName(typed)).toBe("Mary Smith");
      const r = checkSigning({ typedName: typed, agree: true, details: TEST_DETAILS });
      expect(r.ok && r.typedName).toBe("Mary Smith");
    }
  });

  for (const [label, typed] of NAMES) {
    it(`a signature typed with ${label} signs: the page's fingerprint is the server's`, async () => {
      const w = world();
      const b = await browserSigning(w.db, { typedName: typed });
      expect(b.signing.typedName).toBe("Mary Smith");
      // As the page posts it.
      const r = await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.signing);
      expect(r.ok, r.ok ? "" : r.message).toBe(true);
      expect(w.rpcCalls).toHaveLength(1);
      expect(w.rpcCalls[0].args.p_signer_name).toBe("Mary Smith");
      expect(String(w.rpcCalls[0].args.p_agreement_text)).toContain("Mary Smith");
      expect(String(w.rpcCalls[0].args.p_agreement_text)).not.toContain("Mary  Smith");
    });

    it(`the same name posted exactly as typed (${label}) is cleaned by the server to the same fingerprint`, async () => {
      const w = world();
      const b = await browserSigning(w.db, { typedName: typed });
      const r = await acceptPublicProposal(TOKEN, b.selection, NOW, w.db, undefined, b.rawSigning);
      expect(r.ok, r.ok ? "" : r.message).toBe(true);
      expect(w.rpcCalls[0].args.p_signer_name).toBe("Mary Smith");
    });
  }

  it("the nine details go through the same cleaning on both sides (double spaces, tabs, non-breaking spaces)", async () => {
    const w = world();
    const typed = { ...TEST_DETAILS, client_name: `Sevetri${NBSP}${NBSP}Wilson`, street: "100\tExample   Street ", city: `  Miami${NBSP}` };
    const b = await browserSigning(w.db, { details: typed, typedName: `Sevetri${NBSP}Wilson` });
    for (const signing of [b.signing, b.rawSigning]) {
      const fresh = world();
      const r = await acceptPublicProposal(TOKEN, b.selection, NOW, fresh.db, undefined, signing);
      expect(r.ok, r.ok ? "" : r.message).toBe(true);
      expect(fresh.rpcCalls[0].args.p_address).toMatchObject({ street: "100 Example Street", city: "Miami" });
    }
  });

  it("the page hook builds its agreement and its payload only through the shared pipeline (no trim() of its own)", () => {
    const src = readFileSync(join(process.cwd(), "src/components/client-proposal/loe-flow.ts"), "utf8");
    expect(src).toContain("pageAgreement(state)");
    expect(src).toContain("pageSigningPayload(");
    expect(src).not.toMatch(/typedName\.trim\(\)/);
    expect(src).not.toMatch(/fingerprintOf\(/);
  });
});

function pageState(dateText: string, over: Partial<PageSigningState> = {}): PageSigningState {
  const content = withLoe(twoBrandPerMark());
  const selection = normalizeSelection(content, defaultSelection(content));
  const priced = quoteWithClientClasses(content, selection, { entries: {}, added: {} }, { repair: true });
  if (!priced.ok) throw new Error("no quote");
  return {
    body: fullLetterBody(),
    details: TEST_DETAILS,
    typedName: "Sevetri Wilson",
    dateText,
    clientEmail: "sevetri@example.com",
    exhibit: buildExhibit(priced.content, priced.quote, money),
    ...over,
  };
}

describe("item 4: the fingerprint does not cover the date", () => {
  it("the letter really uses both date fields (so this is not vacuous)", () => {
    expect(fullLetterBody()).toContain("{{date}}");
    const a = pageAgreement(pageState("November 12, 2026"));
    expect(a?.text).toContain("November 12, 2026");
    expect(a?.canonical).not.toContain("November 12, 2026");
    expect(a?.canonical).toContain(FINGERPRINT_DATE);
  });

  it("two pages that differ only in their date have the same fingerprint and different text", async () => {
    const one = await pageSigningPayload({ ...pageState("November 12, 2026"), agree: true });
    const two = await pageSigningPayload({ ...pageState("November 13, 2026"), agree: true });
    expect(one?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(two?.fingerprint).toBe(one?.fingerprint);
    expect(pageAgreement(pageState("November 12, 2026"))?.text).not.toBe(pageAgreement(pageState("November 13, 2026"))?.text);
    // The server hashes the same canonical string with node:crypto.
    expect(canonicalFingerprint(pageAgreement(pageState("November 13, 2026"))!.canonical)).toBe(one?.fingerprint);
  });

  it("anything else still changes it: a detail, the typed name, the letter text", async () => {
    const base = (await pageSigningPayload({ ...pageState("November 12, 2026"), agree: true }))!.fingerprint;
    const fp = async (over: Partial<PageSigningState>) => (await pageSigningPayload({ ...pageState("November 12, 2026", over), agree: true }))!.fingerprint;
    expect(await fp({ details: { ...TEST_DETAILS, street: "101 Example Street" } })).not.toBe(base);
    expect(await fp({ typedName: "Sevetri W Wilson" })).not.toBe(base);
    expect(await fp({ body: `${fullLetterBody()}\n\nOne more paragraph.` })).not.toBe(base);
    expect(await fp({ clientEmail: "other@example.com" })).not.toBe(base);
  });

  it("a page built on November 12 and signed with the server clock on November 13 succeeds", async () => {
    const opened = new Date("2026-11-12T20:00:00.000Z"); // 3:00 PM on November 12 in New York
    const signedAt = new Date("2026-11-13T15:30:00.000Z"); // 10:30 AM on November 13 in New York
    const w = world({ proposal: { expires_on: "2026-12-31" } });
    const b = await browserSigning(w.db, { readAt: opened });
    expect(b.pageDate).toBe("November 12, 2026");
    expect(b.text).toContain("November 12, 2026");

    const r = await acceptPublicProposal(TOKEN, b.selection, signedAt, w.db, undefined, b.signing);
    expect(r.ok, r.ok ? "" : r.message).toBe(true);
    expect(w.rpcCalls).toHaveLength(1);
    const args = w.rpcCalls[0].args;
    // The stored text carries the SERVER's date, in the firm's zone, and not the date the page was opened with.
    const stored = String(args.p_agreement_text);
    expect(stored).toContain("November 13, 2026");
    expect(stored).not.toContain("November 12, 2026");
    // The stored sha256 is over that final text.
    expect(args.p_agreement_sha256).toBe(createHash("sha256").update(stored, "utf8").digest("hex"));
    const snapshot = args.p_snapshot as { signing: { date_text: string } };
    expect(snapshot.signing.date_text).toBe("November 13, 2026");
    // The receipt is told the server's date, so the letter it redraws carries it.
    if (r.ok) expect(r.signedDateText).toBe("November 13, 2026");
    expect((w.tables.client_proposal[0] as Row).status).toBe("accepted");
  });

  it("midnight in the firm's zone between opening and signing is not stale either", async () => {
    const w = world({ proposal: { expires_on: "2026-12-31" } });
    const b = await browserSigning(w.db, { readAt: new Date("2026-11-13T04:59:00.000Z") }); // 11:59 PM November 12, New York
    const r = await acceptPublicProposal(TOKEN, b.selection, new Date("2026-11-13T05:01:00.000Z"), w.db, undefined, b.signing);
    expect(r.ok).toBe(true);
    expect(String(w.rpcCalls[0].args.p_agreement_text)).toContain("November 13, 2026");
  });

  it("the proposal itself changing IS stale: nothing is written, and the sentence says the proposal was updated", async () => {
    const w = world();
    const b = await browserSigning(w.db);
    // The firm replaced the letter on the row after the page was opened.
    const changed = world({ content: { ...withLoe(twoBrandPerMark()), loe: { ...withLoe(twoBrandPerMark()).loe!, body: `${fullLetterBody()}\n\nA new closing paragraph.` } } });
    const r = await acceptPublicProposal(TOKEN, b.selection, NOW, changed.db, undefined, b.signing);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("stale");
      expect(r.message).toBe(SIGN_MESSAGES.stale);
    }
    expect(changed.rpcCalls).toHaveLength(0);
    expect(SIGN_MESSAGES.stale).toMatch(/was updated/);
    expect(SIGN_MESSAGES.stale).toMatch(/Nothing has been signed/);
  });
});

describe("item 4: a refusal never clears what the client typed", () => {
  for (const file of ["ProposalDocument.tsx", "GeneralProposalDocument.tsx"]) {
    it(`${file}: the refused branch of accept() only closes the payment tab and shows the sentence`, () => {
      const src = readFileSync(join(process.cwd(), "src/components/client-proposal", file), "utf8");
      const start = src.indexOf("if (!result.ok) {");
      expect(start).toBeGreaterThan(-1);
      const branch = src.slice(start, src.indexOf("}", start) + 1);
      expect(branch).toContain("setError(result.message)");
      // The typed details, the typed name, the tick and the step live in `useLoeFlow`'s state: a refusal touches none of them
      // and never reloads the page, so the client can read the sentence and try again with everything still filled in.
      expect(branch).not.toMatch(/setStep|setDetail|setTypedName|setAgree|reload|location/);
      expect(src).not.toMatch(/location\.reload\(/);
    });
  }

  it("the page keeps the typed values in state that only a reload loses (useState, never derived from props after mount)", () => {
    const src = readFileSync(join(process.cwd(), "src/components/client-proposal/loe-flow.ts"), "utf8");
    expect(src).toMatch(/const \[details, setDetails\] = useState/);
    expect(src).toMatch(/const \[typedName, setTypedName\] = useState/);
    expect(src).toMatch(/const \[agree, setAgree\] = useState/);
  });
});
