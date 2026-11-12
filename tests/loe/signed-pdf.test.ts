import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { rebuildSignedLetter } from "@/lib/loe/signed-letter";
import { buildSignedLetterPdf, signedLetterFileName } from "@/lib/loe/signed-pdf";
import { buildLetterPdf } from "@/lib/loe/pdf";
import { signedLetterPdf } from "@/lib/proposals/public-letter";
import { fullLetterBody, paragraphText, squash } from "./full-letter-fixture";
import { FINGERPRINT, signedGeneral, signedTrademark } from "./signed-fixtures";

async function readBack(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return squash(text.replace(/Page \d+ of \d+/g, " "));
}

const FIRM = { displayName: "RPB Law Firm", title: "Engagement letter" };

describe("P2: the signed trademark PDF", () => {
  it("holds every paragraph of the full letter, the signer, the time, the fingerprint, the selected marks and packages, and nothing unselected", async () => {
    const snapshot = signedTrademark();
    const letter = rebuildSignedLetter(snapshot, "America/New_York")!;
    const bytes = await buildSignedLetterPdf(letter, FIRM);
    expect(Buffer.from(bytes.slice(0, 4)).toString()).toBe("%PDF");
    const text = await readBack(bytes);

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
    expect(text).toContain("November 12, 2026 at 2:14 PM");
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
    const text = await readBack(await buildSignedLetterPdf(letter, FIRM));
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

  it("is built by the one builder: the client's signed download and the staff file read back the same text", async () => {
    const snapshot = signedTrademark();
    const letter = rebuildSignedLetter(snapshot, "America/New_York")!;
    const staff = await readBack(await buildSignedLetterPdf(letter, FIRM));
    const direct = await readBack(
      await buildLetterPdf({
        blocks: letter.blocks,
        exhibit: letter.exhibit,
        details: letter.details,
        mode: "signed",
        signature: { signerName: letter.signerName, signedAtText: letter.signedAtText, fingerprint: letter.fingerprint, signatureId: letter.signatureId },
        firmName: FIRM.displayName,
        title: "Engagement letter",
      }),
    );
    expect(staff).toBe(direct);
    expect(typeof signedLetterPdf).toBe("function");
  });

  it("names the file from the signer and the signed date in the firm's zone", () => {
    expect(signedLetterFileName("Sevetri Wilson", "2026-11-12T19:14:00.000Z", "America/New_York")).toBe("Sevetri-Wilson-engagement-letter-signed-2026-11-12.pdf");
    // 02:00 UTC on the 13th is still the 12th in New York.
    expect(signedLetterFileName("Alex", "2026-11-13T02:00:00.000Z", "America/New_York")).toContain("2026-11-12");
  });
});

describe("P5: the signed flat-fee PDF (Faithe Williams)", () => {
  it("has the matter, each work line, Value $1,250 and the $500 flat fee, and no USPTO, brand, package or class lines", async () => {
    const snapshot = signedGeneral();
    const letter = rebuildSignedLetter(snapshot, "America/New_York")!;
    expect(letter).not.toBeNull();
    const text = await readBack(await buildSignedLetterPdf(letter, FIRM));
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
