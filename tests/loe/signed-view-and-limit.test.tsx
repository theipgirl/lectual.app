import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/font/google", () => ({
  Bodoni_Moda: () => ({ variable: "bodoni-var" }),
  Source_Serif_4: () => ({ variable: "serif-var" }),
}));
const mocks = vi.hoisted(() => ({
  after: vi.fn<(fn: () => unknown) => void>(),
  runAcceptanceFollowups: vi.fn<(db: unknown, input: { proposalId: string; orgId: string }) => Promise<void>>(async () => {}),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/proposals/accept-followups", () => ({ runAcceptanceFollowups: mocks.runAcceptanceFollowups }));

import { ProposalDocument } from "@/components/client-proposal/ProposalDocument";
import { LoeSignedLetter } from "@/components/client-proposal/LoeReceipt";
import { PDF_MESSAGES, READ_AGAIN_LABEL, SIGNED_VIEW_UNAVAILABLE } from "@/lib/loe/client-words";
import { agreementTextSha256 } from "@/lib/loe/fingerprint";
import { REVIEW_PDF_PER_TOKEN, reviewTokenLimiter, signedTokenLimiter } from "@/lib/loe/review-limit";
import { pageTextMatchesStored } from "@/lib/loe/signing";
import { reviewLetterPdf, signedLetterPdf } from "@/lib/proposals/public-letter";
import { acceptPublicProposal, readPublicProposal } from "@/lib/proposals/public";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import type { Row } from "../proposals/public-db-double";
import { NOW, TOKEN, browserSigning, world } from "../proposals/signing-world";
import { TEST_DETAILS } from "./full-letter-fixture";

beforeEach(() => {
  mocks.after.mockReset();
  mocks.runAcceptanceFollowups.mockReset();
  mocks.runAcceptanceFollowups.mockResolvedValue(undefined);
});

/** A world whose proposal has just been signed through the real accept path. */
async function signedWorld(token: string = TOKEN) {
  const w = world({ token, proposal: { expires_on: "2026-12-31" } });
  const b = await browserSigning(w.db, { token });
  const r = await acceptPublicProposal(token, b.selection, NOW, w.db, undefined, b.signing);
  if (!r.ok) throw new Error(r.message);
  const row = w.tables.client_proposal[0] as Row;
  const snapshot = row.accepted_snapshot as AcceptedSnapshot;
  const storedText = String(w.rpcCalls[0].args.p_agreement_text);
  return { w, b, r, row, snapshot, storedText };
}

/** Plays "today's code no longer rebuilds what was signed": the recorded fingerprint is that of a stored text the rebuild does not produce. */
function madeByOlderCode(s: Awaited<ReturnType<typeof signedWorld>>, storedOnRow: (text: string) => string = (t) => t) {
  const text = `${s.storedText}\n\nA closing line that an earlier version of the letter renderer wrote.`;
  const sha256 = agreementTextSha256(text);
  s.row.accepted_snapshot = { ...s.snapshot, agreement: { ...s.snapshot.agreement!, sha256 } };
  const sig = (s.w.tables.client_proposal_signature as Row[])[0];
  sig.agreement_text = storedOnRow(text);
  sig.agreement_sha256 = sha256;
  sig.signed_at = "2026-10-20T15:00:01.000Z";
  return { text, sha256 };
}

describe("checker's m3: the client's 'Read it again' is only ever a letter that was verified against the stored fingerprint", () => {
  it("today's code rebuilds the signed text: the rebuilt letter (with Exhibit A) is shown, and the signature table is not read", async () => {
    const s = await signedWorld();
    const before = s.w.calls.length;
    const read = await readPublicProposal(TOKEN, NOW, s.w.db);
    if (read.status !== "ok") throw new Error("no read");
    const signed = read.view.letter?.signed;
    expect(signed).toBeTruthy();
    expect(signed?.fromStoredText).toBeUndefined();
    expect(signed?.exhibit?.title).toBe("Exhibit A: Fee Structure and Estimated Costs");
    expect(signed?.signatureId).toBeNull();
    expect(s.w.calls.slice(before).some((c) => c.table === "client_proposal_signature")).toBe(false);
  });

  it("the rebuild no longer matches: the STORED signed text is shown instead, read fenced on the row's own id and org", async () => {
    const s = await signedWorld();
    const { text, sha256 } = madeByOlderCode(s);
    const before = s.w.calls.length;
    const read = await readPublicProposal(TOKEN, NOW, s.w.db);
    if (read.status !== "ok") throw new Error("no read");
    const signed = read.view.letter?.signed;
    expect(signed?.fromStoredText).toBe(true);
    expect(signed?.exhibit).toBeNull();
    expect(signed?.fingerprint).toBe(sha256);
    expect(signed?.blocks.map((b) => b.text).join("\n\n")).toBe(text);
    expect(signed?.blocks.every((b) => b.lead === null)).toBe(true);
    expect(signed?.signedLine).toBe("Signed October 20, 2026 at 11:00 AM EDT by Sevetri Wilson");
    const sigRead = s.w.calls.slice(before).find((c) => c.table === "client_proposal_signature")!;
    expect(sigRead.filters).toEqual([["proposal_id", "prop-2"], ["org_id", "org-1"], ["id", "sig-0001"]]);

    // And the page draws it: every stored paragraph, no exhibit table, under "Read it again".
    const html = renderToStaticMarkup(
      <ProposalDocument mode="accepted" content={read.view.content} title={read.view.title} clientName={read.view.clientName} expiresOn={read.view.expiresOn} firm={{ name: "RPB Law", slug: "rpb-law" }} acceptedQuote={read.view.acceptedQuote ?? undefined} initialSelection={read.view.acceptedSelection ?? undefined} letter={read.view.letter} signedLine={signed?.signedLine ?? null} />,
    );
    const again = html.match(/<section class="cp-signed-letter"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(again).toContain("A closing line that an earlier version of the letter renderer wrote.");
    expect(again).not.toContain('class="cp-exhibit"');
    expect(again).not.toContain("data-signed-unavailable");
  });

  it("neither verifies (the stored text was altered): NOTHING is shown as signed, the fixed sentence is, and one log line names the id and the step", async () => {
    const s = await signedWorld();
    madeByOlderCode(s, (t) => `${t} altered`);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const read = await readPublicProposal(TOKEN, NOW, s.w.db);
    const lines = spy.mock.calls.map((c) => c.join(" "));
    spy.mockRestore();
    if (read.status !== "ok") throw new Error("no read");
    expect(read.view.letter?.signed).toBeNull();
    expect(lines).toEqual(["[proposals] signed letter does not match its recorded fingerprint proposal=prop-2 step=client_view"]);

    const html = renderToStaticMarkup(
      <ProposalDocument mode="accepted" content={read.view.content} title={read.view.title} clientName={read.view.clientName} expiresOn={read.view.expiresOn} firm={{ name: "RPB Law", slug: "rpb-law" }} acceptedQuote={read.view.acceptedQuote ?? undefined} initialSelection={read.view.acceptedSelection ?? undefined} letter={read.view.letter} />,
    );
    const again = html.match(/<section class="cp-signed-letter"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(again).toContain(READ_AGAIN_LABEL);
    expect(again).toContain("data-signed-unavailable");
    expect(again).toContain(SIGNED_VIEW_UNAVAILABLE.replace(/'/g, "&#x27;"));
    // Not one paragraph of the letter is under that label.
    expect(again).not.toContain("Dear Sevetri Wilson");
    expect(again).not.toContain('class="cp-letter"');
  });

  it("the stored text cannot be READ: nothing is shown as signed either, and nothing is logged (it may work next time)", async () => {
    const s = await signedWorld();
    madeByOlderCode(s);
    (s.w.tables.client_proposal_signature as Row[]).length = 0;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const read = await readPublicProposal(TOKEN, NOW, s.w.db);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    if (read.status !== "ok") throw new Error("no read");
    expect(read.view.letter?.signed).toBeNull();
  });

  it("the fixed sentence is its own (it is not the PDF's), and the read never uses an unchecked rebuild", () => {
    expect(SIGNED_VIEW_UNAVAILABLE).toMatch(/couldn't be shown/);
    expect(SIGNED_VIEW_UNAVAILABLE).not.toBe(PDF_MESSAGES.unavailable);
    expect(renderToStaticMarkup(<LoeSignedLetter agreement={null} title="Engagement letter" />)).toContain("data-signed-unavailable");
    const src = readFileSync(join(process.cwd(), "src/lib/proposals/public.ts"), "utf8");
    expect(src).not.toContain("rebuildSignedLetter(");
    expect(src).toContain("await verifySignedCopy(snapshot, firm.timeZone");
  });
});

describe("checker's m3 on the just-signed page: the page's own letter is shown as signed only when it hashes to what the server stored", () => {
  it("the page's text, with the server's date, hashes to the stored sha256 the sign action returned", async () => {
    const opened = new Date("2026-11-12T20:00:00.000Z");
    const signedAt = new Date("2026-11-13T15:30:00.000Z");
    const w = world({ proposal: { expires_on: "2026-12-31" } });
    const b = await browserSigning(w.db, { readAt: opened });
    const r = await acceptPublicProposal(TOKEN, b.selection, signedAt, w.db, undefined, b.signing);
    if (!r.ok) throw new Error(r.message);
    expect(r.agreementSha256).toBe(w.rpcCalls[0].args.p_agreement_sha256);
    expect(await pageTextMatchesStored(b.state, r.signedDateText, r.agreementSha256)).toBe(true);
    // The page's letter with ITS OWN (page-load) date is not what was stored; neither is any other text or a missing hash.
    expect(await pageTextMatchesStored(b.state, b.pageDate, r.agreementSha256)).toBe(false);
    expect(await pageTextMatchesStored({ ...b.state, typedName: "Someone Else" }, r.signedDateText, r.agreementSha256)).toBe(false);
    expect(await pageTextMatchesStored(b.state, r.signedDateText, "0".repeat(64))).toBe(false);
    expect(await pageTextMatchesStored(b.state, r.signedDateText, undefined)).toBe(false);
    expect(await pageTextMatchesStored(b.state, null, r.agreementSha256)).toBe(false);
  });

  it("verified: the letter is under 'Read it again'; not verified: the fixed sentence, and not a paragraph of it", () => {
    const base = {
      content: world().tables.client_proposal[0].content as never,
      title: "Trademark Proposal",
      clientName: "Sevetri Wilson",
      expiresOn: "2026-12-01",
      firm: { name: "RPB Law", slug: "rpb-law" },
      mode: "live" as const,
      letter: { dateText: "November 12, 2026", clientEmail: "sevetri@example.com" },
      onAccept: async () => ({ ok: true as const, payUrl: "" }),
      initialLoe: { step: 3 as const, details: TEST_DETAILS, typedName: "Sevetri Wilson", agree: true },
    };
    const done = { payUrl: null, signedLine: "Signed November 13, 2026 at 10:30 AM EST by Sevetri Wilson", letterDate: "November 13, 2026" };
    const again = (html: string) => html.match(/<section class="cp-signed-letter"[\s\S]*?<\/section>/)?.[0] ?? "";
    const verified = again(renderToStaticMarkup(<ProposalDocument {...base} initialDone={{ ...done, letterVerified: true }} />));
    expect(verified).toContain("Dear Sevetri Wilson:");
    expect(verified).not.toContain("data-signed-unavailable");
    for (const unverified of [{ ...done, letterVerified: false }, done]) {
      const html = again(renderToStaticMarkup(<ProposalDocument {...base} initialDone={unverified} />));
      expect(html).toContain("data-signed-unavailable");
      expect(html).not.toContain("Dear Sevetri Wilson:");
    }
  });

  it("both documents wait for that check before anything is shown as signed", () => {
    for (const f of ["ProposalDocument.tsx", "GeneralProposalDocument.tsx"]) {
      const src = readFileSync(join(process.cwd(), "src/components/client-proposal", f), "utf8");
      expect(src, f).toContain("await loeFlow.signedTextVerified(result.letterDate, result.textSha256)");
      expect(src, f).toContain("const signedView = letter?.signed ?? (done?.letterVerified ? loeFlow.agreement : null);");
    }
    const action = readFileSync(join(process.cwd(), "src/app/p/[token]/actions.ts"), "utf8");
    expect(action).toContain("textSha256: result.agreementSha256");
  });
});

describe("checker's m2: the client's signed download is rate limited, with its own counters", () => {
  it("the 21st signed download for one link in the hour is refused, and the review copy's counter is untouched", async () => {
    const s = await signedWorld();
    const ip = "198.51.100.201";
    for (let i = 0; i < REVIEW_PDF_PER_TOKEN; i += 1) {
      const r = await signedLetterPdf(TOKEN, NOW, { db: s.w.db, ip });
      expect(r.ok, `download ${i + 1}`).toBe(true);
    }
    expect(await signedLetterPdf(TOKEN, NOW, { db: s.w.db, ip })).toEqual({ ok: false, message: PDF_MESSAGES.limit });
    // Another address does not get round the per-link limit.
    expect(await signedLetterPdf(TOKEN, NOW, { db: s.w.db, ip: "198.51.100.202" })).toEqual({ ok: false, message: PDF_MESSAGES.limit });
    // The review copy for the same link is answered by its own rule ("no longer open": the proposal is signed), not by this limit.
    expect(await reviewLetterPdf(TOKEN, undefined, undefined, TEST_DETAILS, NOW, { db: s.w.db, ip })).toEqual({ ok: false, message: PDF_MESSAGES.not_open });
  }, 120_000);

  it("the two downloads do not share a counter: a link whose review copies are used up still gets its signed letter", () => {
    expect(signedTokenLimiter).not.toBe(reviewTokenLimiter);
    const key = "t:shared-key-for-this-test";
    for (let i = 0; i < REVIEW_PDF_PER_TOKEN; i += 1) reviewTokenLimiter.record(key);
    expect(reviewTokenLimiter.allowed(key)).toBe(false);
    expect(signedTokenLimiter.allowed(key)).toBe(true);
    for (let i = 0; i < REVIEW_PDF_PER_TOKEN; i += 1) signedTokenLimiter.record(key);
    expect(signedTokenLimiter.allowed(key)).toBe(false);
  });

  it("a refused call (not signed yet, a malformed link) uses no slot and makes no file", async () => {
    // Its own link (the limiter is per link, and the test above used up TOKEN's).
    const token = "L".repeat(43);
    const live = world({ token });
    for (let i = 0; i < REVIEW_PDF_PER_TOKEN + 5; i += 1) {
      expect(await signedLetterPdf(token, NOW, { db: live.db, ip: "198.51.100.203" })).toEqual({ ok: false, message: PDF_MESSAGES.not_signed });
    }
    expect(await signedLetterPdf("short", NOW, { db: live.db, ip: "198.51.100.203" })).toEqual({ ok: false, message: PDF_MESSAGES.not_open });
  });

  it("the action passes the caller's address, and the limit is checked before the proposal is read", () => {
    const action = readFileSync(join(process.cwd(), "src/app/p/[token]/actions.ts"), "utf8");
    expect(action).toMatch(/signedLetterPdf\(String\(token \?\? ""\), new Date\(\), \{ ip: h\.get\("x-forwarded-for"\) \?\? h\.get\("x-real-ip"\) \}\)/);
    const lib = readFileSync(join(process.cwd(), "src/lib/proposals/public-letter.ts"), "utf8");
    const fn = lib.slice(lib.indexOf("export async function signedLetterPdf"));
    expect(fn.indexOf("signedTokenLimiter.allowed(tokenKey)")).toBeGreaterThan(-1);
    expect(fn.indexOf("signedTokenLimiter.allowed(tokenKey)")).toBeLessThan(fn.indexOf("readPublicProposal("));
  });
});

describe("checker's m4 on the client's download: the generic sentence, and the one log line", () => {
  it("a stored text that does not match its fingerprint: 'try again' wording for the client, logged with the id and the step only", async () => {
    const token = "M".repeat(43);
    const s = await signedWorld(token);
    const { sha256 } = madeByOlderCode(s, (t) => `${t} altered`);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await signedLetterPdf(token, NOW, { db: s.w.db, ip: "198.51.100.204" });
    const lines = spy.mock.calls.map((c) => c.join(" "));
    spy.mockRestore();
    expect(r).toEqual({ ok: false, message: PDF_MESSAGES.unavailable });
    // The page read logs it as the view step and the download as its own step: one line each, nothing of the letter in either.
    expect(lines).toEqual([
      "[proposals] signed letter does not match its recorded fingerprint proposal=prop-2 step=client_view",
      "[proposals] signed letter does not match its recorded fingerprint proposal=prop-2 step=client_download",
    ]);
    for (const never of ["Sevetri", "Example Street", sha256, "altered", "Dear "]) expect(lines.join("\n")).not.toContain(never);
  });
});
