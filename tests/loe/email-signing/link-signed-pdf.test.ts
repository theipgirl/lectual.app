import { describe, expect, it, vi } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";

vi.mock("next/server", () => ({ after: () => {} }));

import { buildVerifiedSignedPdf } from "@/lib/loe/signed-pdf";
import { runStaffDownload, STAFF_DOWNLOAD_MESSAGES } from "@/lib/loe/staff-download";
import { PDF_MESSAGES } from "@/lib/loe/client-words";
import type { EvidenceRead } from "@/lib/loe/email-signing/evidence";
import { signedLetterPdf } from "@/lib/proposals/public-letter";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import { acceptedProposalRow, signedTrademark, WRONG_FINGERPRINT } from "../signed-fixtures";
import { squash } from "../full-letter-fixture";
import { NOW, TOKEN, world } from "../../proposals/signing-world";
import { PNG_BYTES, SENT_TO, evidenceFor, linkSnapshot } from "./evidence-fixtures";

/**
 * Sprint B: a letter signed through the emailed link gets ONE more page, the signing record, built only from verified evidence.
 * Sprint A refused every link-signed snapshot (T17); that blanket refusal is replaced on purpose by these rules.
 */

const FIRM = { displayName: "Sample Firm", timeZone: "America/New_York" };

async function readBack(bytes: Uint8Array): Promise<{ text: string; pages: number }> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text, totalPages } = await extractText(pdf, { mergePages: true });
  return { text: squash(text), pages: totalPages };
}

const ok = (snapshot: AcceptedSnapshot, over?: Parameters<typeof evidenceFor>[1]) => async (): Promise<EvidenceRead> => evidenceFor(snapshot, over);

describe("buildVerifiedSignedPdf for an emailed-link signature", () => {
  it("adds one page, the signing record, holding the verified fingerprint and the recorded facts", async () => {
    const snapshot = linkSnapshot();
    const inApp = await buildVerifiedSignedPdf({ snapshot: signedTrademark(), firm: FIRM, readStored: async () => null, readEvidence: async () => "unavailable" });
    const link = await buildVerifiedSignedPdf({ snapshot, firm: FIRM, readStored: async () => null, readEvidence: ok(snapshot) });
    if (!inApp.ok || !link.ok) throw new Error("no file");
    const a = await readBack(inApp.bytes);
    const b = await readBack(link.bytes);
    expect(b.pages).toBe(a.pages + 1);
    expect(b.text).toContain("Signing record");
    expect(a.text).not.toContain("Sent to:");
    expect(b.text).toContain(snapshot.agreement!.sha256);
    expect(b.text).toContain(SENT_TO);
    expect(b.text).toContain("203.0.113.7");
    expect(b.text).toContain("Sample Browser/9.0");
    expect(b.text).toContain("Callum Ferreira");
    expect(b.text).toContain("2026-11-12T19:14:00.000Z");
  });

  it("a typed signature prints the name beside the words 'Typed signature'", async () => {
    const snapshot = linkSnapshot();
    const r = await buildVerifiedSignedPdf({ snapshot, firm: FIRM, readStored: async () => null, readEvidence: ok(snapshot, { typed: true }) });
    if (!r.ok) throw new Error("no file");
    expect((await readBack(r.bytes)).text).toContain("Typed signature");
  });

  it("an in-app (0106) snapshot never asks for evidence and gets no certificate", async () => {
    const readEvidence = vi.fn(async (): Promise<EvidenceRead> => "unavailable");
    const r = await buildVerifiedSignedPdf({ snapshot: signedTrademark(), firm: FIRM, readStored: async () => null, readEvidence });
    expect(r.ok).toBe(true);
    expect(readEvidence).not.toHaveBeenCalled();
    if (r.ok) expect((await readBack(r.bytes)).text).not.toContain("Signing record");
  });

  it("asks for the evidence only AFTER the text is verified", async () => {
    const readEvidence = vi.fn(async (): Promise<EvidenceRead> => evidenceFor(linkSnapshot()));
    const wrong = { ...linkSnapshot(), agreement: { ...linkSnapshot().agreement!, sha256: WRONG_FINGERPRINT } };
    expect(await buildVerifiedSignedPdf({ snapshot: wrong, firm: FIRM, readStored: async () => null, readEvidence })).toEqual({ ok: false, reason: "unavailable" });
    expect(readEvidence).not.toHaveBeenCalled();
  });

  it("never a PDF without its page: unavailable, not set up, a throw and a broken chain are all 'unavailable'", async () => {
    const snapshot = linkSnapshot();
    for (const readEvidence of [
      async (): Promise<EvidenceRead> => "unavailable",
      async (): Promise<EvidenceRead> => "not_set_up",
      async (): Promise<EvidenceRead> => {
        throw new Error("boom");
      },
      ok(snapshot, { events: evidenceFor(snapshot).events.filter((e) => e.kind !== "consent") }),
      ok(snapshot, { request: { status: "open" } }),
    ]) {
      expect(await buildVerifiedSignedPdf({ snapshot, firm: FIRM, readStored: async () => null, readEvidence })).toEqual({ ok: false, reason: "unavailable" });
    }
  });

  it("a signed event whose sha256 differs, or a drawn PNG that fails its re-check, is a mismatch", async () => {
    const snapshot = linkSnapshot();
    const e = evidenceFor(snapshot);
    const bad = { ...e, events: e.events.map((x) => (x.kind === "signed" ? { ...x, agreement_sha256: "a".repeat(64) } : x)) };
    expect(await buildVerifiedSignedPdf({ snapshot, firm: FIRM, readStored: async () => null, readEvidence: async () => bad })).toEqual({ ok: false, reason: "mismatch" });
    const big = new Uint8Array(102_401);
    big.set(PNG_BYTES.subarray(0, 8));
    const bigPng = { ...e, events: e.events.map((x) => (x.kind === "signature" ? { ...x, signature_png: big } : x)) };
    expect(await buildVerifiedSignedPdf({ snapshot, firm: FIRM, readStored: async () => null, readEvidence: async () => bigPng })).toEqual({ ok: false, reason: "mismatch" });
    const otherPng = { ...e, events: e.events.map((x) => (x.kind === "signature" ? { ...x, signature_sha256: "9".repeat(64) } : x)) };
    expect(await buildVerifiedSignedPdf({ snapshot, firm: FIRM, readStored: async () => null, readEvidence: async () => otherPng })).toEqual({ ok: false, reason: "mismatch" });
  });
});

describe("every caller: staff Download and the client's own download", () => {
  const facts = async () => ({ status: "ok", displayName: "Sample Firm", timeZone: "America/New_York" }) as const;
  const deps = (readEvidence: () => Promise<EvidenceRead>, onMismatch?: (id: string) => void) => ({
    gate: async () => null,
    getProposal: async () => acceptedProposalRow(linkSnapshot()),
    firmFacts: facts,
    readStored: async () => null,
    readEvidence,
    onMismatch,
  });
  const ID = "44444444-4444-4444-8444-444444444444";

  it("the staff Download builds the certificate from the evidence it is handed", async () => {
    const snapshot = linkSnapshot();
    const r = await runStaffDownload(deps(ok(snapshot)), ID);
    expect(r.ok).toBe(true);
  });
  it("answers its existing 'couldn't be made' sentence when the evidence can't be read", async () => {
    expect(await runStaffDownload(deps(async () => "unavailable"), ID)).toEqual({ ok: false, message: STAFF_DOWNLOAD_MESSAGES.unavailable });
    expect(await runStaffDownload(deps(async () => "not_set_up"), ID)).toEqual({ ok: false, message: STAFF_DOWNLOAD_MESSAGES.unavailable });
  });
  it("answers the mismatch sentence, once, when the evidence's sha256 differs", async () => {
    const snapshot = linkSnapshot();
    const e = evidenceFor(snapshot);
    const onMismatch = vi.fn();
    const r = await runStaffDownload(deps(async () => ({ ...e, events: e.events.map((x) => (x.kind === "signed" ? { ...x, agreement_sha256: "a".repeat(64) } : x)) }), onMismatch), ID);
    expect(r).toEqual({ ok: false, message: STAFF_DOWNLOAD_MESSAGES.mismatch });
    expect(onMismatch).toHaveBeenCalledTimes(1);
  });

  it("the client's signed download reads the evidence through the service-role client, fenced on the row's org and proposal", async () => {
    const snapshot = linkSnapshot();
    const w = world({ proposal: { status: "accepted", accepted_snapshot: snapshot, accepted_selection: snapshot.selection, expires_on: "2026-12-31" } });
    const e = evidenceFor(snapshot, { request: { proposal_id: "prop-2", org_id: "org-1" } });
    w.tables.client_proposal_signing_request = [{ ...e.request }];
    w.tables.client_proposal_signing_event = e.events.map((x) => ({ ...x, org_id: "org-1", request_id: e.request.id }));
    const r = await signedLetterPdf(TOKEN, NOW, { db: w.db, ip: "203.0.113.1" });
    expect(r.ok).toBe(true);
    const reads = w.calls.filter((c) => c.table === "client_proposal_signing_request" || c.table === "client_proposal_signing_event");
    expect(reads.length).toBe(2);
    expect(reads[0].filters).toEqual(expect.arrayContaining([["org_id", "org-1"], ["proposal_id", "prop-2"]]));
    expect(reads[1].filters).toEqual(expect.arrayContaining([["org_id", "org-1"]]));
  });
  it("answers its existing 'try again' sentence when there is no evidence", async () => {
    const snapshot = linkSnapshot();
    const w = world({ proposal: { status: "accepted", accepted_snapshot: snapshot, accepted_selection: snapshot.selection, expires_on: "2026-12-31" } });
    expect(await signedLetterPdf(TOKEN, NOW, { db: w.db, ip: "203.0.113.1" })).toEqual({ ok: false, message: PDF_MESSAGES.unavailable });
  });
});
