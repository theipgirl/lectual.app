import { describe, it, expect } from "vitest";
import { Document, Paragraph, TextRun, Packer } from "docx";
import { extractTextFromUpload, DocumentExtractionError } from "@/lib/documents/extract";

async function buildTestDocx(text: string): Promise<Uint8Array> {
  const doc = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun(text)] })] }],
  });
  const buffer = await Packer.toBuffer(doc);
  return new Uint8Array(buffer);
}

// A minimal hand-built single-page PDF (no external PDF generator dependency
// in this repo) — enough to prove real PDF bytes make it through unpdf's
// getDocumentProxy/extractText without the native-canvas DOMMatrix failure
// pdf-parse@2.4.5 hit in production (see extract.ts's header comment).
function buildTestPdf(text: string): Uint8Array {
  const stream = `BT /F1 18 Tf 10 100 Td (${text}) Tj ET`;
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 300 144]/Contents 5 0 R>>endobj
4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
5 0 obj<</Length ${stream.length}>>stream
${stream}
endstream
endobj
trailer<</Size 6/Root 1 0 R>>
%%EOF`;
  return new TextEncoder().encode(pdf);
}

describe("extractTextFromUpload", () => {
  it("extracts text from a real PDF (regression: pdf-parse's native canvas dependency threw 'DOMMatrix is not defined' in production)", async () => {
    const bytes = buildTestPdf("Hello TMTKO test");
    const result = await extractTextFromUpload(bytes, "application/pdf", "report.pdf");
    expect(result.text).toContain("Hello TMTKO test");
    expect(result.units).toBe(1);
  });

  it("extracts text from a .docx (round-trip against the docx package this app also generates with)", async () => {
    const bytes = await buildTestDocx("MARKNAME federal registration U.S. Reg. No. 1234567");
    const result = await extractTextFromUpload(
      bytes,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "report.docx",
    );
    expect(result.text).toContain("MARKNAME federal registration U.S. Reg. No. 1234567");
    expect(result.units).toBeGreaterThan(0);
  });

  it("detects .docx by file extension when the browser sends a generic mime type", async () => {
    const bytes = await buildTestDocx("Hello from a report");
    const result = await extractTextFromUpload(bytes, "application/octet-stream", "report.docx");
    expect(result.text).toContain("Hello from a report");
  });

  it("rejects an unsupported file type", async () => {
    await expect(
      extractTextFromUpload(new Uint8Array([1, 2, 3]), "image/png", "report.png"),
    ).rejects.toThrow(DocumentExtractionError);
  });

  it("rejects an empty file", async () => {
    await expect(
      extractTextFromUpload(new Uint8Array([]), "application/pdf", "report.pdf"),
    ).rejects.toThrow(/empty/i);
  });

  it("rejects an oversized file", async () => {
    const big = new Uint8Array(21 * 1024 * 1024);
    await expect(
      extractTextFromUpload(big, "application/pdf", "report.pdf"),
    ).rejects.toThrow(/too large/i);
  });

  it("rejects a .docx with no extractable text", async () => {
    const bytes = await buildTestDocx("");
    await expect(
      extractTextFromUpload(
        bytes,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "empty.docx",
      ),
    ).rejects.toThrow(/no text/i);
  });
});
