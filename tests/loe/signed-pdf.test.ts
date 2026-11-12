import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { agreementTextSha256 } from "@/lib/loe/fingerprint";
import { rebuildSignedLetter, signedLetterText } from "@/lib/loe/signed-letter";
import { buildVerifiedSignedPdf, rebuiltTextMatches, signedLetterFileName, type SignedPdfInput } from "@/lib/loe/signed-pdf";
import { signedLetterPdf } from "@/lib/proposals/public-letter";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import { fullLetterBody, paragraphText, squash } from "./full-letter-fixture";
import { FINGERPRINT, WRONG_FINGERPRINT, signedGeneral, signedTrademark, storedTextOf } from "./signed-fixtures";

async function readBack(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return squash(text.replace(/Page \d+ of \d+/g, " "));
}

const FIRM = { displayName: "RPB Law Firm", timeZone: "America/New_York" };

/** Builds through the ONE signed-PDF builder; `readStored` is a spy that must not be called unless the test says so. */
async function build(snapshot: AcceptedSnapshot, over: Partial<SignedPdfInput> = {}) {
  const readStored = vi.fn(async () => null as { text: string; sha256: string } | null);
  const result = await buildVerifiedSignedPdf({ snapshot, firm: FIRM, readStored, ...over });
  return { result, readStored: (over.readStored as typeof readStored | undefined) ?? readStored };
}

async function textOf(snapshot: AcceptedSnapshot): Promise<string> {
  const { result } = await build(snapshot);
  if (!result.ok) throw new Error("no file");
  return readBack(result.bytes);
}

describe("P2: the signed trademark PDF", () => {
  it("holds every paragraph of the full letter, the signer, the time, the fingerprint, the selected marks and packages, and nothing unselected", async () => {
    const snapshot = signedTrademark();
    const letter = rebuildSignedLetter(snapshot, "America/New_York")!;
    const { result, readStored } = await build(snapshot);
    if (!result.ok) throw new Error("no file");
    expect(result.fromStoredText).toBe(false);
    expect(readStored).not.toHaveBeenCalled();
    expect(Buffer.from(result.bytes.slice(0, 4)).toString()).toBe("%PDF");
    const text = await readBack(result.bytes);

    // The letterhead line comes first, before the first letter paragraph (clarification 1).
    expect(text.startsWith(FIRM.displayName)).toBe(true);
    expect(text.indexOf(FIRM.displayName)).toBeLessThan(text.indexOf(squash(paragraphText(letter.blocks[0])).slice(0, 30)));

    // Every paragraph of docs/rpb/engagement-letter-trademark.md, merge fields filled.
    expect(letter.blocks.length).toBeGreaterThan(20);
    for (const b of letter.blocks) expect(text, paragraphText(b).slice(0, 50)).toContain(squash(paragraphText(b)));
    // The letter is the whole stored file: one block per paragraph of docs/rpb/engagement-letter-trademark.md, none dropped.
    const paragraphs = fullLetterBody().split(/\n[ \t]*\n+/).filter((p) => p.trim().length > 0);
    expect(letter.blocks).toHaveLength(paragraphs.length);

    expect(text).toContain("Sevetri Wilson");
    expect(text).toContain("November 12, 2026 at 2:14 PM EST");
    expect(text).toContain(FINGERPRINT);
    expect(FINGERPRINT).toMatch(/^[0-9a-f]{64}$/);
    // Selected marks and their packages.
    expect(text).toContain("The Fold");
    expect(text).toContain("The Confidence Interval");
    expect(text).toContain("Enhanced");
    expect(text).toContain("Concierge");
    expect(text).toContain("Class: Gaming consoles");
    // Unselected package and classes are not in it.
    for (const never of ["Essential", "Online retail", "Consulting"]) expect(text, never).not.toContain(never);
  });

  it("Exhibit A comes after the last letter paragraph, and the signature record is the last block", async () => {
    const letter = rebuildSignedLetter(signedTrademark(), "America/New_York")!;
    const text = await textOf(signedTrademark());
    const lastBlock = squash(paragraphText(letter.blocks[letter.blocks.length - 1]));
    const lastAt = text.lastIndexOf(lastBlock.slice(0, 40));
    const exhibitAt = text.indexOf(letter.exhibit.title);
    const recordAt = text.indexOf("Signature record");
    expect(lastAt).toBeGreaterThan(-1);
    expect(exhibitAt).toBeGreaterThan(lastAt);
    expect(recordAt).toBeGreaterThan(exhibitAt);
    // The record is the last block: the fingerprint is the final thing after it.
    expect(text.trimEnd().endsWith(FINGERPRINT)).toBe(true);
    expect(text.lastIndexOf("Signature record")).toBe(recordAt);
  });

  it("names the file from the signer and the signed date in the firm's zone", () => {
    expect(signedLetterFileName("Sevetri Wilson", "2026-11-12T19:14:00.000Z", "America/New_York")).toBe("Sevetri-Wilson-engagement-letter-signed-2026-11-12.pdf");
    // 02:00 UTC on the 13th is still the 12th in New York.
    expect(signedLetterFileName("Alex", "2026-11-13T02:00:00.000Z", "America/New_York")).toContain("2026-11-12");
  });
});

describe("item 7: the signature record names the zone and carries the UTC time", () => {
  it("prints the local time with its zone and the same instant in UTC, ISO 8601", async () => {
    const text = await textOf(signedTrademark());
    expect(text).toContain("Signed electronically by Sevetri Wilson on November 12, 2026 at 2:14 PM EST.");
    expect(text).toContain("Signed: November 12, 2026 at 2:14 PM EST");
    expect(text).toContain("Signed (UTC): 2026-11-12T19:14:00.000Z");
  });

  it("another firm's zone reads in that zone, with the same UTC line", async () => {
    const { result } = await build(signedTrademark(), { firm: { displayName: "West Coast IP", timeZone: "America/Los_Angeles" } });
    if (!result.ok) throw new Error("no file");
    const text = await readBack(result.bytes);
    expect(text).toContain("Signed: November 12, 2026 at 11:14 AM PST");
    expect(text).toContain("Signed (UTC): 2026-11-12T19:14:00.000Z");
  });

  it("never builds with a missing firm name or zone (a failed read is the caller's to report)", async () => {
    expect((await build(signedTrademark(), { firm: { displayName: "", timeZone: "America/New_York" } })).result).toEqual({ ok: false });
    expect((await build(signedTrademark(), { firm: { displayName: "   ", timeZone: "America/New_York" } })).result).toEqual({ ok: false });
    expect((await build(signedTrademark(), { firm: { displayName: "RPB Law Firm", timeZone: "" } })).result).toEqual({ ok: false });
  });
});

describe("item 6: a fingerprint is never printed beside text it does not match", () => {
  it("the fixtures are real: the snapshot's sha256 is the sha256 of the text that is rebuilt", () => {
    const snapshot = signedTrademark();
    expect(agreementTextSha256(signedLetterText(rebuildSignedLetter(snapshot, "UTC")!))).toBe(snapshot.agreement!.sha256);
    expect(rebuiltTextMatches(snapshot)).toBe(true);
    expect(rebuiltTextMatches(signedGeneral())).toBe(true);
    expect(rebuiltTextMatches({ ...snapshot, agreement: { ...snapshot.agreement!, sha256: WRONG_FINGERPRINT } })).toBe(false);
    expect(rebuiltTextMatches(null)).toBe(false);
    expect(rebuiltTextMatches({ ...snapshot, schema: 1, agreement: undefined })).toBe(false);
  });

  it("MATCH: the rebuilt text hashes to the stored sha256, so the letter is built as before and the stored text is never read", async () => {
    const { result, readStored } = await build(signedTrademark());
    expect(result.ok && result.fromStoredText).toBe(false);
    expect(readStored).not.toHaveBeenCalled();
  });

  /** A signing made by OLDER code: the stored text differs from what today's code rebuilds from the snapshot. */
  function signedByOlderCode() {
    const today = signedTrademark();
    const storedText = `${storedTextOf(today)}\n\nA closing line that an earlier version of the letter renderer wrote.`;
    const sha256 = agreementTextSha256(storedText);
    const snapshot: AcceptedSnapshot = { ...today, agreement: { ...today.agreement!, sha256 } };
    return { snapshot, storedText, sha256 };
  }

  it("MISMATCH: the PDF is the stored signed text verbatim, with the stored fingerprint, and says so in a flag", async () => {
    const { snapshot, storedText, sha256 } = signedByOlderCode();
    expect(rebuiltTextMatches(snapshot)).toBe(false);
    const readStored = vi.fn(async () => ({ text: storedText, sha256 }));
    const { result } = await build(snapshot, { readStored });
    if (!result.ok) throw new Error("no file");
    expect(result.fromStoredText).toBe(true);
    expect(readStored).toHaveBeenCalledTimes(1);
    const text = await readBack(result.bytes);
    // Every paragraph of the stored text, in order, including the line only the stored text has.
    let at = 0;
    for (const para of storedText.split(/\n{2,}/)) {
      const found = text.indexOf(squash(para), at);
      expect(found, para.slice(0, 50)).toBeGreaterThan(-1);
      at = found;
    }
    expect(text).toContain("A closing line that an earlier version of the letter renderer wrote.");
    // The fingerprint printed is the one that covers exactly that text.
    expect(text).toContain(`Fingerprint (sha256): ${sha256}`);
    expect(text).not.toContain(FINGERPRINT);
    expect(text).toContain("Signed: November 12, 2026 at 2:14 PM EST");
    expect(text).toContain("Signed (UTC): 2026-11-12T19:14:00.000Z");
    expect(text.startsWith(FIRM.displayName)).toBe(true);
    expect(result.signerName).toBe("Sevetri Wilson");
  });

  it("MISMATCH and the stored text cannot be read: no file at all", async () => {
    const { snapshot } = signedByOlderCode();
    expect((await build(snapshot, { readStored: vi.fn(async () => null) })).result).toEqual({ ok: false });
    expect(
      (
        await build(snapshot, {
          readStored: vi.fn(async () => {
            throw new Error("boom");
          }),
        })
      ).result,
    ).toEqual({ ok: false });
  });

  it("MISMATCH and the stored text does not hash to the stored fingerprint: no file (never a fingerprint beside other text)", async () => {
    const { snapshot, storedText, sha256 } = signedByOlderCode();
    // The row's text was altered: it no longer hashes to its own sha256.
    expect((await build(snapshot, { readStored: vi.fn(async () => ({ text: `${storedText} tampered`, sha256 })) })).result).toEqual({ ok: false });
    // The row is self-consistent but is not the signature this snapshot records.
    const other = "Some other agreement entirely.";
    expect((await build(snapshot, { readStored: vi.fn(async () => ({ text: other, sha256: agreementTextSha256(other) })) })).result).toEqual({ ok: false });
    // An empty stored text.
    expect((await build(snapshot, { readStored: vi.fn(async () => ({ text: "", sha256: agreementTextSha256("") })) })).result).toEqual({ ok: false });
  });

  it("a snapshot that is not signed builds nothing", async () => {
    const s = signedTrademark();
    expect((await build({ ...s, schema: 1, agreement: undefined, signing: undefined })).result).toEqual({ ok: false });
    expect((await build(null as never)).result).toEqual({ ok: false });
  });

  it("there is ONE signed-PDF builder: nothing outside signed-pdf.ts builds a signed letter PDF", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx)$/.test(name)) {
          const src = readFileSync(path, "utf8");
          if (/mode:\s*"signed"/.test(src)) hits.push(path.replace(`${process.cwd()}/`, ""));
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(hits.sort()).toEqual(["src/lib/loe/signed-pdf.ts"]);
    // And every caller goes through it.
    for (const f of ["src/lib/proposals/public-letter.ts", "src/lib/loe/staff-download.ts", "src/lib/proposals/accept-followups.ts", "src/lib/proposals/paid-flow.ts"]) {
      expect(readFileSync(join(process.cwd(), f), "utf8"), f).toContain("buildVerifiedSignedPdf(");
    }
    expect(typeof signedLetterPdf).toBe("function");
  });

  it("the stored signed text is read only by its own file, fenced on the proposal's own org", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/loe/stored-agreement.ts"), "utf8");
    expect(src).toContain('"id, agreement_text, agreement_sha256"');
    expect(src).toMatch(/\.eq\("proposal_id", key\.proposalId\)\.eq\("org_id", key\.orgId\)/);
    expect(src).not.toMatch(/console\./);
    // The card's read still never selects it, and nothing else in src names the column.
    const card = readFileSync(join(process.cwd(), "src/lib/loe/signature-read.ts"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(card).not.toContain("agreement_text");
  });
});

describe("P5: the signed flat-fee PDF (Faithe Williams)", () => {
  it("has the matter, each work line, Value $1,250 and the $500 flat fee, and no USPTO, brand, package or class lines", async () => {
    const snapshot = signedGeneral();
    const letter = rebuildSignedLetter(snapshot, "America/New_York")!;
    expect(letter).not.toBeNull();
    const text = await textOf(snapshot);
    expect(text).toContain("Management agreement: notice of non-renewal and termination");
    for (const line of ["Review both management agreements", "Review all correspondence and evidence", "Draft the notice of non-renewal and termination"]) expect(text).toContain(line);
    expect(text).toMatch(/Value of the work[^$]*\$1,250/);
    expect(text).toContain("$1,250");
    expect(text).toContain("$500");
    expect(text).toContain("Faithe Williams");
    expect(text).not.toMatch(/USPTO/i);
    expect(text).not.toMatch(/Class:/);
    for (const pkg of ["Essential", "Enhanced", "Concierge"]) expect(text).not.toContain(pkg);
    for (const b of letter.blocks) expect(text).toContain(squash(paragraphText(b)));
    expect(JSON.stringify(letter.exhibit)).not.toMatch(/USPTO/);
    expect(letter.exhibit.usptoDue).toBeNull();
  });
});
