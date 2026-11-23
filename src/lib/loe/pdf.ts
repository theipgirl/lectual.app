import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { REVIEW_COPY_MARK } from "./client-words";
import type { LetterLogo } from "./letter-logo";
import type { Exhibit } from "./exhibit";
import { hasStyle, splitFirstLine } from "./letter-styles";
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
  /**
   * The firm's own logo (RPB only today, `letterLogoForSlug`), drawn centred at the top of page 1 before the letterhead. A logo whose
   * file cannot be read is simply not drawn: never a broken picture, never a failed letter.
   */
  logo?: LetterLogo | null;
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

/** The logo's width on the page, in points (the file is 984 x 168). */
export const LOGO_WIDTH_PT = 200;

/**
 * Reads a `/brand/` logo from `public/` with `fs` from the project root, the way the fonts are read (so `next.config.ts` lists the file
 * for the routes that build a PDF). Null when it is not a `/brand/` file or cannot be read.
 */
export function loadLogoBytes(logo: LetterLogo | null | undefined): Buffer | null {
  if (!logo || !logo.src.startsWith("/brand/") || logo.src.includes("..")) return null;
  try {
    return readFileSync(join(process.cwd(), "public", logo.src));
  } catch {
    return null;
  }
}

const MARGIN = 64;
const BODY = 10;
const GAP = 7;
/** `small` paragraphs (the letterhead address line). */
const SMALL = 8.5;
/** `indent`: 2.25in, about a third of the letter page, as in the firm's Word letter. */
export const INDENT_PT = 2.25 * 72;

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

  // The firm's logo, centred, first on page 1. Aspect ratio kept (width only).
  const logoBytes = loadLogoBytes(input.logo);
  let logoDrawn = false;
  if (logoBytes) {
    try {
      const top = doc.y;
      doc.image(logoBytes, left + (width - LOGO_WIDTH_PT) / 2, top, { width: LOGO_WIDTH_PT });
      doc.x = left;
      doc.y = top + LOGO_WIDTH_PT * (168 / 984) + 12;
      logoDrawn = true;
    } catch {
      // An unreadable picture is left out; the letter goes on without it.
    }
  }

  // The letterhead line: the firm's display name, first on the first page, before any paragraph of the letter.
  // When the firm's logo was drawn it already names the firm, so the text line is left out. A thin rule follows the letterhead
  // unless the letter draws its own rule under its first lines (a `rule-below` paragraph, as RPB's address line does).
  const letterDrawsRule = !(input.mode === "signed" && typeof input.storedText === "string") && input.blocks.some((b) => hasStyle(b, "rule-below"));
  const letterhead = logoDrawn ? "" : (input.firmName ?? "").replace(/\s+/g, " ").trim();
  if (logoDrawn && !letterDrawsRule) {
    doc.moveTo(left, doc.y).lineTo(left + width, doc.y).strokeColor("#999999").lineWidth(0.5).stroke();
    doc.moveDown(0.8);
    doc.font("Regular").fontSize(BODY).fillColor("#000000");
  }
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
    // The full letter: every paragraph, in order, bold lead-in first, each drawn in the template's own style.
    for (const block of input.blocks) writeBlock(doc, block, left, width);

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

type Run = { text: string; font: "Bold" | "Regular"; underline?: boolean };

/**
 * One paragraph of the letter. A block with no style is drawn exactly as before (lead-in in bold, then the text). The styles
 * (`letter-styles.ts`): `center` centres, `bold` sets the whole paragraph in bold, `small` uses the smaller size, `indent` starts
 * it 2.25in in, `space-before` adds a line of space above, `bold-underline-first-line` sets the first line in bold underlined,
 * `rule-below` draws a thick black rule across the full width under it.
 */
function writeBlock(doc: PDFKit.PDFDocument, block: LetterBlock, left: number, width: number) {
  if (!block.style || block.style.length === 0) {
    doc.x = left;
    if (block.lead) {
      doc.font("Bold").text(block.lead, { width, continued: block.text.length > 0 });
      if (block.text.length > 0) doc.font("Regular").text(` ${block.text}`, { width });
      doc.font("Regular");
    } else {
      doc.font("Regular").text(block.text, { width });
    }
    doc.moveDown(GAP / BODY);
    return;
  }

  const size = hasStyle(block, "small") ? SMALL : BODY;
  const base: Run["font"] = hasStyle(block, "bold") ? "Bold" : "Regular";
  const x = hasStyle(block, "indent") ? left + INDENT_PT : left;
  const w = hasStyle(block, "indent") ? width - INDENT_PT : width;
  const align = hasStyle(block, "center") ? "center" : "left";

  const runs: Run[] = [];
  const text = block.lead && block.text.length > 0 ? ` ${block.text}` : block.text;
  if (block.lead) runs.push({ text: block.lead, font: "Bold" });
  if (hasStyle(block, "bold-underline-first-line")) {
    const { first, rest } = splitFirstLine(text);
    if (first.length > 0) runs.push({ text: first, font: "Bold", underline: true });
    if (rest.length > 0) runs.push({ text: rest, font: base });
  } else if (text.length > 0) {
    runs.push({ text, font: base });
  }

  if (hasStyle(block, "space-before")) doc.moveDown(0.9);
  doc.fontSize(size).fillColor("#000000");
  const y = doc.y;
  runs.forEach((run, i) => {
    const options = { width: w, align, underline: run.underline === true, continued: i < runs.length - 1 } as const;
    doc.font(run.font);
    if (i === 0) doc.text(run.text, x, y, options);
    else doc.text(run.text, options);
  });
  doc.font("Regular").fontSize(BODY);
  if (hasStyle(block, "rule-below")) {
    const ruleY = doc.y + 3;
    doc.moveTo(left, ruleY).lineTo(left + width, ruleY).strokeColor("#000000").lineWidth(2).stroke();
    doc.y = ruleY + 4;
  }
  doc.x = left;
  doc.moveDown(GAP / BODY);
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
