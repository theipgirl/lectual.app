// A small drawing and text-layout layer over pdf-lib for the packages PDF.
//
// pdf-lib draws, it does not lay out. This module supplies what the Python
// renderer got from a browser's CSS engine: font metrics for CSS line boxes,
// greedy word wrap across mixed-style runs, letter-spacing, glyph-coverage
// fallback, and rounded shapes. Coordinates here are TOP-DOWN in points (as in
// the CSS), converted to PDF's bottom-up space at the last moment.
//
// Glyph coverage: none of the brand faces has "≈", so it is drawn as a vector
// (two copies of the face's own tilde outline). Any other character a face
// lacks (emoji, CJK, …) is drawn as "?" and counted, so a render never fails on
// an encoding error and never draws a .notdef box.

import * as fontkitNs from '@pdf-lib/fontkit';
import {
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  setCharacterSpacing,
  setLineJoin,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';
import { EMBED_NAMES, type FaceKey } from './fonts';
import { color, type ColorName } from './palette';

// The package ships a UMD bundle; depending on the loader the namespace or its
// default export carries `create`.
type FontkitModule = typeof fontkitNs;
export const fontkit: FontkitModule =
  ((fontkitNs as unknown as { default?: FontkitModule }).default ?? fontkitNs) as FontkitModule;

type FkFont = ReturnType<FontkitModule['create']>;
/** fontkit's glyph path commands (present at runtime, absent from its typings). */
type PathCommand = { command: string; args: number[] };

export const PAGE_W = 792;
export const PAGE_H = 612;

/** Characters drawn as vectors rather than glyphs. */
const APPROX = '≈';
const TILDE = 0x7e;

export type TextStyle = {
  face: FaceKey;
  size: number;
  color: ColorName;
  /** CSS letter-spacing in points, added after every glyph. */
  ls?: number;
};

export type Run = { text: string; style: TextStyle };
export type Segment = { text: string; style: TextStyle; x: number; width: number };
export type Line = { segments: Segment[]; width: number };

type Face = {
  fk: FkFont;
  pdf: PDFFont | null;
  chars: Set<number>;
  /** Ascender / descender as positive fractions of the em (hhea = typo here). */
  asc: number;
  desc: number;
};

export type DrawStats = {
  checks: number;
  dashes: number;
  /** Characters no brand face could draw, replaced by "?". */
  replacedGlyphs: number;
};

export class Canvas {
  readonly doc: PDFDocument;
  readonly stats: DrawStats = { checks: 0, dashes: 0, replacedGlyphs: 0 };
  /** Every string drawn, per page, after glyph substitution. */
  readonly texts: string[][] = [];
  private faces = new Map<FaceKey, Face>();
  private fontBytes: Record<FaceKey, Uint8Array>;
  private current: PDFPage | null = null;

  constructor(doc: PDFDocument, fontBytes: Record<FaceKey, Uint8Array>) {
    this.doc = doc;
    this.fontBytes = fontBytes;
    doc.registerFontkit(fontkit);
  }

  get page(): PDFPage {
    if (!this.current) throw new Error('canvas: no page');
    return this.current;
  }

  addPage(): PDFPage {
    this.current = this.doc.addPage([PAGE_W, PAGE_H]);
    this.texts.push([]);
    return this.current;
  }

  // ------------------------------------------------------------ fonts

  private face(key: FaceKey): Face {
    let f = this.faces.get(key);
    if (!f) {
      const fk = fontkit.create(this.fontBytes[key]);
      f = {
        fk,
        pdf: null,
        chars: new Set(fk.characterSet),
        asc: fk.ascent / fk.unitsPerEm,
        desc: -fk.descent / fk.unitsPerEm,
      };
      this.faces.set(key, f);
    }
    return f;
  }

  /** Embedded on first draw only, so unused faces add nothing to the file. */
  private async pdfFont(key: FaceKey): Promise<PDFFont> {
    const f = this.face(key);
    if (!f.pdf) {
      f.pdf = await this.doc.embedFont(this.fontBytes[key], { subset: true, customName: EMBED_NAMES[key] });
    }
    return f.pdf;
  }

  /** Pre-embed the faces a render will use (embedding is async; drawing is not). */
  async prepare(keys: FaceKey[]): Promise<void> {
    for (const k of keys) await this.pdfFont(k);
  }

  private embedded(key: FaceKey): PDFFont {
    const f = this.face(key);
    if (!f.pdf) throw new Error(`canvas: face ${key} not prepared`);
    return f.pdf;
  }

  /** CSS `line-height: normal` for this face and size. */
  lineHeight(face: FaceKey, size: number): number {
    const f = this.face(face);
    return (f.asc + f.desc) * size;
  }

  ascent(face: FaceKey, size: number): number {
    return this.face(face).asc * size;
  }

  descent(face: FaceKey, size: number): number {
    return this.face(face).desc * size;
  }

  /** Baseline of a line box of height `lh` starting at `top`, as CSS places it. */
  baseline(top: number, lh: number, face: FaceKey, size: number): number {
    return top + (lh - this.lineHeight(face, size)) / 2 + this.ascent(face, size);
  }

  /** Glyph bounding box in points (font units scaled), y up from the baseline. */
  glyphBox(face: FaceKey, codePoint: number, size: number) {
    const f = this.face(face);
    const g = f.fk.glyphForCodePoint(codePoint);
    const k = size / f.fk.unitsPerEm;
    return {
      advance: g.advanceWidth * k,
      minX: g.bbox.minX * k,
      maxX: g.bbox.maxX * k,
      minY: g.bbox.minY * k,
      maxY: g.bbox.maxY * k,
    };
  }

  // ------------------------------------------------------------ text

  /** Replace characters the face cannot draw with "?" (and count them). */
  sanitize(text: string, face: FaceKey): string {
    const f = this.face(face);
    let out = '';
    for (const ch of text.normalize('NFC')) {
      const cp = ch.codePointAt(0)!;
      if (ch === APPROX || f.chars.has(cp)) out += ch;
      else if (/\s/.test(ch)) out += ' ';
      else {
        out += '?';
        this.stats.replacedGlyphs++;
      }
    }
    return out;
  }

  /**
   * Unit-size width and glyph count per (face, text). Widths scale linearly
   * with the font size, so one shaping pass serves every size the page-2
   * shrink loop tries; without this, long category text was re-shaped word by
   * word at every step (seconds for pathological input).
   */
  private readonly metricsCache = new Map<string, { unitWidth: number; glyphs: number }>();

  /** Measure already-sanitized text. */
  private measureClean(text: string, style: TextStyle): number {
    if (!text) return 0;
    const key = `${style.face}\u0000${text}`;
    let m = this.metricsCache.get(key);
    if (!m) {
      const font = this.embedded(style.face);
      let unitWidth = 0;
      let glyphs = 0;
      for (const part of text.split(APPROX).entries()) {
        const [i, piece] = part;
        if (i > 0) {
          unitWidth += this.glyphBox(style.face, TILDE, 1).advance;
          glyphs++;
        }
        if (piece) {
          unitWidth += font.widthOfTextAtSize(piece, 1);
          glyphs += this.face(style.face).fk.layout(piece).glyphs.length;
        }
      }
      m = { unitWidth, glyphs };
      this.metricsCache.set(key, m);
    }
    return m.unitWidth * style.size + (style.ls ?? 0) * m.glyphs;
  }

  /** Width of `text` in `style`, including letter-spacing after every glyph (as CSS). */
  measure(text: string, style: TextStyle): number {
    return this.measureClean(this.sanitizeSilently(text, style.face), style);
  }

  private sanitizeSilently(text: string, face: FaceKey): string {
    const before = this.stats.replacedGlyphs;
    const out = this.sanitize(text, face);
    this.stats.replacedGlyphs = before;
    return out;
  }

  /**
   * Draw one line of text with its baseline at `baseline` (top-down). Returns
   * the advance width. Records the drawn string for the page.
   */
  text(raw: string, x: number, baseline: number, style: TextStyle): number {
    const text = this.sanitize(raw, style.face);
    if (!text) return 0;
    const page = this.page;
    const font = this.embedded(style.face);
    const rgbColor = color(style.color);
    const ls = style.ls ?? 0;
    if (ls) page.pushOperators(setCharacterSpacing(ls));
    let cx = x;
    for (const [i, piece] of text.split(APPROX).entries()) {
      if (i > 0) cx += this.approx(cx, baseline, style) + ls;
      if (piece) {
        page.drawText(piece, { x: cx, y: PAGE_H - baseline, size: style.size, font, color: rgbColor });
        cx += this.measureClean(piece, style);
      }
    }
    if (ls) page.pushOperators(setCharacterSpacing(0));
    this.texts[this.texts.length - 1].push(text);
    return cx - x;
  }

  /** "≈" as two copies of the face's tilde outline, stacked. Returns its advance. */
  private approx(x: number, baseline: number, style: TextStyle): number {
    const f = this.face(style.face);
    const g = f.fk.glyphForCodePoint(TILDE);
    const k = style.size / f.fk.unitsPerEm;
    const shift = (g.bbox.maxY - g.bbox.minY) * 0.6;
    for (const dy of [shift, -shift]) {
      const d = (g.path as unknown as { commands: PathCommand[] }).commands
        .map((c) => {
          const pts: string[] = [];
          for (let i = 0; i < c.args.length; i += 2) {
            pts.push(`${(x + c.args[i] * k).toFixed(3)} ${(baseline - (c.args[i + 1] + dy) * k).toFixed(3)}`);
          }
          switch (c.command) {
            case 'moveTo':
              return `M${pts[0]}`;
            case 'lineTo':
              return `L${pts[0]}`;
            case 'quadraticCurveTo':
              return `Q${pts.join(' ')}`;
            case 'bezierCurveTo':
              return `C${pts.join(' ')}`;
            case 'closePath':
              return 'Z';
            default:
              return '';
          }
        })
        .join(' ');
      this.path(d, { fill: style.color });
    }
    return g.advanceWidth * k;
  }

  /** Draw a laid-out line at `x` (segments carry their own offsets). */
  line(line: Line, x: number, baseline: number): void {
    for (const s of line.segments) this.text(s.text, x + s.x, baseline, s.style);
  }

  /**
   * Greedy word wrap across styled runs, CSS-like: breaks at spaces and after
   * hyphens, drops spaces at line ends, and breaks a single word that is wider
   * than the line by characters (overflow-wrap: anywhere) so nothing ever
   * overflows its box.
   */
  wrap(runs: Run[], maxWidth: number): Line[] {
    type Piece = { text: string; style: TextStyle };
    type Word = { pieces: Piece[]; width: number; space: Piece | null };
    const words: Word[] = [];
    let cur: Word | null = null;
    let pendingSpace: Piece | null = null;
    for (const run of runs) {
      // Measured through a silent sanitize; glyph replacements are counted when drawn.
      const text = run.text.normalize('NFC').replace(/\s+/g, ' ');
      for (const tok of text.split(/( )/)) {
        if (!tok) continue;
        if (tok === ' ') {
          if (cur) words.push(cur);
          cur = null;
          pendingSpace = { text: ' ', style: run.style };
          continue;
        }
        // Break opportunities after hyphens, as browsers do.
        const parts = tok.split(/(?<=-)(?=.)/);
        parts.forEach((p, i) => {
          if (!cur) {
            cur = { pieces: [], width: 0, space: pendingSpace };
            pendingSpace = null;
          }
          cur.pieces.push({ text: p, style: run.style });
          cur.width += this.measure(p, run.style);
          if (i < parts.length - 1) {
            words.push(cur);
            cur = null;
          }
        });
      }
    }
    if (cur) words.push(cur);

    const lines: Piece[][] = [];
    let line: Piece[] = [];
    let width = 0;
    const flush = () => {
      if (line.length) lines.push(line);
      line = [];
      width = 0;
    };
    for (const w of words) {
      const spaceW = line.length && w.space ? this.measure(' ', w.space.style) : 0;
      if (line.length && width + spaceW + w.width > maxWidth) flush();
      if (!line.length && w.width > maxWidth) {
        // A single word wider than the line: break it by characters.
        for (const p of w.pieces) {
          for (const ch of p.text) {
            const chW = this.measure(ch, p.style);
            if (line.length && width + chW > maxWidth) flush();
            line.push({ text: ch, style: p.style });
            width += chW;
          }
        }
        continue;
      }
      if (line.length && w.space) {
        line.push(w.space);
        width += spaceW;
      }
      line.push(...w.pieces);
      width += w.width;
    }
    flush();

    // Merge neighbouring pieces of the same style (keeps kerning, fewer operators).
    return lines.map((pieces) => {
      const merged: Piece[] = [];
      for (const p of pieces) {
        const last = merged[merged.length - 1];
        if (last && sameStyle(last.style, p.style)) last.text += p.text;
        else merged.push({ ...p });
      }
      let x = 0;
      const segments = merged.map((p) => {
        const w = this.measure(p.text, p.style);
        const s = { text: p.text, style: p.style, x, width: w };
        x += w;
        return s;
      });
      return { segments, width: x };
    });
  }

  // ------------------------------------------------------------ shapes

  rect(x: number, y: number, w: number, h: number, fill: ColorName): void {
    this.page.drawRectangle({ x, y: PAGE_H - y - h, width: w, height: h, color: color(fill) });
  }

  /** An SVG path in top-down page coordinates. */
  path(d: string, opts: { fill?: ColorName; stroke?: ColorName; width?: number; round?: boolean }): void {
    if (opts.round) this.page.pushOperators(setLineJoin(LineJoinStyle.Round));
    this.page.drawSvgPath(d, {
      x: 0,
      y: PAGE_H,
      color: opts.fill ? color(opts.fill) : undefined,
      borderColor: opts.stroke ? color(opts.stroke) : undefined,
      borderWidth: opts.stroke ? (opts.width ?? 1) : 0,
      borderLineCap: opts.round ? LineCapStyle.Round : undefined,
    });
    if (opts.round) this.page.pushOperators(setLineJoin(LineJoinStyle.Miter));
  }

  /** Rounded rectangle with per-corner radii [topLeft, topRight, bottomRight, bottomLeft]. */
  roundRect(x: number, y: number, w: number, h: number, r: number | [number, number, number, number], fill: ColorName): void {
    this.path(roundRectPath(x, y, w, h, r), { fill });
  }

  /** A check mark: the Python renderer's SVG (12-unit box) at `size`, stroked. */
  check(x: number, top: number, size: number, stroke: ColorName): void {
    const k = size / 12;
    const p = (a: number, b: number) => `${(x + a * k).toFixed(3)} ${(top + b * k).toFixed(3)}`;
    this.path(`M${p(2, 6.5)} L${p(4.8, 9.3)} L${p(10, 3.5)}`, { stroke, width: 1.8 * k, round: true });
    this.stats.checks++;
  }
}

function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return a.face === b.face && a.size === b.size && a.color === b.color && (a.ls ?? 0) === (b.ls ?? 0);
}

export function roundRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number | [number, number, number, number],
): string {
  const [tl, tr, br, bl] = (typeof radius === 'number' ? [radius, radius, radius, radius] : radius).map((r) =>
    Math.max(0, Math.min(r, w / 2, h / 2)),
  );
  const f = (n: number) => n.toFixed(3);
  return [
    `M${f(x + tl)} ${f(y)}`,
    `H${f(x + w - tr)}`,
    tr ? `A${f(tr)} ${f(tr)} 0 0 1 ${f(x + w)} ${f(y + tr)}` : '',
    `V${f(y + h - br)}`,
    br ? `A${f(br)} ${f(br)} 0 0 1 ${f(x + w - br)} ${f(y + h)}` : '',
    `H${f(x + bl)}`,
    bl ? `A${f(bl)} ${f(bl)} 0 0 1 ${f(x)} ${f(y + h - bl)}` : '',
    `V${f(y + tl)}`,
    tl ? `A${f(tl)} ${f(tl)} 0 0 1 ${f(x + tl)} ${f(y)}` : '',
    'Z',
  ]
    .filter(Boolean)
    .join(' ');
}
