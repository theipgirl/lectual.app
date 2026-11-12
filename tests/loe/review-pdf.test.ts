import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";

const mocks = vi.hoisted(() => ({
  after: vi.fn<(fn: () => unknown) => void>(),
  runAcceptanceFollowups: vi.fn(async () => {}),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/proposals/accept-followups", () => ({ runAcceptanceFollowups: mocks.runAcceptanceFollowups }));

import { acceptPublicProposal } from "@/lib/proposals/public";
import { reviewLetterPdf, signedLetterPdf } from "@/lib/proposals/public-letter";
import { REVIEW_COPY_MARK, PDF_MESSAGES } from "@/lib/loe/client-words";
import { REVIEW_PDF_PER_TOKEN } from "@/lib/loe/review-limit";
import { defaultSelection } from "@/lib/proposals/pricing";
import { sevetri } from "../proposals/fixture";
import { twoBrandPerMark, withLoe } from "./loe-fixtures";
import { NOW, browserSigning, world } from "../proposals/signing-world";
import { TEST_DETAILS, fullLetterBlocks, paragraphText, squash } from "./full-letter-fixture";

const SELECTION = defaultSelection(withLoe(twoBrandPerMark()));
let n = 0;
/** A fresh, well-formed token per test: the in-memory limiter is per token and per process. */
function freshToken(): string {
  n += 1;
  return `R${String(n).padStart(4, "0")}`.padEnd(43, "x");
}

async function textOf(base64: string): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(base64, "base64")));
  const { text } = await extractText(pdf, { mergePages: true });
  return squash(text.split(REVIEW_COPY_MARK).join(" ").replace(/Page \d+ of \d+/g, " "));
}

beforeEach(() => {
  mocks.after.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("the review-copy PDF action", () => {
  it("builds a PDF of the whole letter with the client's details and the review mark, from the token alone", async () => {
    const token = freshToken();
    const w = world({ token });
    const r = await reviewLetterPdf(token, SELECTION, undefined, TEST_DETAILS, NOW, { db: w.db, ip: "203.0.113.9" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Buffer.from(r.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
    expect(r.filename).toMatch(/^Sevetri-Wilson-engagement-letter-review-copy\.pdf$/);
    const raw = await getDocumentProxy(new Uint8Array(Buffer.from(r.base64, "base64")));
    expect((await extractText(raw, { mergePages: true })).text).toContain(REVIEW_COPY_MARK);
    const text = await textOf(r.base64);
    for (const b of fullLetterBlocks({ typedName: "Sevetri Wilson", dateText: "October 20, 2026" })) expect(text).toContain(squash(paragraphText(b)));
    expect(text).toContain("Exhibit A: Fee Structure and Estimated Costs");
    expect(text).toContain("The Fold");
    // Nothing was written.
    expect(w.calls.filter((c) => c.op !== "select")).toHaveLength(0);
    expect(w.rpcCalls).toHaveLength(0);
  });

  it("holds only the selection: an unselected class is not in the exhibit", async () => {
    const token = freshToken();
    const w = world({ token });
    const r = await reviewLetterPdf(token, { "fold-word": true, "fold-c2": false, "fold-c1": true }, undefined, TEST_DETAILS, NOW, { db: w.db });
    if (!r.ok) throw new Error(r.message);
    const text = await textOf(r.base64);
    expect(text).toContain("Class: Clothing");
    expect(text).not.toContain("Online retail");
  });

  it("refuses a withdrawn, expired, replaced, signed or unknown proposal with a fixed sentence and builds nothing", async () => {
    const cases: Array<[string, Parameters<typeof world>[0]]> = [
      ["withdrawn", { proposal: { status: "withdrawn" } }],
      ["expired", { proposal: { expires_on: "2026-10-10" } }],
      ["replaced", { proposal: { status: "superseded" } }],
      ["a draft", { proposal: { status: "draft" } }],
      ["already signed", { proposal: { status: "accepted" } }],
    ];
    for (const [label, over] of cases) {
      const token = freshToken();
      const w = world({ ...over, token });
      const r = await reviewLetterPdf(token, undefined, undefined, TEST_DETAILS, NOW, { db: w.db });
      expect(r.ok, label).toBe(false);
      if (!r.ok) expect(r.message, label).toBe(PDF_MESSAGES.not_open);
    }
    const w = world({ token: freshToken() });
    const unknown = await reviewLetterPdf(freshToken(), undefined, undefined, TEST_DETAILS, NOW, { db: w.db });
    expect(unknown).toEqual({ ok: false, message: PDF_MESSAGES.not_open });
    expect(await reviewLetterPdf("short", undefined, undefined, TEST_DETAILS, NOW, { db: w.db })).toEqual({ ok: false, message: PDF_MESSAGES.not_open });
  });

  it("refuses a proposal with no letter", async () => {
    const token = freshToken();
    const w = world({ token, content: sevetri() });
    expect(await reviewLetterPdf(token, undefined, undefined, TEST_DETAILS, NOW, { db: w.db })).toEqual({ ok: false, message: PDF_MESSAGES.not_open });
  });

  it("refuses missing details with a sentence", async () => {
    const token = freshToken();
    const w = world({ token });
    expect(await reviewLetterPdf(token, undefined, undefined, {}, NOW, { db: w.db })).toEqual({ ok: false, message: PDF_MESSAGES.details });
  });

  it("is rate limited per token: after the limit it refuses, and a refused call does not use a slot", async () => {
    const token = freshToken();
    const w = world({ token });
    for (let i = 0; i < REVIEW_PDF_PER_TOKEN; i += 1) {
      const r = await reviewLetterPdf(token, undefined, undefined, TEST_DETAILS, NOW, { db: w.db, ip: "198.51.100.1" });
      expect(r.ok).toBe(true);
    }
    expect(await reviewLetterPdf(token, undefined, undefined, TEST_DETAILS, NOW, { db: w.db, ip: "198.51.100.1" })).toEqual({ ok: false, message: PDF_MESSAGES.limit });
    // Another token is unaffected (the address limit is higher).
    const other = freshToken();
    const w2 = world({ token: other });
    expect((await reviewLetterPdf(other, undefined, undefined, TEST_DETAILS, NOW, { db: w2.db, ip: "198.51.100.2" })).ok).toBe(true);
  }, 60_000);

  it("logs nothing", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const token = freshToken();
    const w = world({ token });
    await reviewLetterPdf(token, undefined, undefined, TEST_DETAILS, NOW, { db: w.db });
    await reviewLetterPdf(token, undefined, undefined, {}, NOW, { db: w.db });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it("the action takes no proposal id or org id (token and what the client typed only)", () => {
    const src = readFileSync(join(process.cwd(), "src/app/p/[token]/actions.ts"), "utf8");
    expect(src).toMatch(/downloadReviewLetterAction\(token: string, selection: unknown, clientClasses: unknown, details: unknown\)/);
    expect(src).toMatch(/downloadSignedLetterAction\(token: string\)/);
    const lib = readFileSync(join(process.cwd(), "src/lib/proposals/public-letter.ts"), "utf8");
    expect(lib).not.toMatch(/proposalId:|orgId:|proposal_id|org_id/);
    expect(lib).not.toMatch(/console\./);
  });
});

describe("the signed PDF", () => {
  it("is rebuilt from the stored snapshot and holds the letter, the exhibit, the signer, the time and the fingerprint", async () => {
    const w = world();
    const b = await browserSigning(w.db, { typedName: "Sevetri Wilson" });
    const accepted = await acceptPublicProposal("T".repeat(43), b.selection, NOW, w.db, undefined, b.signing);
    expect(accepted.ok).toBe(true);
    const r = await signedLetterPdf("T".repeat(43), new Date("2026-10-21T12:00:00Z"), { db: w.db });
    if (!r.ok) throw new Error(r.message);
    expect(r.filename).toBe("Sevetri-Wilson-engagement-letter-signed.pdf");
    const raw = await getDocumentProxy(new Uint8Array(Buffer.from(r.base64, "base64")));
    const full = squash((await extractText(raw, { mergePages: true })).text);
    const text = await textOf(r.base64);
    for (const bl of fullLetterBlocks({ typedName: "Sevetri Wilson", dateText: "October 20, 2026" })) expect(text).toContain(squash(paragraphText(bl)));
    expect(full).toContain("Signed electronically by Sevetri Wilson on October 20, 2026 at 11:00 AM");
    expect(full).toMatch(/Fingerprint \(sha256\): [0-9a-f]{64}/);
    expect(full).not.toContain(REVIEW_COPY_MARK);
  });

  it("refuses when there is nothing signed (a live proposal, an unknown token, a proposal with no letter)", async () => {
    const live = world();
    expect(await signedLetterPdf("T".repeat(43), NOW, { db: live.db })).toEqual({ ok: false, message: PDF_MESSAGES.not_signed });
    const plain = world({ content: sevetri(), proposal: { status: "accepted", accepted_snapshot: null } });
    expect((await signedLetterPdf("T".repeat(43), NOW, { db: plain.db })).ok).toBe(false);
    expect(defaultSelection(sevetri())).toBeTruthy();
  });
});
