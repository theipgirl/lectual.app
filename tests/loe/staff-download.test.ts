import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { runStaffDownload, STAFF_DOWNLOAD_MESSAGES, type StaffDownloadDeps } from "@/lib/loe/staff-download";
import { agreementTextSha256 } from "@/lib/loe/fingerprint";
import { buildVerifiedSignedPdf } from "@/lib/loe/signed-pdf";
import { SIGNATURE_READ_ROLES } from "@/lib/loe/signature-roles";
import { ROLES } from "@/lib/auth/roles";
import { acceptedSnapshot } from "../proposals/accepted-fixture";
import { acceptedProposalRow, signedTrademark, storedTextOf } from "./signed-fixtures";
import { squash } from "./full-letter-fixture";

const ID = "44444444-4444-4444-8444-444444444444";
const FACTS = { status: "ok", displayName: "RPB Law Firm", timeZone: "America/New_York" } as const;

function deps(over: Partial<StaffDownloadDeps> = {}): StaffDownloadDeps {
  return {
    gate: async () => null,
    getProposal: async () => acceptedProposalRow(signedTrademark()),
    firmFacts: async () => FACTS,
    readStored: async () => null,
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
    // The same builder as the client's own signed download and the Lawmatics filing: the same text read back.
    const clientSide = await buildVerifiedSignedPdf({ snapshot: signedTrademark(), firm: { displayName: "RPB Law Firm", timeZone: "America/New_York" }, readStored: async () => null });
    if (!clientSide.ok) throw new Error("no file");
    expect(await text(bytes)).toBe(await text(clientSide.bytes));
    // Rebuilt and matched: no flag, and the stored text was never asked for.
    expect(r.fromStoredText).toBeUndefined();
  });

  it("review item 6: when today's code no longer rebuilds the signed text, the file is the stored text and the result says so", async () => {
    const today = signedTrademark();
    const storedText = `${storedTextOf(today)}\n\nA line only the stored text has.`;
    const sha256 = agreementTextSha256(storedText);
    const row = acceptedProposalRow({ ...today, agreement: { ...today.agreement!, sha256 } });
    const readStored = vi.fn(async () => ({ text: storedText, sha256 }));
    const r = await runStaffDownload(deps({ getProposal: async () => row, readStored }), ID);
    if (!r.ok) throw new Error(r.message);
    expect(r.fromStoredText).toBe(true);
    expect(readStored).toHaveBeenCalledWith(row);
    const read = await text(new Uint8Array(Buffer.from(r.base64, "base64")));
    expect(read).toContain("A line only the stored text has.");
    expect(read).toContain(`Fingerprint (sha256): ${sha256}`);
    // No stored text to fall back on: one fixed sentence, no file.
    expect(await runStaffDownload(deps({ getProposal: async () => row }), ID)).toEqual({ ok: false, message: STAFF_DOWNLOAD_MESSAGES.unavailable });
  });

  it("checker's m4: a stored letter that does not match its recorded fingerprint is said in its own fixed sentence (not 'try again'), with one log callback", async () => {
    const today = signedTrademark();
    const storedText = `${storedTextOf(today)}\n\nA line only the stored text has.`;
    const sha256 = agreementTextSha256(storedText);
    const row = acceptedProposalRow({ ...today, agreement: { ...today.agreement!, sha256 } });
    const onMismatch = vi.fn();
    const r = await runStaffDownload(deps({ getProposal: async () => row, readStored: async () => ({ text: `${storedText} altered`, sha256 }), onMismatch }), ID);
    expect(r).toEqual({ ok: false, message: STAFF_DOWNLOAD_MESSAGES.mismatch });
    expect(STAFF_DOWNLOAD_MESSAGES.mismatch).toMatch(/doesn't match its recorded fingerprint/);
    expect(STAFF_DOWNLOAD_MESSAGES.mismatch).toMatch(/no copy was made/);
    expect(STAFF_DOWNLOAD_MESSAGES.mismatch).not.toMatch(/try again/i);
    expect(STAFF_DOWNLOAD_MESSAGES.mismatch).not.toBe(STAFF_DOWNLOAD_MESSAGES.unavailable);
    expect(onMismatch).toHaveBeenCalledTimes(1);
    expect(onMismatch).toHaveBeenCalledWith(row.id);
    // An unreadable stored text is still the ordinary sentence, with no log.
    onMismatch.mockClear();
    expect(await runStaffDownload(deps({ getProposal: async () => row, onMismatch }), ID)).toEqual({ ok: false, message: STAFF_DOWNLOAD_MESSAGES.unavailable });
    expect(onMismatch).not.toHaveBeenCalled();
    // The action wires the one log line: the id and the step, nothing else.
    const action = readFileSync("src/app/dashboard/proposals/[id]/signed-letter-actions.ts", "utf8");
    expect(action).toContain('onMismatch: (id) => logSignedMismatch(id, "staff_download"),');
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
    // Review item 11: the gate is the ONE list of roles that may read a signature record.
    expect(src).toContain("gate: gateSignedLetterDownload");
    expect(src).not.toMatch(/gateStaffAction/);
    expect(src.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/admin|service/i);
    const gate = readFileSync("src/app/dashboard/proposals/gate.ts", "utf8");
    const fn = gate.slice(gate.indexOf("export async function gateSignedLetterDownload"));
    expect(fn.slice(0, fn.indexOf("\n}\n"))).toMatch(/requireProposalsModule\(\);\s*return canReadSignature\(await currentRole\(\)\) \? null : \{ error: SIGNED_DOWNLOAD_NOT_ALLOWED \};/);
  });

  it("the one list is the eight staff roles; a viewer and social media are not in it", () => {
    expect([...SIGNATURE_READ_ROLES].sort()).toEqual(["admin", "attorney", "clerk", "intake", "law_clerk", "owner", "paralegal", "senior_admin"]);
    expect(ROLES.filter((r) => !SIGNATURE_READ_ROLES.includes(r)).sort()).toEqual(["social_media", "viewer"]);
  });
});
