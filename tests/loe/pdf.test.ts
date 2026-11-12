import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { buildLetterPdf } from "@/lib/loe/pdf";
import { buildExhibit } from "@/lib/loe/exhibit";
import { emptyDetails } from "@/lib/loe/signing";
import { money } from "@/components/client-proposal/format";
import { quoteWithClientClasses } from "@/lib/proposals/client-classes";
import { defaultSelection } from "@/lib/proposals/pricing";
import { sevetri } from "../proposals/fixture";
import { REVIEW_COPY_MARK } from "@/lib/loe/client-words";
import { TEST_DETAILS, fullLetterBlocks, paragraphText, squash } from "./full-letter-fixture";

async function readBack(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return squash(text);
}

/** Page chrome (the review mark on every page, "Page n of N") is not letter text; it can fall inside a paragraph that spans pages. */
function body(text: string): string {
  return squash(text.split(REVIEW_COPY_MARK).join(" ").replace(/Page \d+ of \d+/g, " "));
}

function exhibitForSevetri() {
  const content = sevetri();
  const priced = quoteWithClientClasses(content, defaultSelection(content), { entries: {}, added: {} });
  if (!priced.ok) throw new Error("no quote");
  return buildExhibit(priced.content, priced.quote, money);
}

const SIGNATURE = { signerName: "Sevetri Wilson", signedAtText: "November 12, 2026 at 2:14 PM", fingerprint: "ab".repeat(32) };

describe("buildLetterPdf", () => {
  it("the review copy holds every paragraph of the full letter, the exhibit and the review mark", async () => {
    const blocks = fullLetterBlocks();
    const exhibit = exhibitForSevetri();
    const bytes = await buildLetterPdf({ blocks, exhibit, details: TEST_DETAILS, mode: "review" });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const text = await readBack(bytes);
    for (const b of blocks) expect(body(text), paragraphText(b).slice(0, 60)).toContain(squash(paragraphText(b)));
    expect(blocks.length).toBeGreaterThan(20);
    expect(text).toContain(REVIEW_COPY_MARK);
    expect(text).toContain(exhibit.title);
    for (const g of exhibit.groups) {
      expect(text).toContain(g.title);
      for (const r of g.rows) if (r.amount) expect(text).toContain(r.amount);
    }
    expect(text).toContain(exhibit.legalDue.amount);
    expect(text).not.toContain("Signature record");
  });

  it("the signed copy holds the full letter, the exhibit, the signer, the time and the fingerprint, and no review mark", async () => {
    const blocks = fullLetterBlocks();
    const exhibit = exhibitForSevetri();
    const bytes = await buildLetterPdf({ blocks, exhibit, details: TEST_DETAILS, mode: "signed", signature: SIGNATURE });
    const text = await readBack(bytes);
    for (const b of blocks) expect(body(text)).toContain(squash(paragraphText(b)));
    expect(text).toContain("Signed electronically by Sevetri Wilson on November 12, 2026 at 2:14 PM");
    expect(text).toContain(SIGNATURE.fingerprint);
    expect(text).not.toContain(REVIEW_COPY_MARK);
    for (const r of exhibit.groups.flatMap((g) => g.rows)) if (r.amount) expect(text).toContain(r.amount);
  });

  it("keeps any letters: a Vietnamese name and a Danish address come back out of the PDF unchanged", async () => {
    const details = { ...emptyDetails(), client_name: "Nguyễn Thị Ánh-Dương", street: "Ærøskøbing 12, 5970 Ærø", city: "Ærø" };
    const blocks = [{ lead: null, text: "Nguyễn Thị Ánh-Dương\nÆrøskøbing 12, 5970 Ærø" }];
    const bytes = await buildLetterPdf({ blocks, exhibit: exhibitForSevetri(), details, mode: "signed", signature: { ...SIGNATURE, signerName: "Nguyễn Thị Ánh-Dương" } });
    const text = await readBack(bytes);
    expect(text).toContain("Nguyễn Thị Ánh-Dương");
    expect(text).toContain("Ærøskøbing 12, 5970 Ærø");
  });

  it("refuses to build a signed copy with no signature record", async () => {
    await expect(buildLetterPdf({ blocks: fullLetterBlocks(), exhibit: exhibitForSevetri(), details: TEST_DETAILS, mode: "signed" })).rejects.toThrow();
  });
});
