import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { REVIEW_COPY_MARK } from "./client-words";
import type { Exhibit } from "./exhibit";
import type { LetterBlock } from "./render";
import type { SignerDetails } from "./signing";

/**
 * The ONE builder of the engagement letter as a PDF: the client's review copy before signing, the signed copy after, and
 * (Sprint 6) the staff download and the file sent to Lawmatics. There is no other format of the letter and no docx.
 *
 * Library: pdfkit 0.20.2 (pure JavaScript, MIT, no native build, exact-pinned). It embeds a TrueType font through fontkit, so
 * a name like "Nguyễn Thị Ánh-Dương" or an address like "Ærøskøbing 12, 5970 Ærø" is drawn and stays searchable text.
 *
 * Font: DejaVu Sans (regular and bold), bundled in `./fonts/` with its licence. It is read with `fs` from the project root, so
 * Next's file tracing must be told to ship it: `outputFileTracingIncludes` in `next.config.ts` lists `./src/lib/loe/fonts/**`
 * for the routes whose server actions build a PDF. No font is fetched at run time and no standard PDF font is used (the
 * default font is the embedded one, so pdfkit never reads its own font data files).
 *
 * Built from stored letter blocks and the recomputed exhibit, never from browser text. Deterministic apart from the PDF's
 * own creation date. Logs nothing.
 */

export type PdfMode = "review" | "signed";

export type PdfSignature = {
  signerName: string;
  /** "November 12, 2026 at 2:14 PM EST": the firm's zone, always named. */
  signedAtText: string;
  /** The same instant in UTC, ISO 8601 ("2026-11-12T19:14:03.000Z"). Printed in the signature record beside the local time. */
  signedAtUtc: string;
  /**
   * The sha256 (hex) of exactly the text printed above it. The caller must have checked that: a fingerprint is never printed
   * beside text it does not match (`buildVerifiedSignedPdf`).
   */
  fingerprint: string;
  signatureId?: string | null;
};

export type BuildLetterPdfInput = {
  blocks: readonly LetterBlock[];
  exhibit: Exhibit;
  /**
   * Signed mode only: the STORED signed text (`client_proposal_signature.agreement_text`), drawn verbatim as plain paragraphs
   * INSTEAD of `blocks` and the exhibit table. Used when today's code no longer rebuilds the text that was signed: the file
   * then holds exactly the text the stored fingerprint covers.
   */
  storedText?: string;
  details: SignerDetails;
  mode: PdfMode;
  /** Required for `signed`. */
  signature?: PdfSignature;
  firmName?: string;
  /** Document title ("Engagement letter"). */
  title?: string;
};

const FONT_DIR = join(process.cwd(), "src", "lib", "loe", "fonts");

let fonts: { regular: Buffer; bold: Buffer } | null = null;
function loadFonts(): { regular: Buffer; bold: Buffer } {
  fonts ??= {
    regular: readFileSync(join(FONT_DIR, "DejaVuSans.ttf")),
    bold: readFileSync(join(FONT_DIR, "DejaVuSans-Bold.ttf")),
  };
  return fonts;
}

const MARGIN = 64;
const BODY = 10;
const GAP = 7;

export async function buildLetterPdf(input: BuildLetterPdfInput): Promise<Uint8Array> {
  if (input.mode === "signed" && !input.signature) throw new Error("A signed letter needs its signature record.");
  const { regular, bold } = loadFonts();
  const doc = new PDFDocument({
    size: "LETTER",
    margins: { top: MARGIN + 10, bottom: MARGIN, left: MARGIN, right: MARGIN },
    font: regular,
    bufferPages: true,
    info: {
      Title: input.title ?? "Engagement letter",
      Author: input.firmName ?? "",
      Creator: "Lectual",
      Producer: "Lectual",
    },
  });
  doc.registerFont("Bold", bold);
  doc.registerFont("Regular", regular);

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const header = () => {
    if (input.mode !== "review") return;
    const keepY = doc.y;
    doc.font("Bold").fontSize(8.5).fillColor("#7a1f1f").text(REVIEW_COPY_MARK, left, 30, { width, lineBreak: false });
    doc.fillColor("#000000").font("Regular").fontSize(BODY);
    doc.x = left;
    doc.y = keepY;
  };
  header();
  doc.on("pageAdded", () => {
    header();
    doc.x = left;
    doc.y = doc.page.margins.top;
  });

  doc.font("Regular").fontSize(BODY).fillColor("#000000");

  // The letterhead line: the firm's display name, first on the first page, before any paragraph of the letter.
  const letterhead = (input.firmName ?? "").replace(/\s+/g, " ").trim();
  if (letterhead) {
    doc.font("Bold").fontSize(14).text(letterhead, left, doc.y, { width });
    doc.moveDown(0.3);
    doc
      .moveTo(left, doc.y)
      .lineTo(left + width, doc.y)
      .strokeColor("#999999")
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.8);
    doc.font("Regular").fontSize(BODY).fillColor("#000000");
  }

  if (input.mode === "signed" && typeof input.storedText === "string") {
    // The stored signed text, verbatim: one plain paragraph per blank-line-separated block, line breaks kept. No lead-ins in
    // bold and no exhibit table are re-derived, because the text itself is what was signed.
    for (const para of input.storedText.split(/\n{2,}/)) {
      if (para.length === 0) continue;
      doc.x = left;
      doc.font("Regular").text(para, { width });
      doc.moveDown(GAP / BODY);
    }
  } else {
    // The full letter: every paragraph, in order, bold lead-in first.
    for (const block of input.blocks) {
      doc.x = left;
      if (block.lead) {
        doc.font("Bold").text(block.lead, { width, continued: block.text.length > 0 });
        if (block.text.length > 0) doc.font("Regular").text(` ${block.text}`, { width });
        doc.font("Regular");
      } else {
        doc.font("Regular").text(block.text, { width });
      }
      doc.moveDown(GAP / BODY);
    }

    writeExhibit(doc, input.exhibit, left, width);
  }

  if (input.mode === "signed" && input.signature) writeSignature(doc, input.signature, input.details, left, width);

  // Page numbers (bufferPages): written below the bottom margin, so the margin is lifted while drawing them.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Regular").fontSize(8).fillColor("#555555");
    doc.text(`Page ${i + 1} of ${range.count}`, left, doc.page.height - 40, { width, align: "center", lineBreak: false });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  await finished;
  return new Uint8Array(Buffer.concat(chunks));
}

function ensureRoom(doc: PDFKit.PDFDocument, needed: number) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

function writeExhibit(doc: PDFKit.PDFDocument, exhibit: Exhibit, left: number, width: number) {
  doc.addPage();
  doc.x = left;
  doc.font("Bold").fontSize(12).text(exhibit.title, left, doc.y, { width });
  doc.moveDown(0.8);
  const amountW = 90;
  const labelW = width - amountW - 10;

  for (const g of exhibit.groups) {
    ensureRoom(doc, 60);
    doc.font("Bold").fontSize(BODY + 1).text(g.title, left, doc.y, { width });
    doc.moveDown(0.3);
    for (const r of g.rows) {
      ensureRoom(doc, 30);
      const y = doc.y;
      const text = r.detail ? `${r.label} (${r.detail})` : r.label;
      doc.font("Regular").fontSize(BODY).text(text, left + 8, y, { width: labelW - 8 });
      const endY = doc.y;
      if (r.amount) doc.font("Regular").text(r.amount, left + width - amountW, y, { width: amountW, align: "right" });
      doc.y = endY;
      doc.x = left;
    }
    doc.moveDown(0.6);
  }

  const totals = [exhibit.legalDue, ...(exhibit.usptoDue ? [exhibit.usptoDue] : [])];
  ensureRoom(doc, 60);
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor("#999999").lineWidth(0.5).stroke();
  doc.moveDown(0.5);
  for (const t of totals) {
    ensureRoom(doc, 30);
    const y = doc.y;
    doc.font("Bold").fontSize(BODY + 1).text(t.label, left, y, { width: labelW });
    const endY = doc.y;
    doc.text(t.amount, left + width - amountW, y, { width: amountW, align: "right" });
    doc.y = endY;
    doc.x = left;
    doc.moveDown(0.3);
  }
  doc.font("Regular").fontSize(BODY);
}

function writeSignature(doc: PDFKit.PDFDocument, sig: PdfSignature, details: SignerDetails, left: number, width: number) {
  doc.moveDown(1.5);
  ensureRoom(doc, 190);
  doc.x = left;
  doc.font("Bold").fontSize(11).text("Signature record", left, doc.y, { width });
  doc.moveDown(0.4);
  const line = (label: string, value: string) => {
    doc.font("Bold").fontSize(BODY).text(`${label}: `, left, doc.y, { width, continued: true });
    doc.font("Regular").text(value, { width });
  };
  doc.font("Regular").fontSize(BODY).text(`Signed electronically by ${sig.signerName} on ${sig.signedAtText}.`, left, doc.y, { width });
  doc.moveDown(0.4);
  line("Signer", sig.signerName);
  line("Signed", sig.signedAtText);
  if (sig.signedAtUtc) line("Signed (UTC)", sig.signedAtUtc);
  if (details.entity_name) line("On behalf of", details.entity_name);
  if (details.title) line("Title", details.title);
  line("Fingerprint (sha256)", sig.fingerprint);
  doc.x = left;
}
