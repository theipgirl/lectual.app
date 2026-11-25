import { describe, expect, it, vi } from 'vitest';
import { inflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { sheetGoods, sheetOwner, toRow, type UsptoOk, type UsptoRow } from '@/lib/consult-prep/uspto/uspto';
import { buildUsptoXlsx, COLUMN_WIDTHS, HEADERS, IMAGE_MAX_BYTES, MAX_ROWS } from '@/lib/consult-prep/uspto/xlsx';

// A real 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const SOURCES = [
  {
    id: '99114870',
    wordmark: 'LUMORA',
    alive: true,
    currentBasis: ['1a'],
    filedDate: '2025-04-01T00:00:00',
    goodsAndServices: ['IC 014: Rings; Gems.'],
    internationalClass: ['IC 014'],
    ownerFullText: ['(REGISTRANT) CAMELLIA JEWELRY INC. (CORPORATION; New York, USA); 2008 Townhome Way, Huntington Station, New York 11746, UNITED STATES'],
    priorityDate: null,
    registrationDate: '2025-12-30',
    registrationId: '8084352',
    registrationType: ['PRINCIPAL'],
    supplementalRegistrationDate: null,
  },
  {
    id: '98129531',
    wordmark: 'LUMORA',
    alive: false,
    currentBasis: ['1b', '44d'],
    filedDate: '2023-07-20T00:00:00',
    goodsAndServices: ['(ABANDONED) IC 044: Medical services.'],
    internationalClass: ['IC 044'],
    ownerFullText: ['(APPLICANT) Lumora Inc. (CORPORATION; DELAWARE, USA); 548 Market Street, San Fransisco, CALIFORNIA 94104, UNITED STATES'],
    priorityDate: '2023-07-19',
    registrationDate: null,
    registrationId: null,
    registrationType: ['PRINCIPAL'],
    supplementalRegistrationDate: null,
  },
];

function okResult(rows: UsptoRow[], over: Partial<UsptoOk> = {}): UsptoOk {
  return {
    status: 'ok', mark: 'lumora', limit: 500, rows, written: rows.length, totals: {}, tier1Total: rows.length,
    tier2Total: null, tier2Label: null, tier2Stem: null, tier2Classes: [], stemSearch: 'not-run-no-stem',
    truncated: false, nearIdentical: [], ...over,
  };
}
const rowsOf = () => SOURCES.map((s) => toRow('1-near-identical', s.id, s));

type Handler = (url: string) => Response | Promise<Response> | 'hang';
function imgFetch(handler: Handler) {
  const urls: string[] = [];
  let active = 0;
  let peak = 0;
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    urls.push(String(url));
    active++;
    peak = Math.max(peak, active);
    try {
      const r = handler(String(url));
      if (r === 'hang') {
        return await new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abort'))));
      }
      return await r;
    } finally {
      active--;
    }
  });
  return { fetch: fn as unknown as typeof fetch, urls, peak: () => peak };
}
const png = () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });

function unzipNames(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const elen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString();
    const lnlen = buf.readUInt16LE(off + 26);
    const lelen = buf.readUInt16LE(off + 28);
    const data = buf.subarray(off + 30 + lnlen + lelen, off + 30 + lnlen + lelen + csize);
    out.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    p += 46 + nlen + elen + clen;
  }
  return out;
}

async function load(bytes: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb.worksheets[0];
}
const build = (rows: UsptoRow[], f: ReturnType<typeof imgFetch>, over: Partial<UsptoOk> = {}, extra: Record<string, unknown> = {}) =>
  buildUsptoXlsx({ result: okResult(rows, over), date: '2026-11-25', fetch: f.fetch, imageBudgetMs: 60_000, ...extra });
const file = async (p: ReturnType<typeof build>) => {
  const r = await p;
  if (!r.ok) throw new Error('expected a file');
  return r;
};
const textOf = (v: ExcelJS.CellValue) => (v && typeof v === 'object' && 'text' in v ? (v as { text: string }).text : v);

describe('sheet value rules', () => {
  it('drops the status label and orders goods by class, joined with "; "', () => {
    expect(sheetGoods(['(ABANDONED) IC 042: B.', 'IC 041: A.'])).toBe('IC 041: A.; IC 042: B.');
  });
  it('cuts long goods at a word near 1,000 characters with "..."', () => {
    const t = Array.from({ length: 300 }, () => 'word').join(' ');
    const out = sheetGoods([`IC 009: ${t}`]);
    expect(out.endsWith('...')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(1003);
    expect(out.slice(0, -3).endsWith('word')).toBe(true);
  });
  it('drops the owner label, up to the last ") " (a DBA after the entity wins, as on the site)', () => {
    expect(sheetOwner(['(REGISTRANT) Lumora Wealth Management LLC (LIMITED LIABILITY COMPANY; Massachusetts, USA) Lumora Wealth; 154 Warwick Road'])).toBe(
      'Lumora Wealth; 154 Warwick Road',
    );
    expect(sheetOwner(['(APPLICANT) Yu Liu (INDIVIDUAL; China); No.105, Yu County'])).toBe('Yu Liu (INDIVIDUAL; China); No.105, Yu County');
  });
});

describe('buildUsptoXlsx', () => {
  it('names the file tmSearchResults<date>.xlsx and refuses a bad date', async () => {
    const r = await file(build(rowsOf(), imgFetch(() => png())));
    expect(r.fileName).toBe('tmSearchResults2026-11-25.xlsx');
    await expect(buildUsptoXlsx({ result: okResult(rowsOf()), date: '25/11/2026', fetch: imgFetch(() => png()).fetch, imageBudgetMs: 1 })).rejects.toThrow();
  });

  it('writes the title rows, merges, headers, widths and the C2:N2 border', async () => {
    const r = await file(build(rowsOf(), imgFetch(() => png())));
    expect(r.rows).toBe(2);
    const ws = await load(r.bytes);
    expect(ws.name).toBe('tmSearch');
    expect(ws.getCell('A1').value).toBe('Search results from 1 to 2');
    expect(ws.getCell('A2').value).toBe('Search term');
    expect(ws.getCell('C2').value).toBe('lumora');
    expect([...ws.model.merges].sort()).toEqual(['A1:C1', 'A2:B2', 'C2:N2']);
    expect(ws.getCell('A3').value ?? '').toBe('');
    HEADERS.forEach((h, i) => {
      const c = ws.getCell(4, i + 1);
      expect(c.value).toBe(h);
      expect(c.font?.bold).toBe(true);
      expect(c.alignment?.horizontal).toBe('center');
    });
    COLUMN_WIDTHS.forEach((w, i) => expect(ws.getColumn(i + 1).width).toBe(w));
    expect(COLUMN_WIDTHS).toEqual([13, 10, 13, 7, 25, 7, 10, 16, 14, 11, 15, 18, 15, 27]);
    for (let c = 3; c <= 14; c++) {
      const b = ws.getCell(2, c).border;
      for (const side of ['top', 'left', 'bottom', 'right'] as const) expect(b?.[side]?.style).toBe('medium');
    }
  });

  it('writes the 14 values of a data row like the site, with the exact hyperlinks', async () => {
    const r = await file(build(rowsOf(), imgFetch(() => png())));
    const ws = await load(r.bytes);
    const v = (col: number, row = 5) => textOf(ws.getCell(row, col).value);
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map((c) => v(c))).toEqual([
      '99114870', 'LUMORA', 'Image for 99114870', 'Live', 'IC 014: Rings; Gems.', '1a', '2025-04-01', 'IC 014',
      'CAMELLIA JEWELRY INC. (CORPORATION; New York, USA); 2008 Townhome Way, Huntington Station, New York 11746, UNITED STATES',
      '', '2025-12-30', '8084352', 'PRINCIPAL', '',
    ]);
    const a = ws.getCell('A5').value as ExcelJS.CellHyperlinkValue;
    const c = ws.getCell('C5').value as ExcelJS.CellHyperlinkValue;
    expect(a.hyperlink).toBe('https://tsdr.uspto.gov/#caseNumber=99114870&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch');
    expect(c.hyperlink).toBe('https://tmcms-docs.uspto.gov/cases/99114870/mark/large.png');
    for (const addr of ['A5', 'C5']) {
      expect(ws.getCell(addr).font?.underline).toBe(true);
      expect(String(ws.getCell(addr).font?.color?.argb).slice(-6).toLowerCase()).toBe('0000ff');
    }
    // second row: dead, two bases joined by a space, a priority date, no registration number
    expect(v(4, 6)).toBe('Dead');
    expect(v(5, 6)).toBe('IC 044: Medical services.');
    expect(v(6, 6)).toBe('1b 44d');
    expect(v(10, 6)).toBe('2023-07-19');
    expect(ws.getCell('L6').value ?? null).toBeNull();
  });

  it('embeds a fetched PNG in column C of its row (one-cell anchor)', async () => {
    const f = imgFetch(() => png());
    const r = await file(build(rowsOf(), f));
    expect(r).toMatchObject({ imagesEmbedded: 2, imagesSkipped: 0 });
    expect(f.urls.sort()).toEqual([
      'https://tmcms-docs.uspto.gov/cases/98129531/mark/large.png',
      'https://tmcms-docs.uspto.gov/cases/99114870/mark/large.png',
    ]);
    const parts = unzipNames(r.bytes);
    expect([...parts.keys()].filter((k) => k.startsWith('xl/media/') && k.endsWith('.png'))).toHaveLength(2);
    const drawing = parts.get('xl/drawings/drawing1.xml')!.toString();
    const anchors = [...drawing.matchAll(/<xdr:from><xdr:col>(\d+)<\/xdr:col>.*?<xdr:row>(\d+)<\/xdr:row>/g)].map((m) => [+m[1], +m[2]]);
    expect(anchors.sort((a, b) => a[1] - b[1])).toEqual([[2, 4], [2, 5]]); // zero-based: C5 and C6
    expect(drawing).toContain('editAs="oneCell"');
    const ws = await load(r.bytes);
    expect(ws.getImages()).toHaveLength(2);
  });

  it.each([
    ['a 404', () => new Response('', { status: 404 })],
    ['not a PNG', () => new Response(Buffer.from('<html>nope</html>'), { status: 200 })],
    ['over 1 MB', () => new Response(Buffer.concat([PNG, Buffer.alloc(IMAGE_MAX_BYTES)]), { status: 200 })],
    ['over 1 MB by header', () => new Response(PNG, { status: 200, headers: { 'content-length': String(IMAGE_MAX_BYTES + 1) } })],
    ['a network error', () => { throw new Error('boom'); }],
  ])('keeps the link and no picture for %s', async (_n, handler) => {
    const f = imgFetch(handler as Handler);
    const r = await file(build(rowsOf(), f));
    expect(r).toMatchObject({ rows: 2, imagesEmbedded: 0, imagesSkipped: 2 });
    const parts = unzipNames(r.bytes);
    expect([...parts.keys()].some((k) => k.startsWith('xl/media/') && k.endsWith('.png'))).toBe(false);
    const ws = await load(r.bytes);
    expect((ws.getCell('C5').value as ExcelJS.CellHyperlinkValue).hyperlink).toBe('https://tmcms-docs.uspto.gov/cases/99114870/mark/large.png');
  });

  it('keeps the link when an image times out, without waiting past the timeout', async () => {
    const f = imgFetch(() => 'hang');
    const t0 = Date.now();
    const r = await file(build(rowsOf(), f, {}, { imageTimeoutMs: 40 }));
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r).toMatchObject({ imagesEmbedded: 0, imagesSkipped: 2 });
  });

  it('fetches no image once the budget is spent', async () => {
    const f = imgFetch(() => png());
    const r = await file(build(rowsOf(), f, {}, { imageBudgetMs: 0 }));
    expect(f.fetch).not.toHaveBeenCalled();
    expect(r).toMatchObject({ imagesEmbedded: 0, imagesSkipped: 2 });
  });

  it('caps rows at 500, fetches at most 6 images at once, and says truncated', async () => {
    const many = Array.from({ length: 520 }, (_, i) => toRow('1-near-identical', String(90000000 + i), { id: String(90000000 + i), wordmark: 'X', alive: true }));
    const f = imgFetch(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return png();
    });
    const r = await file(build(many, f, { written: 520 }));
    expect(r.rows).toBe(MAX_ROWS);
    expect(r.truncated).toBe(true);
    expect(f.urls).toHaveLength(500);
    expect(f.peak()).toBeLessThanOrEqual(6);
    expect(r.imagesEmbedded + r.imagesSkipped).toBe(500);
    const ws = await load(r.bytes);
    expect(ws.getCell('A1').value).toBe('Search results from 1 to 500');
    expect(ws.getCell('A504').value).toBeTruthy();
    expect(ws.getCell('A505').value ?? null).toBeNull();
  });

  it('a cut-short search says truncated and the title states the real count', async () => {
    const r = await file(build(rowsOf(), imgFetch(() => png()), { truncated: true, tier1Total: 900 }));
    expect(r.truncated).toBe(true);
    expect((await load(r.bytes)).getCell('A1').value).toBe('Search results from 1 to 2');
  });

  it('passes a failed or skipped search through with no file', async () => {
    const f = imgFetch(() => png());
    expect(await buildUsptoXlsx({ result: { status: 'unavailable', reason: 'USPTO search returned HTTP 503' }, date: '2026-11-25', fetch: f.fetch, imageBudgetMs: 1 })).toEqual({
      ok: false, status: 'unavailable', reason: 'USPTO search returned HTTP 503',
    });
    expect(await buildUsptoXlsx({ result: { status: 'skipped', reason: 'no mark' }, date: '2026-11-25', fetch: f.fetch, imageBudgetMs: 1 })).toMatchObject({ ok: false, status: 'skipped' });
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('never logs record content', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    await file(build(rowsOf(), imgFetch(() => new Response('', { status: 500 }))));
    spies.forEach((s) => expect(s).not.toHaveBeenCalled());
    spies.forEach((s) => s.mockRestore());
  });
});
