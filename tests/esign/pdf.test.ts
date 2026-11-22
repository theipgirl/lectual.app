import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { ADOBE_DATE_TAG, ADOBE_SIGNATURE_TAG, SIGNATURE_BLOCK_HEADING, buildLetterPdf } from "@/lib/loe/pdf";
import { buildExhibit } from "@/lib/loe/exhibit";
import { agreementText } from "@/lib/loe/signing";
import { money } from "@/components/client-proposal/format";
import { quoteWithClientClasses } from "@/lib/proposals/client-classes";
import { defaultSelection } from "@/lib/proposals/pricing";
import { REVIEW_COPY_MARK } from "@/lib/loe/client-words";
import { callum } from "../proposals/fixture";
import { TEST_DETAILS, fullLetterBlocks, squash } from "../loe/full-letter-fixture";

function exhibit() {
  const content = callum();
  const priced = quoteWithClientClasses(content, defaultSelection(content), { entries: {}, added: {} });
  if (!priced.ok) throw new Error("no quote");
  return buildExhibit(priced.content, priced.quote, money);
}

async function text(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: true });
  return squash(text.replace(/Page \d+ of \d+/g, " "));
}

describe("AT2: the for-signature PDF", () => {
  it("AT2: its words up to the signature block are exactly the stored agreement text; the text tags appear only after it", async () => {
    const blocks = fullLetterBlocks({ typedName: "Jordan Sample", dateText: "October 20, 2026" });
    const ex = exhibit();
    const stored = agreementText(blocks, ex);
    const bytes = await buildLetterPdf({ blocks, exhibit: ex, details: TEST_DETAILS, mode: "for-signature", firmName: "RPB Law Firm", title: "Engagement letter" });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
    const all = await text(bytes);
    const at = all.indexOf(SIGNATURE_BLOCK_HEADING);
    expect(at).toBeGreaterThan(0);
    // The letterhead line (the firm's name, page chrome) is not letter text.
    const words = squash(all.slice(0, at).replace(/^RPB Law Firm /, ""));
    expect(words).toBe(squash(stored));
    const after = all.slice(at);
    expect(all.indexOf(ADOBE_SIGNATURE_TAG)).toBeGreaterThan(at);
    expect(after).toContain(ADOBE_SIGNATURE_TAG);
    expect(after).toContain(ADOBE_DATE_TAG);
    expect(all.slice(0, at)).not.toContain("{{");
    // No review banner and no signature record.
    expect(all).not.toContain(REVIEW_COPY_MARK);
    expect(all).not.toContain("Signature record");
    // Pinned: the fixture's stored text.
    expect(createHash("sha256").update(stored, "utf8").digest("hex")).toBe("675be39b1daf7120ed06fe879cfc8f2d8fa2e096fa1e13e7ca0a5907ec00125e");
  });
});
