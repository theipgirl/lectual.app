// The USPTO site's own "Export -> First 500 results" workbook, rebuilt: one
// sheet "tmSearch", the same title rows, headers, widths, links and (when the
// mark's PNG can be fetched) the same embedded image per row. The values come
// from the knockout rows `searchUspto` already read (`row.sheet`).
//
// Pure apart from the injected `fetch` and clock. Nothing here logs: serials,
// marks, owners and URLs are client content, so only counts are returned.
// A failed or skipped image never fails the file: the row keeps its text link.

import ExcelJS from 'exceljs';
import type { FetchFn, UsptoOk, UsptoResult, UsptoRow } from './uspto';

export const SHEET_NAME = 'tmSearch';
export const MAX_ROWS = 500;
export const MAX_IMAGES = 500;
export const IMAGE_CONCURRENCY = 6;
export const IMAGE_TIMEOUT_MS = 10_000;
export const IMAGE_MAX_BYTES = 1024 * 1024;
export const LINK_TOOLTIP = 'Click once to follow. Click and hold to select this cell.';

export const HEADERS = [
  'SerialNumber',
  'Wordmark',
  'Image',
  'Status',
  'GoodsAndServicesTruncated',
  'Basis',
  'FiledDate',
  'InternationalClass',
  'OwnerFullText',
  'PriorityDate',
  'RegistrationDate',
  'RegistrationNumber',
  'RegistrationType',
  'SupplementalRegistrationDate',
] as const;

export const COLUMN_WIDTHS = [13, 10, 13, 7, 25, 7, 10, 16, 14, 11, 15, 18, 15, 27] as const;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const LINK_FONT = { underline: true, color: { argb: 'FF0000FF' } } as const;
const MEDIUM_BLACK = { style: 'medium', color: { argb: 'FF000000' } } as const;

export function tsdrUrl(serial: string): string {
  return `https://tsdr.uspto.gov/#caseNumber=${serial}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch`;
}

export function imageUrl(serial: string): string {
  return `https://tmcms-docs.uspto.gov/cases/${serial}/mark/large.png`;
}

export function xlsxFileName(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new TypeError('date must be YYYY-MM-DD');
  return `tmSearchResults${date}.xlsx`;
}

export interface UsptoXlsxInput {
  result: UsptoResult;
  /** The firm's calendar date at build time, `YYYY-MM-DD` (a string so this stays pure). */
  date: string;
  /** Injected transport for the mark images; never an ambient global. */
  fetch: FetchFn;
  /** Time left for ALL image fetching, in ms. 0 or less fetches none. */
  imageBudgetMs: number;
  clock?: () => number;
  /** Per image. Clipped to what is left of the budget. */
  imageTimeoutMs?: number;
}

export interface UsptoXlsxFile {
  ok: true;
  fileName: string;
  bytes: Buffer;
  /** Data rows written (never more than 500). */
  rows: number;
  /** The search stopped before every match was listed (carried from the search). */
  truncated: boolean;
  imagesEmbedded: number;
  imagesSkipped: number;
}

export type UsptoXlsxResult =
  | UsptoXlsxFile
  | { ok: false; status: 'unavailable' | 'skipped'; reason: string };

const isPng = (b: Buffer): boolean => b.length >= PNG_SIGNATURE.length && b.subarray(0, 8).equals(PNG_SIGNATURE);

/** One image, or null for any reason at all. Never throws. */
async function fetchPng(doFetch: FetchFn, serial: string, timeoutMs: number): Promise<Buffer | null> {
  if (!/^\d{1,12}$/.test(serial)) return null;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, timeoutMs);
  });
  const work = (async (): Promise<Buffer | null> => {
    const res = await doFetch(imageUrl(serial), { signal: controller.signal });
    if (!res.ok) return null;
    const declared = Number(res.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > IMAGE_MAX_BYTES || !isPng(buf)) return null;
    return buf;
  })().catch(() => null);
  try {
    return await Promise.race([work, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch the images (at most 500, 6 at once, inside the budget). Index-aligned with `rows`. */
async function fetchImages(rows: UsptoRow[], input: UsptoXlsxInput): Promise<Array<Buffer | null>> {
  const clock = input.clock ?? Date.now;
  const deadline = clock() + input.imageBudgetMs;
  const perImage = input.imageTimeoutMs && input.imageTimeoutMs > 0 ? input.imageTimeoutMs : IMAGE_TIMEOUT_MS;
  const out: Array<Buffer | null> = rows.map(() => null);
  const limit = Math.min(rows.length, MAX_IMAGES);
  let next = 0;
  const worker = async () => {
    while (next < limit) {
      const i = next++;
      const left = deadline - clock();
      if (left <= 0) return;
      out[i] = await fetchPng(input.fetch, rows[i].serial, Math.min(perImage, left));
    }
  };
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, limit) }, worker));
  return out;
}

function link(text: string, hyperlink: string): ExcelJS.CellHyperlinkValue {
  return { text, hyperlink, tooltip: LINK_TOOLTIP };
}

export async function buildUsptoXlsx(input: UsptoXlsxInput): Promise<UsptoXlsxResult> {
  const result = input.result;
  if (result.status !== 'ok') return { ok: false, status: result.status, reason: result.reason };
  const fileName = xlsxFileName(input.date);
  const ok: UsptoOk = result;
  const rows = ok.rows.slice(0, MAX_ROWS);
  const truncated = ok.truncated || ok.rows.length > MAX_ROWS;
  const pngs = await fetchImages(rows, input);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET_NAME);
  COLUMN_WIDTHS.forEach((width, i) => {
    ws.getColumn(i + 1).width = width;
  });

  ws.getCell('A1').value = `Search results from 1 to ${rows.length}`;
  ws.mergeCells('A1:C1');
  ws.getCell('A2').value = 'Search term';
  ws.mergeCells('A2:B2');
  ws.getCell('C2').value = ok.mark;
  ws.mergeCells('C2:N2');
  for (let c = 3; c <= 14; c++) {
    ws.getCell(2, c).border = { top: MEDIUM_BLACK, left: MEDIUM_BLACK, bottom: MEDIUM_BLACK, right: MEDIUM_BLACK };
  }
  ws.getCell('A3').value = '';
  HEADERS.forEach((h, i) => {
    const cell = ws.getCell(4, i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center' };
  });

  let embedded = 0;
  let skipped = 0;
  rows.forEach((row, i) => {
    const r = 5 + i;
    const s = row.sheet;
    const a = ws.getCell(r, 1);
    a.value = link(row.serial, tsdrUrl(row.serial));
    a.font = LINK_FONT;
    ws.getCell(r, 2).value = row.wordmark;
    const c = ws.getCell(r, 3);
    const png = pngs[i];
    c.value = link(`Image for ${row.serial}`, imageUrl(row.serial));
    c.font = LINK_FONT;
    ws.getCell(r, 4).value = row.status === 'LIVE' ? 'Live' : 'Dead';
    ws.getCell(r, 5).value = s.goods;
    ws.getCell(r, 6).value = s.basis;
    ws.getCell(r, 7).value = row.filed;
    ws.getCell(r, 8).value = s.classes;
    ws.getCell(r, 9).value = s.owner;
    ws.getCell(r, 10).value = s.priority;
    ws.getCell(r, 11).value = row.reg_date;
    if (row.reg_no) ws.getCell(r, 12).value = row.reg_no;
    ws.getCell(r, 13).value = s.reg_type;
    ws.getCell(r, 14).value = s.supplemental;
    if (png) {
      // `Buffer` here is Node's; exceljs accepts it for an embedded image.
      const id = wb.addImage({ buffer: png as unknown as ExcelJS.Buffer, extension: 'png' });
      ws.addImage(id, {
        tl: { col: 2, row: r - 1 },
        br: { col: 3, row: r },
        editAs: 'oneCell',
        hyperlinks: { hyperlink: imageUrl(row.serial), tooltip: LINK_TOOLTIP },
      } as unknown as ExcelJS.ImageRange);
      embedded++;
    } else {
      skipped++;
    }
  });

  const bytes = Buffer.from(await wb.xlsx.writeBuffer());
  return { ok: true, fileName, bytes, rows: rows.length, truncated, imagesEmbedded: embedded, imagesSkipped: skipped };
}
