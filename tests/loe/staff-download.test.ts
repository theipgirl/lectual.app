import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { runStaffDownload, STAFF_DOWNLOAD_MESSAGES, type StaffDownloadDeps } from "@/lib/loe/staff-download";
import { rebuildSignedLetter } from "@/lib/loe/signed-letter";
import { buildSignedLetterPdf } from "@/lib/loe/signed-pdf";
import { acceptedSnapshot } from "../proposals/accepted-fixture";
import { acceptedProposalRow, signedTrademark } from "./signed-fixtures";
import { squash } from "./full-letter-fixture";

const ID = "44444444-4444-4444-8444-444444444444";
const FACTS = { status: "ok", displayName: "RPB Law Firm", timeZone: "America/New_York" } as const;

function deps(over: Partial<StaffDownloadDeps> = {}): StaffDownloadDeps {
  return {
    gate: async () => null,
    getProposal: async () => acceptedProposalRow(signedTrademark()),
    firmFacts: async () => FACTS,
    ...over,
  };
}

async function text(bytes: Uint8Array) {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  return squash((await extractText(pdf, { mergePages: true })).text);
}

describe("the staff Download of a signed letter", () => {
  it("returns %PDF bytes named from the signer and the signed date, equal to what the client's signed download builds", async () => {
    const r = await runStaffDownload(deps(), ID);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bytes = new Uint8Array(Buffer.from(r.base64, "base64"));
    expect(Buffer.from(bytes.slice(0, 4)).toString()).toBe("%PDF");
    expect(r.filename).toBe("Sevetri-Wilson-engagement-letter-signed-2026-11-12.pdf");
    // The same bytes input as the client's own signed download (buildLetterPdf mode signed over rebuildSignedLetter): the same text read back.
    const letter = rebuildSignedLetter(signedTrademark(), "America/New_York")!;
    const clientSide = await buildSignedLetterPdf(letter, { displayName: "RPB Law Firm", title: "Engagement letter" });
    expect(await text(bytes)).toBe(await text(clientSide));
  });

  it("refuses an unsigned accepted version", async () => {
    const r = await runStaffDownload(deps({ getProposal: async () => acceptedProposalRow(acceptedSnapshot({ classes: 2 })) }), ID);
    expect(r).toEqual({ ok: false, message: STAFF_DOWNLOAD_MESSAGES.not_signed });
  });

  it("refuses a version that is not accepted, even with a signed-looking snapshot", async () => {
    const r = await runStaffDownload(deps({ getProposal: async () => acceptedProposalRow(signedTrademark(), { status: "sent" }) }), ID);
    expect(r).toEqual({ ok: false, message: STAFF_DOWNLOAD_MESSAGES.not_signed });
  });

  it("another firm's proposal (the scoped read finds nothing) and a malformed id are 'not found', with no letter data", async () => {
    expect(await runStaffDownload(deps({ getProposal: async () => null }), ID)).toEqual({ ok: false, message: "Proposal not found." });
    const read = vi.fn(async () => null);
    expect(await runStaffDownload(deps({ getProposal: read }), "not-an-id")).toEqual({ ok: false, message: "Proposal not found." });
    expect(await runStaffDownload(deps({ getProposal: read }), { id: ID })).toEqual({ ok: false, message: "Proposal not found." });
    expect(read).not.toHaveBeenCalled();
  });

  it("an unreadable proposal, unreadable firm facts and a failing builder give one fixed sentence", async () => {
    const msg = { ok: false, message: STAFF_DOWNLOAD_MESSAGES.unavailable };
    expect(await runStaffDownload(deps({ getProposal: async () => { throw new Error("db down: sevetri@example.com"); } }), ID)).toEqual(msg);
    expect(await runStaffDownload(deps({ firmFacts: async () => ({ status: "unavailable" }) }), ID)).toEqual(msg);
    const broken = acceptedProposalRow({ ...signedTrademark(), content: { ...signedTrademark().content, loe: { ...signedTrademark().content.loe!, body: "{{nope}}" } } });
    expect(await runStaffDownload(deps({ getProposal: async () => broken }), ID)).toEqual(msg);
  });

  it("a refused gate (the module, or a viewer or social media role) returns its sentence and reads nothing", async () => {
    const read = vi.fn();
    const r = await runStaffDownload(deps({ gate: async () => ({ error: "Your role can't change proposals." }), getProposal: read }), ID);
    expect(r).toEqual({ ok: false, message: "Your role can't change proposals." });
    expect(read).not.toHaveBeenCalled();
  });

  it("the server action re-resolves the module and the role on every call, and reads through the scoped client only", () => {
    const src = readFileSync("src/app/dashboard/proposals/[id]/signed-letter-actions.ts", "utf8");
    expect(src).toContain('"use server"');
    expect(src).toContain("gateStaffAction");
    expect(src).not.toMatch(/admin|service/i);
    const gate = readFileSync("src/app/dashboard/proposals/gate.ts", "utf8");
    expect(gate).toMatch(/gateStaffAction[\s\S]*requireProposalsModule\(\)[\s\S]*PROPOSAL_STAFF_WRITE_ROLES/);
  });
});
