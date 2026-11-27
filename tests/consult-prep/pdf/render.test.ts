import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RPB_PACKAGES_ART } from '@/lib/consult-prep/pdf/art';
import { PALETTE } from '@/lib/consult-prep/pdf/palette';
import { renderPackagesPdf, renderPackagesPdfWithLayout, type RenderLayout } from '@/lib/consult-prep/pdf/render';
import { PackagesSpecError, buildPackagesSpec as buildSpec, type PackagesFirm, type PackagesSpecInput } from '@/lib/consult-prep/pdf/spec';
import { HARBOR_FIRM, HARBOR_PACKAGES, LEGACYCON_INPUT, RPB_FIRM, STRESS_INPUTS } from './fixtures';
import { inspectPdf } from './pdf-inspect';

const buildPackagesSpec = (input: PackagesSpecInput, firm: PackagesFirm = RPB_FIRM) => buildSpec(input, firm);
const PACKAGE_TEMPLATE = RPB_PACKAGES_ART.template;
const HERE = path.join(process.cwd(), 'src/lib/consult-prep/pdf');
const ROOT = process.cwd();

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('network is not allowed in packages PDF tests');
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let fixture: { bytes: Uint8Array; layout: RenderLayout };
let inspected: Awaited<ReturnType<typeof inspectPdf>>;

beforeAll(async () => {
  fixture = await renderPackagesPdfWithLayout(buildPackagesSpec(LEGACYCON_INPUT));
  inspected = await inspectPdf(fixture.bytes);
});

function boxesDisjoint(a: { top: number; bottom: number }, b: { top: number; bottom: number }): boolean {
  return a.bottom <= b.top || b.bottom <= a.top;
}

describe('renderPackagesPdf: the LegacyCon fixture', () => {
  it('returns %PDF- bytes that reload as exactly 2 pages of 792 x 612 pt', () => {
    expect(Buffer.from(fixture.bytes.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(inspected.pages).toHaveLength(2);
    for (const s of inspected.sizes) expect(s).toEqual({ width: 792, height: 612 });
  });

  it('is under 300 KB (hard budget) and under 1 MB', () => {
    expect(fixture.bytes.length).toBeLessThan(307_200);
    expect(fixture.bytes.length).toBeLessThan(1_048_576);
  });

  it('embeds subset Playfair Display and Source Serif 4 only, never a standard Helvetica/Times/Courier', () => {
    for (const fonts of inspected.fonts) {
      expect(fonts.length).toBeGreaterThan(0);
      for (const f of fonts) {
        expect(f.baseFont).not.toMatch(/Helvetica|Times|Courier|Symbol|ZapfDingbats/);
        expect(f.baseFont).toMatch(/^[A-Z]{6}\+(PlayfairDisplay|SourceSerif4)-/);
        expect(f.subtype).toBe('Type0');
        expect(f.embedded, f.baseFont).toBe(true);
      }
    }
    const names = inspected.fonts.flat().map((f) => f.baseFont);
    expect(names.some((n) => n.includes('PlayfairDisplay'))).toBe(true);
    expect(names.some((n) => n.includes('SourceSerif4'))).toBe(true);
  });

  it('draws body/table text in Source Serif 4 and headings/prices in Playfair Display', () => {
    // Map each drawn string to the font resource it was shown with.
    const fontOf = (pageIdx: number, needle: string): string => {
      const run = inspected.runs[pageIdx].find((r) => r.text.includes(needle));
      if (!run) throw new Error(`not found: ${needle}`);
      return run.baseFont;
    };
    expect(fontOf(0, 'Trademark Packages')).toContain('PlayfairDisplay');
    expect(fontOf(0, '$1,950')).toContain('PlayfairDisplay');
    expect(fontOf(0, 'YOU PAY')).toContain('PlayfairDisplay');
    expect(fontOf(0, 'Preliminary Consultation Strategy Call')).toContain('SourceSerif4');
    expect(fontOf(0, 'Unlimited')).toContain('SourceSerif4');
    expect(fontOf(1, 'Fees at a Glance')).toContain('PlayfairDisplay');
    expect(fontOf(1, 'Business networking events')).toContain('SourceSerif4');
  });

  it('page 1 text: heading, eyebrow, tiers with config prices, rows and the expiry sentence', () => {
    const t = inspected.texts[0];
    for (const s of [
      'Trademark Packages',
      'PREPARED FOR MS. KENASHA PAUL · BLACK PROFESSIONALS NETWORK · OCTOBER 2026',
      'ESSENTIAL™',
      '$1,950',
      'ENHANCED™',
      '$3,250',
      'CONCIERGE™',
      '$4,950',
      '+ Government Filing Fees',
      'YOU PAY',
      'Additional Class Fee',
      '$825 per class',
      '*Government Filing Fees are $350 per class and are required by the USPTO.',
      'This Trademark Proposal shall expire on October 28, 2026, 7 days from the date of receipt.',
      'RPB LAW FIRM',
      'EST 2024',
      'TRADEMARK PROPOSAL',
      'RPB Law Firm, PLLC · Miami & New York · www.rpblawfirm.com',
      'Page 1 of 2 · Confidential · Attorney advertising. Prepared for discussion purposes only.',
    ]) {
      expect(t).toContain(s);
    }
    expect(t.match(/\+ Government Filing Fees/g)).toHaveLength(3);
  });

  it('page 2 text: client heading, mark, TOP PRIORITY on the priority category only, footnote and Fees at a Glance', () => {
    const t = inspected.texts[1];
    for (const s of [
      'YOUR TRADEMARK PROPOSAL',
      'Ms. Kenasha Paul – RPB Law Trademark Proposal',
      'WORD MARK',
      'LEGACYCON',
      '1. Conferences, summits and professional-development events TOP PRIORITY',
      '2. Business networking events',
      '*Please note that all classes we reviewed during our consultation will be included',
      'Fees at a Glance',
      'Each additional class is $825. Government Filing Fees are $350 per class',
      'This Trademark Proposal shall expire on October 28, 2026, 7 days from the date of receipt.',
      'Page 2 of 2 · Confidential · Attorney advertising. Prepared for discussion purposes only.',
      'YOUR MARKS',
    ]) {
      expect(t).toContain(s);
    }
    expect(t.match(/TOP PRIORITY/g)).toHaveLength(1);
  });

  it('no class number anywhere on the client PDF: "Class <n>" / "IC <n>" never appears', () => {
    // Page 1 says "1 Class" / "2 Classes" (number BEFORE the word) and its extracted row label runs into the first cell
    // ("Classes Included1 Class"), so the category check targets page 2, where the model's category text lives.
    expect(inspected.texts[1]).not.toMatch(/\b(class(es)?|IC)\s*0*\d{1,2}\b/i);
  });

  it('draws check marks as vector paths: no check glyph, one path per template ✔ cell', () => {
    const templateChecks = PACKAGE_TEMPLATE.packages.rows.flatMap((r) => r.cells).filter((c) => c === '✔').length;
    const templateDashes = PACKAGE_TEMPLATE.packages.rows.flatMap((r) => r.cells).filter((c) => c === '—').length;
    expect(templateChecks).toBeGreaterThan(20);
    expect(fixture.layout.checks).toBe(templateChecks);
    expect(fixture.layout.dashes).toBe(templateDashes);
    for (const t of inspected.texts) expect(t).not.toMatch(/[✓✔]/);
    // Dash cells are bars too (page 2's band sentence has a real em dash in it).
    expect(inspected.texts[0]).not.toContain('—');
  });

  it('no placeholder: no "[" and no U+FFFD anywhere in the text, and no replaced glyphs', () => {
    for (const t of inspected.texts) {
      expect(t).not.toContain('[');
      expect(t).not.toContain('�');
    }
    expect(fixture.layout.replacedGlyphs).toBe(0);
  });

  it('nothing overlaps: page 1 table, note and footer; page 2 cards, footnote, band and footer', () => {
    const { page1, page2 } = fixture.layout;
    expect(page1.table.bottom).toBeLessThanOrEqual(page1.note.top);
    expect(page1.note.bottom).toBeLessThanOrEqual(page1.bodyBottom);
    expect(page1.bodyBottom).toBeLessThan(page1.footerTop);
    for (const card of page2.cards) {
      expect(card.top).toBeGreaterThanOrEqual(page2.heading.bottom);
      expect(card.bottom).toBeLessThanOrEqual(page2.footnote.top);
    }
    expect(page2.footnote.bottom).toBeLessThanOrEqual(page2.band.top);
    expect(page2.band.bottom).toBeLessThanOrEqual(page2.bodyBottom);
    expect(boxesDisjoint(page2.band, { top: page2.footerTop, bottom: 612 })).toBe(true);
    expect(page2.categoryFontSize).toBe(9.6);
  });

  it('sets the title and a fixed producer', async () => {
    expect(inspected.doc.getTitle()).toBe('Ms. Kenasha Paul – RPB Law Trademark Proposal');
    expect(inspected.doc.getProducer()).toBe('lectual consult-prep (pdf-lib)');
    expect(inspected.doc.getCreationDate()?.toISOString()).toBe('2026-10-20T18:00:00.000Z');
  });

  it('is deterministic: the same spec renders the same bytes', async () => {
    const again = await renderPackagesPdf(buildPackagesSpec(LEGACYCON_INPUT));
    expect(again.length).toBe(fixture.bytes.length);
    expect(Buffer.from(again).equals(Buffer.from(fixture.bytes))).toBe(true);
  });
});

// ------------------------------------------------------------------ depth

async function render(input: PackagesSpecInput) {
  const out = await renderPackagesPdfWithLayout(buildPackagesSpec(input));
  return { ...out, inspected: await inspectPdf(out.bytes) };
}

function expectPage2Fits(layout: RenderLayout) {
  const { page2 } = layout;
  for (const card of page2.cards) {
    for (const cat of card.categories) {
      expect(cat.textBottom).toBeLessThanOrEqual(cat.bottom);
      expect(cat.bottom).toBeLessThanOrEqual(card.bottom);
      for (const w of cat.lineWidths) expect(w).toBeLessThanOrEqual(cat.textMaxWidth + 0.01);
      expect(cat.textMaxWidth).toBeLessThan(card.innerWidth);
    }
    expect(card.bottom).toBeLessThanOrEqual(page2.footnote.top);
  }
  expect(page2.footnote.bottom).toBeLessThanOrEqual(page2.band.top);
  expect(page2.band.bottom).toBeLessThanOrEqual(page2.bodyBottom);
}

describe('renderPackagesPdf: product depth', () => {
  it('a 300-character category and a 40-character unbroken token wrap inside their card', async () => {
    const long = 'Organizing, arranging and conducting conferences, summits, seminars and workshops '.repeat(4).slice(0, 300);
    const token = 'X'.repeat(40);
    expect(long.length).toBe(300);
    const { layout, inspected: ins, bytes } = await render({
      ...LEGACYCON_INPUT,
      marks: [
        { name: 'LegacyCon', categories: [{ text: long, priority: true }, { text: token }] },
        { name: 'Second', categories: [{ text: token, priority: true }] },
        { name: 'Third', categories: [{ text: `${long} ${token}` }] },
      ],
    });
    expect(ins.pages).toHaveLength(2);
    expect(bytes.length).toBeLessThan(1_048_576);
    expectPage2Fits(layout);
    // The long text really did wrap onto several lines.
    expect(layout.page2.cards[0].categories[0].lineWidths.length).toBeGreaterThan(3);
  });

  for (const n of [1, 2, 3]) {
    it(`${n} mark(s) render side by side with equal widths inside the margins`, async () => {
      const marks = Array.from({ length: n }, (_, i) => ({
        name: `Mark ${i + 1}`,
        categories: [{ text: 'Business networking events', priority: i === 0 }],
      }));
      const { layout, inspected: ins } = await render({ ...LEGACYCON_INPUT, marks });
      expect(ins.pages).toHaveLength(2);
      const cards = layout.page2.cards;
      expect(cards).toHaveLength(n);
      for (const c of cards) expect(c.width).toBeCloseTo(cards[0].width, 6);
      expect(cards[0].x).toBeCloseTo(39.6, 6);
      expect(cards[n - 1].x + cards[n - 1].width).toBeCloseTo(792 - 39.6, 6);
      for (let i = 1; i < n; i++) expect(cards[i].x).toBeGreaterThan(cards[i - 1].x + cards[i - 1].width);
      expectPage2Fits(layout);
    });
  }

  it('4 marks throw too_many_marks (documented limit) rather than overflow', () => {
    const marks = [1, 2, 3, 4].map((i) => ({ name: `Mark ${i}`, categories: [{ text: 'x' }] }));
    expect(() => buildPackagesSpec({ ...LEGACYCON_INPUT, marks })).toThrow(PackagesSpecError);
  });

  it('a mark with 6 categories still fits on page 2', async () => {
    const { layout, inspected: ins } = await render(STRESS_INPUTS['six-categories']);
    expect(ins.pages).toHaveLength(2);
    expect(layout.page2.cards[0].categories).toHaveLength(6);
    expectPage2Fits(layout);
  });

  it('every stress fixture renders exactly 2 pages that fit', async () => {
    for (const input of Object.values(STRESS_INPUTS)) {
      const { layout, inspected: ins, bytes } = await render(input);
      expect(ins.pages).toHaveLength(2);
      expect(bytes.length).toBeLessThan(1_048_576);
      expectPage2Fits(layout);
    }
  });

  it('content that cannot fit throws content_overflow instead of drawing a third page or overlapping', async () => {
    const huge = 'Conferences and summits '.repeat(40);
    const spec = buildPackagesSpec({
      ...LEGACYCON_INPUT,
      marks: [1, 2, 3].map((i) => ({ name: `M${i}`, categories: Array.from({ length: 6 }, () => ({ text: huge })) })),
    });
    await expect(renderPackagesPdf(spec)).rejects.toMatchObject({ name: 'PackagesSpecError', code: 'content_overflow' });
  });

  it('priority: pill on the flagged category only; none without a flag; on both when two are flagged', async () => {
    const pills = (l: RenderLayout) => l.page2.cards.map((c) => c.categories.map((k) => k.hasTag));
    expect(pills(fixture.layout)).toEqual([[true, false]]);

    const none = await render(STRESS_INPUTS['no-priority-two-marks']);
    expect(pills(none.layout)).toEqual([[false], [false, false]]);
    expect(none.inspected.texts[1]).not.toContain('TOP PRIORITY');

    const two = await render({
      ...LEGACYCON_INPUT,
      marks: [{ name: 'LegacyCon', categories: [{ text: 'A', priority: true }, { text: 'B', priority: true }] }],
    });
    expect(pills(two.layout)).toEqual([[true, true]]);
    expect(two.inspected.texts[1].match(/TOP PRIORITY/g)).toHaveLength(2);
  });

  it('text safety: quotes, ampersands, accents, curly quotes, emoji and CJK never crash and are not markup', async () => {
    const { layout, inspected: ins } = await render({
      client: 'Zoë O’Brien-Müller',
      clientPrefix: 'Dr.',
      company: 'Café & Co. "Holdings" <b>LLC</b>',
      consultStart: LEGACYCON_INPUT.consultStart,
      marks: [{ name: '“Léa’s” & <i>Co</i> 🚀', categories: [{ text: 'Apps 🚀 東京 & “more” <script>x</script>', priority: true }] }],
    });
    expect(ins.pages).toHaveLength(2);
    const p1 = ins.texts[0];
    const p2 = ins.texts[1];
    expect(p1).toContain('PREPARED FOR DR. ZOË O’BRIEN-MÜLLER · CAFÉ & CO. "HOLDINGS" <B>LLC</B>');
    expect(p2).toContain('Dr. Zoë O’Brien-Müller – RPB Law Trademark Proposal');
    expect(p2).toContain('“LÉA’S” & <I>CO</I> ?');
    expect(p2).toContain('Apps ? ?? & “more” <script>x</script>');
    // 🚀 twice (mark + category) and 東京 once: 4 characters replaced on the page-2 draw.
    expect(layout.replacedGlyphs).toBe(4);
    for (const t of ins.texts) expect(t).not.toContain('�');
  });

  it('no content is logged during a render or a spec error', async () => {
    const calls: unknown[][] = [];
    for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void calls.push(args));
    }
    await renderPackagesPdf(buildPackagesSpec(LEGACYCON_INPUT));
    try {
      buildPackagesSpec({ ...LEGACYCON_INPUT, marks: [] });
    } catch {
      // expected
    }
    const huge = 'Conferences and summits '.repeat(40);
    await renderPackagesPdf(
      buildPackagesSpec({
        ...LEGACYCON_INPUT,
        marks: [1, 2, 3].map((i) => ({ name: `M${i}`, categories: Array.from({ length: 6 }, () => ({ text: huge })) })),
      }),
    ).catch((e: PackagesSpecError) => {
      expect(e.message).toBe('packages PDF: content_overflow (marks)');
    });
    const logged = JSON.stringify(calls);
    for (const v of ['Kenasha', 'Black Professionals', 'LegacyCon', 'LEGACYCON', 'Conferences']) expect(logged).not.toContain(v);
    expect(calls).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ code quality

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : walk(p);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(n) ? [p] : [];
  });
}

describe('packages PDF: code quality', () => {
  it('no browser engine or subprocess in the consult-prep tree or next.config.ts', () => {
    // Built from fragments so this file does not match itself.
    const strict = new RegExp(['chrom' + 'ium', 'puppe' + 'teer', 'play' + 'wright', 'child' + '_process', 'head' + 'less[ -]?(browser|chrom|shell)'].join('|'), 'i');
    const self = fileURLToPath(import.meta.url);
    const files = [...walk(path.join(ROOT, 'src', 'lib', 'consult-prep')), path.join(ROOT, 'next.config.ts')].filter((f) => f !== self);
    for (const f of files) expect(readFileSync(f, 'utf8'), f).not.toMatch(strict);
    // In the consult-prep tree even a bare "headless" is out.
    const bare = new RegExp('head' + 'less', 'i');
    for (const f of walk(path.join(ROOT, 'src', 'lib', 'consult-prep')).filter((x) => x !== self)) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(bare);
    }
  });

  it('pins pdf-lib and @pdf-lib/fontkit exactly, to the versions lawmatics-mcp resolved', () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['pdf-lib']).toBe('1.17.1');
    expect(pkg.dependencies['@pdf-lib/fontkit']).toBe('1.1.1');
  });

  it('the renderer takes its colours from palette.ts, which holds exactly the spec palette', () => {
    expect(PALETTE).toEqual({
      burgundy: '#790D24',
      plum: '#3B2226',
      deep: '#4A1622',
      cream: '#FBF5E9',
      card: '#FEF7ED',
      line: '#E7D9C3',
      taupe: '#8C6E68',
      sand: '#F3E2CF',
      gold: '#FAF0DD',
    });
    for (const f of ['render.ts', 'canvas.ts']) {
      const src = readFileSync(path.join(HERE, f), 'utf8');
      expect(src, f).toMatch(/from '\.\/palette'/);
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{6}\b/);
      expect(src, f).not.toMatch(/\brgb\(/);
    }
  });

  it('no stubs or TODOs in the packages PDF modules, and no route imports them yet (the wiring step does)', () => {
    for (const f of readdirSync(HERE).filter((n) => n.endsWith('.ts'))) {
      expect(readFileSync(path.join(HERE, f), 'utf8'), f).not.toMatch(new RegExp(['\\bTO' + 'DO\\b', '\\bFIX' + 'ME\\b', 'not imple' + 'mented'].join('|'), 'i'));
    }
    expect(readFileSync(path.join(HERE, 'spec.ts'), 'utf8')).not.toMatch(/server-only|@anthropic-ai|\bfetch\(/);
  });
});

describe('renderPackagesPdf: absent company (Sprint 4 C1)', () => {
  it('page-1 eyebrow reads "Prepared for Ms. <Client> · <Month YYYY>" with no empty segment', async () => {
    const bytes = await renderPackagesPdf(buildPackagesSpec({ ...LEGACYCON_INPUT, company: 'not recorded' }));
    const pdf = await inspectPdf(bytes);
    expect(pdf.pages).toHaveLength(2);
    const page1 = pdf.texts[0];
    // The eyebrow is drawn in letter-spaced capitals; compare without case.
    expect(page1.toLowerCase()).toContain('prepared for ms. kenasha paul · october 2026');
    expect(page1).not.toContain(' ·  · ');
    expect(page1).not.toMatch(/not recorded/i);
    expect(page1).not.toContain('BLACK PROFESSIONALS NETWORK');
  });
});

describe('renderPackagesPdf: per firm', () => {
  it('a firm with no art renders its own name, its own two packages and nothing of RPB', async () => {
    const { bytes, layout } = await renderPackagesPdfWithLayout(buildPackagesSpec(LEGACYCON_INPUT, HARBOR_FIRM));
    const ins = await inspectPdf(bytes);
    expect(ins.pages).toHaveLength(2);
    const p1 = ins.texts[0];
    const p2 = ins.texts[1];
    for (const s of ['HARBOR IP COUNSEL', 'Harbor IP Counsel', 'STARTER™', '$1,200', 'STANDARD™', '$2,100.50', 'YOU PAY', '$500 per class', '$450 per class']) {
      expect(p1).toContain(s);
    }
    expect(p1.match(/\+ Government Filing Fees/g)).toHaveLength(2);
    expect(p1).toContain('shall expire on October 31, 2026, 10 days from the date of receipt.');
    expect(p2).toContain('Ms. Kenasha Paul – Harbor IP Counsel Trademark Proposal');
    expect(p2).toContain('Each additional class is $450 to $500.');
    for (const t of [p1, p2]) for (const rpb of ['RPB', 'rpblawfirm', 'Miami', 'EST 2024', 'Essential'.toUpperCase(), '1,950']) expect(t).not.toContain(rpb);
    expect(layout.checks).toBe(0);
    expect(ins.doc.getAuthor()).toBe('Harbor IP Counsel');
    expect(ins.doc.getTitle()).toBe('Ms. Kenasha Paul – Harbor IP Counsel Trademark Proposal');
    expect(layout.page1.note.bottom).toBeLessThanOrEqual(layout.page1.bodyBottom);
  });

  it('1 to 4 packages fit the page-1 table inside the margins', async () => {
    for (const n of [1, 2, 3, 4]) {
      const packages = Array.from({ length: n }, (_, i) => ({ ...HARBOR_PACKAGES[0], package: `Tier ${i + 1}`, base_cents: 100_000 * (i + 1) }));
      const { layout, bytes } = await renderPackagesPdfWithLayout(buildPackagesSpec(LEGACYCON_INPUT, { ...HARBOR_FIRM, packages }));
      const ins = await inspectPdf(bytes);
      expect(ins.pages).toHaveLength(2);
      expect(ins.texts[0].match(/\+ Government Filing Fees/g)).toHaveLength(n);
      expect(layout.page1.note.bottom).toBeLessThanOrEqual(layout.page1.bodyBottom);
    }
  });

  it('a very long firm name is shrunk or cut in the band, never run into the section label', async () => {
    const name = 'The Extraordinarily Long-Named Intellectual Property and Trademark Counsel Group of North America, PLLC';
    const spec = buildPackagesSpec(LEGACYCON_INPUT, { ...HARBOR_FIRM, name });
    const ins = await inspectPdf(await renderPackagesPdf(spec));
    expect(ins.pages).toHaveLength(2);
    expect(ins.texts[0]).toContain('…');
    expect(ins.texts[0]).toContain('TRADEMARK PROPOSAL');
  });
});
