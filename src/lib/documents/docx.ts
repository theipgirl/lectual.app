import "server-only";
import { Document, Paragraph, TextRun, HeadingLevel, Packer, AlignmentType } from "docx";
import type { DocType, DocumentDraftRow } from "./types";
import { DOC_TYPE_LABEL } from "./types";

/**
 * Renders the REVIEWED draft text (whatever the attorney approved — edits
 * and all, item.final_body ?? item.draft_body from the queue) into a real
 * .docx: genuine paragraphs and headings, not a wall of text or an image.
 *
 * MVP simplification, stated plainly: this is a clean, correctly-structured
 * Word document, not a pixel-perfect reproduction of RPB Law's letterhead
 * template (firm/templates/opinion-letter-template.md's header-on-every-page,
 * justified first-line-indent body, etc.) — that level of fidelity, plus the
 * opinion-letter skill's Phase 2 tracked-changes redline workflow and the
 * combined letter+report PDF, is explicitly deferred. See the build report
 * for the full list of what's deferred vs. shipped.
 *
 * The renderer is a small markdown-ish → docx mapper because every content
 * builder in this module (opinion-letter.ts, loe.ts) produces its draft text
 * in that shape on purpose: `#`/`##` headings, `- ` bullets, blank-line
 * paragraph breaks. One mapper serves every doc_type rather than a bespoke
 * layout per type.
 */

function linesToParagraphs(text: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const lines = text.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim().length === 0) {
      continue; // blank lines just separate paragraphs; no empty runs.
    }
    if (line.startsWith("## ")) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(3).trim(),
          heading: HeadingLevel.HEADING_2,
          alignment: AlignmentType.CENTER,
        }),
      );
    } else if (line.startsWith("# ")) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(2).trim(),
          heading: HeadingLevel.HEADING_1,
        }),
      );
    } else if (line.startsWith("### ")) {
      paragraphs.push(
        new Paragraph({
          text: line.slice(4).trim(),
          heading: HeadingLevel.HEADING_3,
        }),
      );
    } else if (/^[-*]\s+/.test(line)) {
      paragraphs.push(
        new Paragraph({
          text: line.replace(/^[-*]\s+/, ""),
          bullet: { level: 0 },
        }),
      );
    } else {
      // Bold markers (**text**) render as a bold run; everything else plain.
      const parts = line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
      paragraphs.push(
        new Paragraph({
          children: parts.map((part) =>
            part.startsWith("**") && part.endsWith("**")
              ? new TextRun({ text: part.slice(2, -2), bold: true })
              : new TextRun(part),
          ),
          spacing: { after: 160 },
        }),
      );
    }
  }

  return paragraphs;
}

export type RenderedDocx = {
  buffer: Buffer;
  fileName: string;
};

/** File naming per the firm's conventions (opinion-letter-template.md's
 * "File naming" section; draft-engagement-letter's queue-note pattern). Falls
 * back to a generic name when the payload doesn't carry a client/mark. */
export function buildDocumentFileName(docType: DocType, payload: Record<string, unknown>): string {
  const entityName = typeof payload.entityName === "string" ? payload.entityName.trim() : "";
  const clientNameField = typeof payload.clientName === "string" ? payload.clientName.trim() : "";
  const clientOrEntity = entityName || clientNameField || "Client";
  if (docType === "opinion_letter") {
    const mark = typeof payload.markText === "string" && payload.markText.trim()
      ? payload.markText.trim()
      : "Mark";
    return `${clientOrEntity} - Opinion Letter DRAFT - ${mark}.docx`;
  }
  return `${clientOrEntity} - ${DOC_TYPE_LABEL[docType]}.docx`;
}

/**
 * Renders one document from its approved text. `content` is the reviewed
 * queue body (item.final_body ?? item.draft_body) — the source of truth for
 * what actually goes in the file, per the approval-queue rule that a human's
 * edits are authoritative.
 */
export async function renderDocumentDocx(
  draft: Pick<DocumentDraftRow, "doc_type" | "payload">,
  content: string,
): Promise<RenderedDocx> {
  const paragraphs = linesToParagraphs(content);
  const doc = new Document({
    sections: [
      {
        properties: {},
        children:
          paragraphs.length > 0
            ? paragraphs
            : [new Paragraph({ children: [new TextRun(content)] })],
      },
    ],
  });
  const buffer = await Packer.toBuffer(doc);
  return {
    buffer,
    fileName: buildDocumentFileName(draft.doc_type, draft.payload),
  };
}
