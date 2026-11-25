// Packages PDF renderer: the two-page landscape trademark proposal, drawn with
// pdf-lib alone: no browser engine, no subprocess.
//
// A port of lawmatics-mcp `src/consult-brief/pdf/render.ts` (itself a port of lectual-plugin `scripts/render_package_proposal.py`). Every size,
// gap and colour below is that script's CSS, converted to points (1px = 0.75pt,
// 1in = 72pt); comments name the CSS rule each block reproduces. Page 1 is the
// benefits table, page 2 the client's marks and the Fees at a Glance band.
//
// Input is a spec from ./spec.ts: every price in it already came from the firm
// package list. This module only draws; it holds no prices, no firm and no colours of its own
// (./palette.ts).
//
// The renderer measures before it draws and refuses to overlap: if the page-1
// table and note, or the page-2 cards, footnote and band, would run into the
// footer, it shrinks the category text a step at a time and finally throws
// `content_overflow` rather than ship a broken page.

import { PDFDocument } from 'pdf-lib';
import { Canvas, PAGE_H, PAGE_W, roundRectPath, type Line, type Run, type TextStyle } from './canvas';
import { loadFonts, type FaceKey } from './fonts';
import type { ColorName } from './palette';
import { PackagesSpecError, eyebrowText, type PackagesSpec, type SpecRow } from './spec';

const PX = 0.75; // CSS px → pt
const IN = 72;

// .top / .foot / .body
const TOP_H = 0.62 * IN;
const FOOT_H = 0.5 * IN;
const PAD_X = 0.55 * IN;
const BODY_TOP = TOP_H + 0.28 * IN;
const BODY_BOTTOM = PAGE_H - FOOT_H - 0.2 * IN;
const CONTENT_W = PAGE_W - 2 * PAD_X;

const DISCLAIMER = 'Confidential · Attorney advertising. Prepared for discussion purposes only.';
const PRODUCER = 'lectual consult-prep (pdf-lib)';
const FOOTNOTE =
  '*Please note that all classes we reviewed during our consultation will be included, however, we will highlight the ones you identified as your top priorities.';

/** Category text sizes tried on page 2, largest (the CSS's 9.6pt) first. */
const CATEGORY_SIZES = [9.6, 9, 8.4, 7.8, 7.2];

const USED_FACES: FaceKey[] = ['playfair600', 'serif400', 'serif600', 'serif700', 'serif400Italic', 'serif700Italic'];

type Box = { top: number; bottom: number };

export type CategoryLayout = Box & {
  priority: boolean;
  hasTag: boolean;
  /** Width available to the category text. */
  textMaxWidth: number;
  /** Laid-out width of each line of category text. */
  lineWidths: number[];
  /** Bottom of the text block. */
  textBottom: number;
};

export type CardLayout = Box & {
  x: number;
  width: number;
  innerWidth: number;
  categories: CategoryLayout[];
};

export type RenderLayout = {
  pageCount: number;
  checks: number;
  dashes: number;
  replacedGlyphs: number;
  /** Every string drawn, per page. */
  texts: string[][];
  page1: { table: Box; note: Box; footerTop: number; bodyBottom: number };
  page2: {
    heading: Box;
    cards: CardLayout[];
    footnote: Box;
    band: Box;
    footerTop: number;
    bodyBottom: number;
    categoryFontSize: number;
  };
};

export type RenderOptions = {
  /** Override the font directory (tests). */
  fontDir?: string;
};

// ------------------------------------------------------------------ chrome

function drawChrome(c: Canvas, spec: PackagesSpec, section: string, pageNo: number, total: number): void {
  c.rect(0, 0, PAGE_W, PAGE_H, 'cream');

  // .top: burgundy band, wordmark left, section label right.
  c.rect(0, 0, PAGE_W, TOP_H, 'burgundy');
  const { chrome } = spec;
  const maxMarkW = PAGE_W * 0.5;
  // A long firm name shrinks (to 9pt) and then is cut, so it can never run into the section label.
  let wmSize = 15;
  let wmText = chrome.wordmark;
  const wmStyle = (size: number): TextStyle => ({ face: 'playfair600', size, color: 'onBurgundy', ls: size * 0.06 });
  while (wmSize > 9 && c.measure(wmText, wmStyle(wmSize)) > maxMarkW) wmSize -= 1;
  while (wmText.length > 1 && c.measure(wmText, wmStyle(wmSize)) > maxMarkW) wmText = wmText.slice(0, -1).trimEnd();
  if (wmText !== chrome.wordmark) wmText += '…';
  const wm = wmStyle(wmSize);
  const wmW = c.measure(wmText, wm);
  if (chrome.established) {
    const est: TextStyle = { face: 'serif400', size: 5.5, color: 'onBurgundy', ls: 5.5 * 0.32 };
    const rule = 0.6 * PX;
    const estPad = 1.5 * PX;
    const estLh = c.lineHeight('serif400', 5.5);
    const blockH = wmSize + 4 * PX + 2 * rule + 2 * estPad + estLh; // .wm line-height 1 + small
    const top = (TOP_H - blockH) / 2;
    const estW = c.measure(chrome.established, est);
    const blockW = Math.max(wmW, estW);
    c.text(wmText, PAD_X + (blockW - wmW) / 2, c.baseline(top, wmSize, 'playfair600', wmSize), wm);
    const ruleTop = top + wmSize + 4 * PX;
    const estX = PAD_X + (blockW - estW) / 2;
    c.rect(estX, ruleTop, estW, rule, 'onBurgundyRule');
    c.text(chrome.established, estX, c.baseline(ruleTop + rule + estPad, estLh, 'serif400', 5.5), est);
    c.rect(estX, ruleTop + rule + 2 * estPad + estLh, estW, rule, 'onBurgundyRule');
  } else {
    // The plain version: the firm's name alone, centred in the band.
    c.text(wmText, PAD_X, c.baseline((TOP_H - wmSize) / 2, wmSize, 'playfair600', wmSize), wm);
  }

  const sec: TextStyle = { face: 'serif600', size: 7.5, color: 'sand', ls: 7.5 * 0.32 };
  const label = section.toUpperCase();
  const secLh = c.lineHeight('serif600', 7.5);
  c.text(label, PAGE_W - PAD_X - c.measure(label, sec), c.baseline((TOP_H - secLh) / 2, secLh, 'serif600', 7.5), sec);

  // .foot: burgundy bar, two centred lines.
  const footTop = PAGE_H - FOOT_H;
  c.rect(0, footTop, PAGE_W, FOOT_H, 'burgundy');
  const l1Top = footTop + 0.11 * IN;
  const l1Lh = c.lineHeight('serif400', 7.2);
  const l1 = c.wrap(
    [
      { text: chrome.footerBold, style: { face: 'serif700', size: 7.2, color: 'onBurgundy' } },
      ...(chrome.footerRest ? [{ text: chrome.footerRest, style: { face: 'serif400' as const, size: 7.2, color: 'onBurgundy' as const } }] : []),
    ],
    PAGE_W,
  )[0];
  c.line(l1, (PAGE_W - l1.width) / 2, c.baseline(l1Top, l1Lh, 'serif400', 7.2));
  const l2Style: TextStyle = { face: 'serif400Italic', size: 6, color: 'onBurgundySoft' };
  const l2Text = `Page ${pageNo} of ${total} · ${DISCLAIMER}`;
  const l2Top = l1Top + l1Lh + 2 * PX;
  c.text(l2Text, (PAGE_W - c.measure(l2Text, l2Style)) / 2, c.baseline(l2Top, c.lineHeight('serif400Italic', 6), 'serif400Italic', 6), l2Style);
}

/** .eyebrow with its trailing hairline; returns the bottom of the eyebrow box. */
function drawEyebrow(c: Canvas, text: string, top: number): number {
  const style: TextStyle = { face: 'serif700', size: 7.2, color: 'burgundy', ls: 7.2 * 0.3 };
  const lh = c.lineHeight('serif700', 7.2);
  const lines = c.wrap([{ text: text.toUpperCase(), style }], CONTENT_W - 40);
  lines.forEach((l, i) => c.line(l, PAD_X, c.baseline(top + i * lh, lh, 'serif700', 7.2)));
  const last = lines[lines.length - 1];
  const ruleX = PAD_X + (last?.width ?? 0) + 10 * PX;
  const h = lines.length * lh;
  if (ruleX < PAD_X + CONTENT_W) c.rect(ruleX, top + h / 2 - (0.7 * PX) / 2, PAD_X + CONTENT_W - ruleX, 0.7 * PX, 'line');
  return top + h;
}

/** h1: Playfair 24pt, line-height 1.08. Returns the bottom of the heading box. */
function drawHeading(c: Canvas, text: string, top: number): number {
  const style: TextStyle = { face: 'playfair600', size: 24, color: 'burgundy' };
  const lh = 24 * 1.08;
  const lines = c.wrap([{ text, style }], CONTENT_W);
  lines.forEach((l, i) => c.line(l, PAD_X, c.baseline(top + i * lh, lh, 'playfair600', 24)));
  return top + lines.length * lh;
}

// ------------------------------------------------------------------ page 1

type CellPlan =
  | { kind: 'check' }
  | { kind: 'dash' }
  | { kind: 'text'; lines: Line[]; lh: number; face: FaceKey; size: number };

type RowPlan = {
  row: SpecRow;
  height: number;
  padV: number;
  border: boolean;
  label: { lines: Line[]; lh: number; face: FaceKey; size: number; note: Line[] };
  cells: CellPlan[];
};

const LABEL_W = CONTENT_W * 0.37;
const GUTTER = 6 * PX; // td.v border-left: 6px solid cream
const CELL_PAD_X = 10 * PX;
const ROW_RULE = 0.6 * PX;
const CHECK_SIZE = 9;
const NOTE_LH = 6.6 * 1.15;

/** The value columns: one per package, sharing what the label column leaves. */
type Columns = { count: number; colW: number; fillW: number };
function columnsFor(count: number): Columns {
  const colW = (CONTENT_W - LABEL_W) / count;
  return { count, colW, fillW: colW - GUTTER };
}
function colFillX(cols: Columns, i: number): number {
  return PAD_X + LABEL_W + i * cols.colW + GUTTER;
}

function planRow(c: Canvas, row: SpecRow, cols: Columns): RowPlan {
  const pay = row.cls === 'pay';
  const tev = row.cls === 'tev';
  const labelStyle: TextStyle = pay
    ? { face: 'playfair600', size: 11, color: 'burgundy' }
    : tev
      ? { face: 'serif400Italic', size: 8.1, color: 'taupe' }
      : { face: 'serif400', size: 8.1, color: 'plum' };
  const runs: Run[] = [{ text: row.label, style: labelStyle }];
  if (row.value) {
    runs.push({ text: ' ', style: labelStyle });
    runs.push({ text: `(${row.value})`, style: { face: tev ? 'serif400Italic' : 'serif400', size: 7.2, color: 'taupe' } });
  }
  const labelInner = LABEL_W - 2 * PX - CELL_PAD_X;
  const labelLines = c.wrap(runs, labelInner);
  const labelLh = c.lineHeight(labelStyle.face, labelStyle.size);
  const note = row.note
    ? c.wrap([{ text: row.note, style: { face: 'serif400Italic', size: 6.6, color: 'taupe' } }], labelInner)
    : [];
  let content = labelLines.length * labelLh + note.length * NOTE_LH;

  const valueStyle: TextStyle = pay
    ? { face: 'playfair600', size: 12, color: 'burgundy' }
    : row.cls === 'disc'
      ? { face: 'serif600', size: 8.1, color: 'burgundy' }
      : tev
        ? { face: 'serif400Italic', size: 8.1, color: 'taupe' }
        : { face: 'serif400', size: 8.1, color: 'plum' };
  const valueLh = c.lineHeight(valueStyle.face, valueStyle.size);
  const cells: CellPlan[] = row.cells.map((cell) => {
    if (cell.kind === 'check') {
      // span.ck is 9pt: its line box is the taller of the td's strut and the 9pt one.
      content = Math.max(content, c.lineHeight('serif400', CHECK_SIZE));
      return { kind: 'check' };
    }
    if (cell.kind === 'dash') {
      content = Math.max(content, valueLh);
      return { kind: 'dash' };
    }
    const lines = c.wrap([{ text: cell.text, style: valueStyle }], cols.fillW - 2 * CELL_PAD_X);
    content = Math.max(content, lines.length * valueLh);
    return { kind: 'text', lines, lh: valueLh, face: valueStyle.face, size: valueStyle.size };
  });

  const padV = pay ? 4 * PX : 2.6 * PX;
  const border = row.cls !== 'pay' && row.cls !== 'addl';
  return {
    row,
    height: content + 2 * padV + (border ? ROW_RULE : 0),
    padV,
    border,
    label: { lines: labelLines, lh: labelLh, face: labelStyle.face, size: labelStyle.size, note },
    cells,
  };
}

function drawTierHeader(c: Canvas, spec: PackagesSpec, cols: Columns, top: number): number {
  const tStyle: TextStyle = { face: 'serif700', size: 6.6, color: 'onBurgundyRule', ls: 6.6 * 0.28 };
  const pStyle: TextStyle = { face: 'playfair600', size: 16, color: 'cream' };
  const gStyle: TextStyle = { face: 'serif700Italic', size: 6.6, color: 'onBurgundySoft' };
  const tLh = c.lineHeight('serif700', 6.6);
  const pLh = 16 * 1.05;
  const gLh = c.lineHeight('serif700Italic', 6.6);
  const padV = 6 * PX;
  const bandH = padV + tLh + 1 * PX + pLh + gLh + padV;

  spec.tiers.forEach((tier, i) => {
    const x = colFillX(cols, i);
    const fill: ColorName = i === cols.count - 1 && cols.count > 1 ? 'deep' : 'burgundy';
    c.roundRect(x, top, cols.fillW, bandH, [6 * PX, 6 * PX, 0, 0], fill);
    const center = x + cols.fillW / 2;
    let y = top + padV;
    c.text(tier.name, center - c.measure(tier.name, tStyle) / 2, c.baseline(y, tLh, 'serif700', 6.6), tStyle);
    y += tLh + 1 * PX;
    c.text(tier.price, center - c.measure(tier.price, pStyle) / 2, c.baseline(y, pLh, 'playfair600', 16), pStyle);
    y += pLh;
    const g = '+ Government Filing Fees';
    c.text(g, center - c.measure(g, gStyle) / 2, c.baseline(y, gLh, 'serif700Italic', 6.6), gStyle);
  });

  // th.lbl "Benefits": bottom-aligned with 5px padding.
  const lbl: TextStyle = { face: 'serif700', size: 7, color: 'burgundy', ls: 7 * 0.28 };
  c.text('BENEFITS', PAD_X + 2 * PX, top + bandH - 5 * PX - c.descent('serif700', 7), lbl);
  return top + bandH;
}

function drawRow(c: Canvas, plan: RowPlan, cols: Columns, top: number, index: number): void {
  const { row, height, padV, border } = plan;
  const contentTop = top + padV;
  const contentH = height - 2 * padV - (border ? ROW_RULE : 0);

  // Value cell fills (.pk td.v, even rows lighter, YOU PAY in sand).
  const fill: ColorName = row.cls === 'pay' ? 'sand' : index % 2 === 1 ? 'rowAlt' : 'card';
  for (let i = 0; i < plan.cells.length; i++) c.rect(colFillX(cols, i), top, cols.fillW, height, fill);
  if (border) {
    const y = top + height - ROW_RULE;
    c.rect(PAD_X, y, LABEL_W, ROW_RULE, 'line');
    for (let i = 0; i < plan.cells.length; i++) c.rect(colFillX(cols, i), y, cols.fillW, ROW_RULE, 'line');
  }

  // Label cell, vertically centred.
  const { label } = plan;
  const labelH = label.lines.length * label.lh + label.note.length * NOTE_LH;
  let y = contentTop + (contentH - labelH) / 2;
  for (const l of label.lines) {
    c.line(l, PAD_X + 2 * PX, c.baseline(y, label.lh, label.face, label.size));
    y += label.lh;
  }
  for (const l of label.note) {
    c.line(l, PAD_X + 2 * PX, c.baseline(y, NOTE_LH, 'serif400Italic', 6.6));
    y += NOTE_LH;
  }

  plan.cells.forEach((cell, i) => {
    const x = colFillX(cols, i);
    const center = x + cols.fillW / 2;
    if (cell.kind === 'check') {
      const lh = c.lineHeight('serif400', CHECK_SIZE);
      const base = c.baseline(contentTop + (contentH - lh) / 2, lh, 'serif400', CHECK_SIZE);
      c.check(center - CHECK_SIZE / 2, base - CHECK_SIZE, CHECK_SIZE, 'burgundy');
      return;
    }
    if (cell.kind === 'dash') {
      // "—" in the dash tint, drawn as the em dash's own bar so no glyph is needed.
      const size = 8.1;
      const lh = c.lineHeight('serif400', size);
      const base = c.baseline(contentTop + (contentH - lh) / 2, lh, 'serif400', size);
      const g = c.glyphBox('serif400', 0x2014, size);
      const left = center - g.advance / 2;
      c.rect(left + g.minX, base - g.maxY, g.maxX - g.minX, g.maxY - g.minY, 'dash');
      c.stats.dashes++;
      return;
    }
    let ty = contentTop + (contentH - cell.lines.length * cell.lh) / 2;
    for (const l of cell.lines) {
      c.line(l, center - l.width / 2, c.baseline(ty, cell.lh, cell.face, cell.size));
      ty += cell.lh;
    }
  });
}

function drawPage1(c: Canvas, spec: PackagesSpec): RenderLayout['page1'] {
  c.addPage();
  drawChrome(c, spec, 'Trademark Proposal', 1, 2);
  const eyebrowBottom = drawEyebrow(c, eyebrowText(spec), BODY_TOP);
  const h1Bottom = drawHeading(c, 'Trademark Packages', eyebrowBottom + 5 * PX);
  const tableTop = h1Bottom + 10 * PX;

  const cols = columnsFor(spec.tiers.length);
  const plans = spec.rows.map((r) => planRow(c, r, cols));
  const headerBottom = drawTierHeader(c, spec, cols, tableTop);
  let y = headerBottom;
  plans.forEach((p, i) => {
    drawRow(c, p, cols, y, i);
    y += p.height;
  });
  const tableBottom = y;

  // .note: italic taupe with bold burgundy runs.
  const it: TextStyle = { face: 'serif400Italic', size: 7.3, color: 'taupe' };
  const b: TextStyle = { face: 'serif700', size: 7.3, color: 'burgundy' };
  const noteTop = tableBottom + 8 * PX;
  const lh = 7.3 * 1.35;
  const lines = c.wrap(
    [
      { text: '*Government Filing Fees are ', style: it },
      { text: spec.fees.governmentPerClass, style: b },
      {
        text: ' and are required by the USPTO. These fees are separate from legal fees and must be paid before the application is submitted. ',
        style: it,
      },
      { text: spec.expirySentence, style: b },
    ],
    CONTENT_W,
  );
  lines.forEach((l, i) => c.line(l, PAD_X, c.baseline(noteTop + i * lh, lh, 'serif400Italic', 7.3)));
  const noteBottom = noteTop + lines.length * lh;
  if (noteBottom > BODY_BOTTOM) throw new PackagesSpecError('content_overflow', 'page1');

  return {
    table: { top: tableTop, bottom: tableBottom },
    note: { top: noteTop, bottom: noteBottom },
    footerTop: PAGE_H - FOOT_H,
    bodyBottom: BODY_BOTTOM,
  };
}

// ------------------------------------------------------------------ page 2

const CARD_GAP = 16 * PX;
const CARD_MIN_H = 3.1 * IN;
const CARD_BORDER = 0.7 * PX;
const CARD_TOP_BORDER = 3 * PX;
const CARD_PAD = { top: 13 * PX, x: 15 * PX, bottom: 12 * PX };
const CARD_R = 7 * PX;
const CAT = { padV: 8 * PX, padX: 10 * PX, gap: 10 * PX, r: 5 * PX, mb: 6 * PX, border: 0.6 * PX, priBorder: 3 * PX, nMin: 14 * PX };
const TAG = { size: 6.2, padV: 2 * PX, padX: 7 * PX };

type CategoryPlan = {
  text: Line[];
  n: string;
  priority: boolean;
  height: number;
  contentH: number;
  textMaxWidth: number;
  tagW: number;
};

type CardPlan = {
  x: number;
  width: number;
  innerX: number;
  innerW: number;
  name: Line[];
  kicker2: Line[];
  categories: CategoryPlan[];
  contentH: number;
};

const KICKER: TextStyle = { face: 'serif700', size: 6.8, color: 'taupe', ls: 6.8 * 0.28 };
const TAG_STYLE: TextStyle = { face: 'serif700', size: TAG.size, color: 'cream', ls: TAG.size * 0.22 };

function planCards(c: Canvas, spec: PackagesSpec, catSize: number): CardPlan[] {
  const n = spec.marks.length;
  const width = (CONTENT_W - CARD_GAP * (n - 1)) / n;
  const kLh = c.lineHeight('serif700', 6.8);
  const nameLh = c.lineHeight('playfair600', 15);
  const catLh = catSize * 1.3;
  const tagH = c.lineHeight('serif700', TAG.size) + 2 * TAG.padV;
  const tagW = c.measure('TOP PRIORITY', TAG_STYLE) + 2 * TAG.padX;

  return spec.marks.map((mark, i) => {
    const x = PAD_X + i * (width + CARD_GAP);
    const innerX = x + CARD_BORDER + CARD_PAD.x;
    const innerW = width - 2 * CARD_BORDER - 2 * CARD_PAD.x;
    const name = c.wrap([{ text: mark.display, style: { face: 'playfair600', size: 15, color: 'burgundy' } }], innerW);
    const kicker2 = c.wrap([{ text: 'CLASSES · DESCRIPTION OF PRODUCTS / SERVICES', style: KICKER }], innerW);
    const categories = mark.categories.map((cat, j): CategoryPlan => {
      const left = cat.priority ? CAT.priBorder : CAT.border;
      const contentW = innerW - left - CAT.border - 2 * CAT.padX;
      const num = `${j + 1}.`;
      const nW = Math.max(CAT.nMin, c.measure(num, { face: 'playfair600', size: catSize, color: 'burgundy' }));
      const textMaxWidth = contentW - nW - CAT.gap - (cat.priority ? CAT.gap + tagW : 0);
      const text = c.wrap([{ text: cat.text, style: { face: 'serif400', size: catSize, color: 'plum' } }], Math.max(textMaxWidth, 1));
      const contentH = Math.max(text.length * catLh, catLh, cat.priority ? tagH : 0);
      return {
        text,
        n: num,
        priority: cat.priority,
        contentH,
        height: contentH + 2 * CAT.padV + 2 * CAT.border,
        textMaxWidth,
        tagW,
      };
    });
    const contentH =
      CARD_TOP_BORDER +
      CARD_PAD.top +
      kLh +
      9 * PX +
      name.length * nameLh +
      8 * PX + // h2 margin-bottom 2px collapses into the kicker's 8px margin-top
      kicker2.length * kLh +
      9 * PX +
      categories.reduce((s, cat) => s + cat.height + CAT.mb, 0) +
      CARD_PAD.bottom +
      CARD_BORDER;
    return { x, width, innerX, innerW, name, kicker2, categories, contentH };
  });
}

/** Card / category box: border colour all round, a thicker accent on one side, fill inside. */
function borderedBox(
  c: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  border: number,
  accent: { side: 'top' | 'left'; width: number; color: ColorName },
  colors: { border: ColorName; fill: ColorName },
): void {
  c.roundRect(x, y, w, h, r, colors.border);
  const t = accent.side === 'top' ? accent.width : border;
  const l = accent.side === 'left' ? accent.width : border;
  c.roundRect(x + l, y + t, w - l - border, h - t - border, Math.max(0, r - border), colors.fill);
  const f = (n: number) => n.toFixed(3);
  const ri = Math.max(0, r - border);
  const ra = Math.max(0, r - accent.width);
  if (accent.side === 'top') {
    // The top border, following the outer and inner corner curves.
    c.path(
      `M${f(x)} ${f(y + r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + r)} ${f(y)} H${f(x + w - r)} A${f(r)} ${f(r)} 0 0 1 ${f(x + w)} ${f(y + r)} ` +
        `L${f(x + w - border)} ${f(y + r)} A${f(ri)} ${f(ra)} 0 0 0 ${f(x + w - r)} ${f(y + accent.width)} H${f(x + r)} ` +
        `A${f(ri)} ${f(ra)} 0 0 0 ${f(x + border)} ${f(y + r)} Z`,
      { fill: accent.color },
    );
  } else {
    c.path(
      `M${f(x + r)} ${f(y)} A${f(r)} ${f(r)} 0 0 0 ${f(x)} ${f(y + r)} V${f(y + h - r)} A${f(r)} ${f(r)} 0 0 0 ${f(x + r)} ${f(y + h)} ` +
        `L${f(x + r)} ${f(y + h - border)} A${f(ra)} ${f(ri)} 0 0 1 ${f(x + accent.width)} ${f(y + h - r)} V${f(y + r)} ` +
        `A${f(ra)} ${f(ri)} 0 0 1 ${f(x + r)} ${f(y + border)} Z`,
      { fill: accent.color },
    );
  }
}

function drawPage2(c: Canvas, spec: PackagesSpec): RenderLayout['page2'] {
  // Measure first: pick the largest category size whose page fits above the footer.
  let chosen: { size: number; cards: CardPlan[]; cardH: number } | null = null;
  const fnStyle: TextStyle = { face: 'serif400Italic', size: 8.6, color: 'plum' };
  const fnLines = c.wrap([{ text: FOOTNOTE, style: fnStyle }], CONTENT_W);
  const fnLh = c.lineHeight('serif400Italic', 8.6);

  const bandTitle: TextStyle = { face: 'playfair600', size: 14, color: 'cream' };
  const bandTitleW = c.measure('Fees at a Glance', bandTitle);
  const bandPad = { v: 12 * PX, x: 18 * PX, gap: 22 * PX };
  const bt: TextStyle = { face: 'serif400', size: 9, color: 'onBurgundy' };
  const bb: TextStyle = { face: 'serif700', size: 9, color: 'cream' };
  const bandTextW = CONTENT_W - 2 * bandPad.x - bandTitleW - bandPad.gap;
  const bandLines = c.wrap(
    [
      { text: 'Each additional class is ', style: bt },
      { text: spec.fees.additionalClass, style: bb },
      { text: '. Government Filing Fees are ', style: bt },
      { text: spec.fees.governmentPerClass, style: bb },
      {
        text: ` and are required by the USPTO — separate from legal fees and paid before the application is submitted. ${spec.expirySentence}`,
        style: bt,
      },
    ],
    bandTextW,
  );
  const bandLh = 9 * 1.45;
  const bandTitleLh = c.lineHeight('playfair600', 14);
  const bandH = Math.max(bandTitleLh, bandLines.length * bandLh) + 2 * bandPad.v;

  // Heading height is known before drawing (wrap only measures).
  const eyebrowH = c.lineHeight('serif700', 7.2);
  const headingLines = c.wrap([{ text: spec.title, style: { face: 'playfair600', size: 24, color: 'burgundy' } }], CONTENT_W);
  const headingTop = BODY_TOP + eyebrowH + 5 * PX;
  const headingBottom = headingTop + headingLines.length * 24 * 1.08;
  const gridTop = headingBottom + 10 * PX; // h1's 10px margin collapses with the grid's 6px

  for (const size of CATEGORY_SIZES) {
    const cards = planCards(c, spec, size);
    const cardH = Math.max(CARD_MIN_H, ...cards.map((k) => k.contentH));
    const bottom = gridTop + cardH + 14 * PX + fnLines.length * fnLh + 22 * PX + bandH;
    if (bottom <= BODY_BOTTOM) {
      chosen = { size, cards, cardH };
      break;
    }
  }
  if (!chosen) throw new PackagesSpecError('content_overflow', 'marks');

  c.addPage();
  drawChrome(c, spec, 'Your Marks', 2, 2);
  drawEyebrow(c, 'Your trademark proposal', BODY_TOP);
  drawHeading(c, spec.title, headingTop);

  const { size: catSize, cards, cardH } = chosen;
  const catLh = catSize * 1.3;
  const kLh = c.lineHeight('serif700', 6.8);
  const nameLh = c.lineHeight('playfair600', 15);
  const tagLh = c.lineHeight('serif700', TAG.size);
  const cardLayouts: CardLayout[] = [];

  for (const card of cards) {
    borderedBox(
      c,
      card.x,
      gridTop,
      card.width,
      cardH,
      CARD_R,
      CARD_BORDER,
      { side: 'top', width: CARD_TOP_BORDER, color: 'burgundy' },
      { border: 'line', fill: 'card' },
    );
    let y = gridTop + CARD_TOP_BORDER + CARD_PAD.top;
    c.text('WORD MARK', card.innerX, c.baseline(y, kLh, 'serif700', 6.8), KICKER);
    y += kLh + 9 * PX;
    for (const l of card.name) {
      c.line(l, card.innerX, c.baseline(y, nameLh, 'playfair600', 15));
      y += nameLh;
    }
    y += 8 * PX;
    for (const l of card.kicker2) {
      c.line(l, card.innerX, c.baseline(y, kLh, 'serif700', 6.8));
      y += kLh;
    }
    y += 9 * PX;

    const catLayouts: CategoryLayout[] = [];
    for (const cat of card.categories) {
      const top = y;
      const left = cat.priority ? CAT.priBorder : CAT.border;
      if (cat.priority) {
        borderedBox(
          c,
          card.innerX,
          top,
          card.innerW,
          cat.height,
          CAT.r,
          CAT.border,
          { side: 'left', width: CAT.priBorder, color: 'burgundy' },
          { border: 'priorityBorder', fill: 'gold' },
        );
      } else {
        c.roundRect(card.innerX, top, card.innerW, cat.height, CAT.r, 'line');
        c.roundRect(
          card.innerX + CAT.border,
          top + CAT.border,
          card.innerW - 2 * CAT.border,
          cat.height - 2 * CAT.border,
          CAT.r - CAT.border,
          'categoryFill',
        );
      }
      const cx = card.innerX + left + CAT.padX;
      const cTop = top + CAT.border + CAT.padV;
      c.text(cat.n, cx, c.baseline(cTop, catLh, 'playfair600', catSize), { face: 'playfair600', size: catSize, color: 'burgundy' });
      const nW = Math.max(CAT.nMin, c.measure(cat.n, { face: 'playfair600', size: catSize, color: 'burgundy' }));
      const tx = cx + nW + CAT.gap;
      cat.text.forEach((l, k) => c.line(l, tx, c.baseline(cTop + k * catLh, catLh, 'serif400', catSize)));
      if (cat.priority) {
        // .tag: pill pushed right (margin-left: auto), centred vertically.
        const right = card.innerX + card.innerW - CAT.border - CAT.padX;
        const tagH = tagLh + 2 * TAG.padV;
        const tagTop = cTop + (cat.contentH - tagH) / 2;
        c.roundRect(right - cat.tagW, tagTop, cat.tagW, tagH, tagH / 2, 'burgundy');
        c.text('TOP PRIORITY', right - cat.tagW + TAG.padX, c.baseline(tagTop + TAG.padV, tagLh, 'serif700', TAG.size), TAG_STYLE);
      }
      catLayouts.push({
        top,
        bottom: top + cat.height,
        priority: cat.priority,
        hasTag: cat.priority,
        textMaxWidth: cat.textMaxWidth,
        lineWidths: cat.text.map((l) => l.width),
        textBottom: cTop + cat.text.length * catLh,
      });
      y += cat.height + CAT.mb;
    }
    cardLayouts.push({
      x: card.x,
      width: card.width,
      innerWidth: card.innerW,
      top: gridTop,
      bottom: gridTop + cardH,
      categories: catLayouts,
    });
  }

  const fnTop = gridTop + cardH + 14 * PX;
  fnLines.forEach((l, i) => c.line(l, PAD_X, c.baseline(fnTop + i * fnLh, fnLh, 'serif400Italic', 8.6)));
  const fnBottom = fnTop + fnLines.length * fnLh;

  const bandTop = fnBottom + 22 * PX;
  c.roundRect(PAD_X, bandTop, CONTENT_W, bandH, 7 * PX, 'burgundy');
  c.text('Fees at a Glance', PAD_X + bandPad.x, c.baseline(bandTop + (bandH - bandTitleLh) / 2, bandTitleLh, 'playfair600', 14), bandTitle);
  const textX = PAD_X + bandPad.x + bandTitleW + bandPad.gap;
  const textTop = bandTop + (bandH - bandLines.length * bandLh) / 2;
  bandLines.forEach((l, i) => c.line(l, textX, c.baseline(textTop + i * bandLh, bandLh, 'serif400', 9)));

  return {
    heading: { top: headingTop, bottom: headingBottom },
    cards: cardLayouts,
    footnote: { top: fnTop, bottom: fnBottom },
    band: { top: bandTop, bottom: bandTop + bandH },
    footerTop: PAGE_H - FOOT_H,
    bodyBottom: BODY_BOTTOM,
    categoryFontSize: catSize,
  };
}

// ------------------------------------------------------------------ entry points

/** Render and also return the layout the tests (and a curious caller) can check. */
export async function renderPackagesPdfWithLayout(
  spec: PackagesSpec,
  opts: RenderOptions = {},
): Promise<{ bytes: Uint8Array; layout: RenderLayout }> {
  const fonts = await loadFonts(opts.fontDir);
  const doc = await PDFDocument.create({ updateMetadata: false });
  const c = new Canvas(doc, fonts);
  await c.prepare(USED_FACES);

  const page1 = drawPage1(c, spec);
  const page2 = drawPage2(c, spec);

  doc.setTitle(spec.title, { showInWindowTitleBar: true });
  doc.setAuthor(spec.chrome.author);
  doc.setSubject('Trademark packages (internal, for the consult)');
  doc.setProducer(PRODUCER);
  doc.setCreator(PRODUCER);
  // Fixed to the consult, so the same spec always renders the same bytes.
  doc.setCreationDate(spec.consultStart);
  doc.setModificationDate(spec.consultStart);

  const bytes = await doc.save();
  return {
    bytes,
    layout: {
      pageCount: doc.getPageCount(),
      checks: c.stats.checks,
      dashes: c.stats.dashes,
      replacedGlyphs: c.stats.replacedGlyphs,
      texts: c.texts,
      page1,
      page2,
    },
  };
}

/** The packages PDF as bytes. Throws PackagesSpecError (`content_overflow`) rather than overlap. */
export async function renderPackagesPdf(spec: PackagesSpec, opts: RenderOptions = {}): Promise<Uint8Array> {
  return (await renderPackagesPdfWithLayout(spec, opts)).bytes;
}

export { PRODUCER as PACKAGES_PDF_PRODUCER, roundRectPath };
