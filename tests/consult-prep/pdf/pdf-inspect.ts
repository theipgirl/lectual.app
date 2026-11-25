// Test-side PDF inspection: read back what a rendered packages PDF actually
// contains (text through each font's ToUnicode map, and the font resources),
// without poppler or any other external tool. Used by the PDF tests only.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFPage,
} from 'pdf-lib';

export type FontInfo = {
  resourceName: string;
  baseFont: string;
  subtype: string;
  /** A FontFile/FontFile2/FontFile3 stream is present on the descriptor. */
  embedded: boolean;
};

function streamBytes(stream: PDFStream): Uint8Array {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  return stream.getContents();
}

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('latin1');
}

function fontDict(page: PDFPage): PDFDict | undefined {
  const res = page.node.Resources();
  return res?.lookupMaybe(PDFName.of('Font'), PDFDict);
}

export function pageFonts(page: PDFPage): FontInfo[] {
  const dict = fontDict(page);
  if (!dict) return [];
  return dict.entries().map(([name, ref]) => {
    const font = page.doc.context.lookup(ref, PDFDict);
    const baseFont = font.lookupMaybe(PDFName.of('BaseFont'), PDFName)?.decodeText() ?? '';
    const subtype = font.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() ?? '';
    let descriptor = font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
    const descendants = font.lookupMaybe(PDFName.of('DescendantFonts'), PDFArray);
    if (!descriptor && descendants) {
      const d = descendants.lookup(0, PDFDict);
      descriptor = d.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
    }
    const embedded = ['FontFile', 'FontFile2', 'FontFile3'].some((k) => descriptor?.get(PDFName.of(k)) instanceof PDFRef);
    return { resourceName: name.decodeText(), baseFont, subtype, embedded };
  });
}

function parseCmap(src: string): Map<number, string> {
  const map = new Map<number, string>();
  const hexToStr = (hex: string) => {
    let s = '';
    for (let i = 0; i < hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    return s;
  };
  for (const block of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) map.set(parseInt(m[1], 16), hexToStr(m[2]));
  }
  for (const block of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      const lo = parseInt(m[1], 16);
      const hi = parseInt(m[2], 16);
      const base = parseInt(m[3], 16);
      for (let g = lo; g <= hi; g++) map.set(g, String.fromCodePoint(base + g - lo));
    }
  }
  return map;
}

function cmaps(page: PDFPage): Map<string, Map<number, string>> {
  const out = new Map<string, Map<number, string>>();
  const dict = fontDict(page);
  if (!dict) return out;
  for (const [name, ref] of dict.entries()) {
    const font = page.doc.context.lookup(ref, PDFDict);
    const tu = font.lookupMaybe(PDFName.of('ToUnicode'), PDFStream);
    if (tu) out.set(name.decodeText(), parseCmap(text(streamBytes(tu))));
  }
  return out;
}

function contentSource(page: PDFPage): string {
  const contents = page.node.Contents();
  if (!contents) return '';
  if (contents instanceof PDFArray) {
    return contents
      .asArray()
      .map((r) => text(streamBytes(page.doc.context.lookup(r, PDFStream))))
      .join('\n');
  }
  return text(streamBytes(contents));
}

export type TextRun = { font: string; baseFont: string; text: string; y: string };

/** Every shown string on the page, decoded glyph by glyph through its font's ToUnicode map. */
export function pageRuns(page: PDFPage): TextRun[] {
  const maps = cmaps(page);
  const bases = new Map(pageFonts(page).map((f) => [f.resourceName, f.baseFont]));
  const src = contentSource(page);
  let font = '';
  let y = '';
  const runs: TextRun[] = [];
  const re = /\/([^\s/]+)\s+[\d.]+\s+Tf|[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+Tm|<([0-9a-fA-F]*)>\s*Tj/g;
  for (const m of src.matchAll(re)) {
    if (m[1]) font = m[1];
    else if (m[2] !== undefined) y = m[2];
    else if (m[3] !== undefined) {
      const map = maps.get(font);
      let text = '';
      for (let i = 0; i < m[3].length; i += 4) text += map?.get(parseInt(m[3].slice(i, i + 4), 16)) ?? '\uFFFD';
      runs.push({ font, baseFont: bases.get(font) ?? '', text, y });
    }
  }
  return runs;
}

/**
 * The page's text. Strings drawn on the same baseline are joined directly; a
 * new baseline starts with a space. Whitespace is collapsed.
 */
export function pageText(page: PDFPage): string {
  let out = '';
  let lastY: string | null = null;
  for (const r of pageRuns(page)) {
    if (lastY !== null && r.y !== lastY) out += ' ';
    lastY = r.y;
    out += r.text;
  }
  return out.replace(/\s+/g, ' ').trim();
}

export async function inspectPdf(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  return {
    doc,
    pages,
    sizes: pages.map((p) => p.getSize()),
    texts: pages.map(pageText),
    runs: pages.map(pageRuns),
    fonts: pages.map(pageFonts),
    contents: pages.map(contentSource),
  };
}
