import "server-only";
import { DocumentFlowError } from "./errors";

/**
 * Server-side text extraction for an uploaded search report (opinion-letter
 * flow). Supports PDF (TMTKO exports as PDF) and .docx, the two formats a
 * TMTKO Knockout Report or an attorney's redlined draft actually arrives in.
 *
 * PDF extraction uses `unpdf`, NOT `pdf-parse`. `pdf-parse@2.4.5`'s table/
 * image/screenshot extraction features pull in `@napi-rs/canvas` (native,
 * platform-specific binaries) for `DOMMatrix`/`Path2D`/`ImageData` — that
 * optional dependency doesn't reliably link in Vercel's serverless build
 * (pnpm blocks its native build step unless explicitly allowlisted, same
 * class of issue `sharp`/`unrs-resolver` needed `allowBuilds` for), so real
 * PDF uploads threw "DOMMatrix is not defined" in production even though it
 * worked in local dev. `unpdf` ships a serverless-targeted PDF.js build with
 * no canvas/DOM dependency at all — the correct fix, not a workaround.
 * `mammoth` (.docx) has no such dependency and is unaffected; `docx` (also a
 * dependency) is the generator side, used only at approval time
 * (src/lib/documents/docx.ts).
 */

export type ExtractedDocument = {
  text: string;
  /** Best-effort page/paragraph count, for the UI ("12 pages extracted"). */
  units: number;
};

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB — TMTKO reports run long but not huge.

export class DocumentExtractionError extends DocumentFlowError {}

function extensionFor(mime: string, fileName: string): "pdf" | "docx" | null {
  if (mime === "application/pdf" || fileName.toLowerCase().endsWith(".pdf")) return "pdf";
  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.toLowerCase().endsWith(".docx")
  ) {
    return "docx";
  }
  return null;
}

/**
 * Extracts plain text from an uploaded PDF or .docx. Throws
 * DocumentExtractionError (a user-facing message — surface it as-is) for an
 * unsupported type, an oversized file, or a file that fails to parse.
 */
export async function extractTextFromUpload(
  bytes: Uint8Array,
  mime: string,
  fileName: string,
): Promise<ExtractedDocument> {
  if (bytes.byteLength === 0) {
    throw new DocumentExtractionError("That file is empty.");
  }
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new DocumentExtractionError("That file is too large — keep uploads under 20 MB.");
  }

  const kind = extensionFor(mime, fileName);
  if (!kind) {
    throw new DocumentExtractionError(
      "Unsupported file type — upload the search report as a PDF or .docx.",
    );
  }

  try {
    if (kind === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(bytes);
      const { totalPages, text: pages } = await extractText(pdf, { mergePages: false });
      const text = pages.join("\n\n").trim();
      if (!text) {
        throw new DocumentExtractionError(
          "No text could be read from that PDF — it may be a scanned image without OCR.",
        );
      }
      return { text, units: totalPages };
    }

    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    const text = result.value.trim();
    if (!text) {
      throw new DocumentExtractionError("No text could be read from that .docx file.");
    }
    // mammoth has no page concept; count non-empty paragraphs as a rough unit.
    const units = text.split(/\n+/).filter((line) => line.trim().length > 0).length;
    return { text, units };
  } catch (err) {
    if (err instanceof DocumentExtractionError) throw err;
    throw new DocumentExtractionError(
      `Could not read that file: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
