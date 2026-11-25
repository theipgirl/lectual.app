// TypeScript port of lectual-plugin scripts/uspto_knockout.py: a two-tier
// USPTO trademark knockout pull. The endpoint is undocumented, so every
// failure (network, timeout, non-2xx, unexpected body, a failure on any page
// of either tier) makes the WHOLE pull `unavailable`. A partial list is never
// presented as complete, and an unreachable search is never "no conflicts".
// Nothing here logs: marks, owners and goods/services are client content.

export const USPTO_URL = 'https://tmsearch.uspto.gov/prod-stage-v1-0-0/tmsearch';
export const PAGE_SIZE = 500;
/** The backend caps from+size at 10,000; the script stops once the next offset reaches 9,500. */
export const PAGING_CAP = 10000 - PAGE_SIZE;
export const DEFAULT_LIMIT = 500;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const NEAR_IDENTICAL_LISTED = 20;
export const GOODS_MAX = 600;

export type FetchFn = typeof fetch;

export interface UsptoRow {
  tier: string;
  serial: string;
  wordmark: string;
  status: 'LIVE' | 'DEAD';
  classes: string;
  reg_no: string;
  filed: string;
  reg_date: string;
  basis: string;
  owner: string;
  goods_services: string;
  tsdr: string;
  /** The values the USPTO site's own "Export" sheet shows, derived from the same record (see xlsx.ts). */
  sheet: SheetFields;
}

/** What the site's export prints for one mark. Dates are `YYYY-MM-DD`; empty is ''. */
export interface SheetFields {
  /** `IC 003: ...; IC 005: ...`, entries ordered by class, status prefix removed, cut at the site's 1,000 characters. */
  goods: string;
  /** `1b 44d`: values joined by a space. */
  basis: string;
  /** `IC 043 IC 044`: classes joined by a space. */
  classes: string;
  /** Owner text without its leading `(APPLICANT)` style label. */
  owner: string;
  priority: string;
  reg_type: string;
  supplemental: string;
}

export interface NearIdenticalHit {
  wordmark: string;
  status: 'LIVE' | 'DEAD';
  classes: string;
  owner: string;
  serial: string;
}

export interface UsptoInput {
  mark: string;
  stem?: string;
  /** Likely Nice classes: 41, "041" and "41" format identically. Non-positive-integer entries are dropped. */
  classes?: Array<number | string>;
  variants?: string[];
  limit?: number;
  /** Required: the caller injects the transport (no ambient global, so tests and firms never reach the network by accident). */
  fetch: FetchFn;
  /** Per request. Clipped to what is left before `deadline`, when one is given. */
  timeoutMs?: number;
  /**
   * Absolute time budget (epoch ms). No request starts at or after it, and each
   * request's timeout is clipped to the time left, so the whole pull ends by it.
   * A pull cut short is `unavailable`, never a partial list shown as complete.
   */
  deadline?: number;
  clock?: () => number;
}

/** Why tier 2 produced no total. */
export type StemSearch = 'ran' | 'not-run-no-stem' | 'not-run-filled';

export interface UsptoOk {
  status: 'ok';
  mark: string;
  limit: number;
  rows: UsptoRow[];
  written: number;
  /** Per-tier totals from each tier's FIRST page, keyed by tier label. */
  totals: Record<string, number>;
  tier1Total: number;
  /** Live-stem total in the likely classes; null unless tier 2 actually ran. */
  tier2Total: number | null;
  tier2Label: string | null;
  /** The stem tier 2 searched ("LEGACY") and its classes as plain numbers (["41", "35"]); null / [] unless it ran. */
  tier2Stem: string | null;
  tier2Classes: string[];
  stemSearch: StemSearch;
  /** The list was cut: written reached the limit, or paging hit the cap with more beyond it. */
  truncated: boolean;
  nearIdentical: NearIdenticalHit[];
}

export interface UsptoUnavailable {
  status: 'unavailable';
  /** Fixed generic phrase plus at most an HTTP status code, never response content. */
  reason: string;
}

export interface UsptoSkipped {
  status: 'skipped';
  reason: 'no mark';
}

export type UsptoResult = UsptoOk | UsptoUnavailable | UsptoSkipped;

/** `reason` is always one of this file's fixed sentences, never response content. */
class UnavailableError extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** Quotes and backslashes would corrupt the unescaped query string, as in the script. */
const stripQuoting = (s: string) => s.replace(/["\\]/g, '');

export function formatClass(c: number | string): string | null {
  const text = String(c).trim();
  if (!/^\d+$/.test(text)) return null;
  const n = parseInt(text, 10);
  if (!Number.isSafeInteger(n) || n < 1) return null;
  return `IC ${String(n).padStart(3, '0')}`;
}

/** Valid classes, in the order and spelling supplied. */
function validClasses(classes: Array<number | string>): Array<{ raw: string; ic: string }> {
  const out: Array<{ raw: string; ic: string }> = [];
  for (const c of classes) {
    const ic = formatClass(c);
    if (ic) out.push({ raw: String(c).trim(), ic });
  }
  return out;
}

function cleanVariants(variants: string[], mark: string): string[] {
  const seen = new Set<string>([mark.toLowerCase()]);
  const out: string[] = [];
  for (const v of variants) {
    const t = stripQuoting(String(v)).trim();
    const key = t.toLowerCase();
    if (!t || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export function buildTier1Query(mark: string, variants: string[]): string {
  const m = mark.toLowerCase();
  const terms = [m, `${m}*`, ...variants.map((v) => `"${v.toLowerCase()}"`)];
  return `wordmark:(${terms.join(' OR ')})`;
}

export function buildTier2Query(stem: string, ics: string[]): string {
  const classes = ics.map((ic) => `internationalClass:"${ic}"`).join(' OR ');
  return `wordmark:${stem.toLowerCase()}* AND alive:true AND (${classes})`;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x) => x != null).map(String) : []);

export function tsdrLink(serial: string): string {
  return `https://tsdr.uspto.gov/#caseNumber=${serial}&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch`;
}

const SHEET_GOODS_MAX = 1000;
const icNumber = (g: string): number => {
  const m = /^IC (\d+)/.exec(g);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
};

/** The site's "GoodsAndServicesTruncated": status label dropped, ordered by class, cut at a word near 1,000 characters. */
export function sheetGoods(entries: string[]): string {
  const parts = entries.map((g) => g.replace(/^\(.*?\)\s/, ''));
  const text = [...parts].sort((a, b) => icNumber(a) - icNumber(b)).join('; ');
  if (text.length <= SHEET_GOODS_MAX) return text;
  const cut = text.slice(0, SHEET_GOODS_MAX + 1).lastIndexOf(' ');
  return `${text.slice(0, cut > 0 ? cut : SHEET_GOODS_MAX)}...`;
}

/** The site's "OwnerFullText": the leading `(LABEL) ` is dropped (greedy, up to the last `) ` as the site does). */
export function sheetOwner(entries: string[]): string {
  return entries.map((o) => o.replace(/^\(.*\)\s/, '')).join('; ');
}

export function toRow(tier: string, serial: string, s: Obj): UsptoRow {
  return {
    tier,
    serial,
    wordmark: str(s.wordmark),
    status: s.alive ? 'LIVE' : 'DEAD',
    classes: strList(s.internationalClass).join('; '),
    reg_no: str(s.registrationId),
    filed: str(s.filedDate).slice(0, 10),
    reg_date: str(s.registrationDate).slice(0, 10),
    basis: strList(s.currentBasis).join(', '),
    owner: strList(s.ownerName).join('; '),
    goods_services: strList(s.goodsAndServices).join(' | ').slice(0, GOODS_MAX),
    tsdr: tsdrLink(serial),
    sheet: {
      goods: sheetGoods(strList(s.goodsAndServices)),
      basis: strList(s.currentBasis).join(' '),
      classes: strList(s.internationalClass).join(' '),
      owner: sheetOwner(strList(s.ownerFullText)),
      priority: str(s.priorityDate).slice(0, 10),
      reg_type: strList(s.registrationType).join(' '),
      supplemental: str(s.supplementalRegistrationDate).slice(0, 10),
    },
  };
}

interface Page {
  total: number;
  sources: Array<{ serial: string; source: Obj }>;
}

/** Validates the script's response shape: hits.totalValue (number) and hits.hits[].source.id. */
function parsePage(body: unknown): Page {
  if (!isObj(body) || !isObj(body.hits)) throw new UnavailableError('USPTO search returned an unexpected response');
  const hits = body.hits;
  if (typeof hits.totalValue !== 'number' || !Number.isFinite(hits.totalValue) || !Array.isArray(hits.hits)) {
    throw new UnavailableError('USPTO search returned an unexpected response');
  }
  const sources = hits.hits.map((h) => {
    const source = isObj(h) ? h.source : undefined;
    const id = isObj(source) ? source.id : undefined;
    if (!isObj(source) || (typeof id !== 'string' && typeof id !== 'number') || String(id) === '') {
      throw new UnavailableError('USPTO search returned an unexpected response');
    }
    return { serial: String(id), source };
  });
  return { total: hits.totalValue, sources };
}

async function searchPage(doFetch: FetchFn, query: string, from: number, timeoutMs: number): Promise<Page> {
  return postPage(
    doFetch,
    { query: { bool: { must: [{ query_string: { query, default_operator: 'AND' } }] } }, size: PAGE_SIZE, from, track_total_hits: true },
    timeoutMs,
  );
}

async function postPage(doFetch: FetchFn, requestBody: Obj, timeoutMs: number): Promise<Page> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // The abort stays armed through the body read, and the race makes the
  // timeout hold even for a fetch that ignores the signal.
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new UnavailableError('USPTO search timed out'));
    }, timeoutMs);
  });
  const work = (async () => {
    let res: Response;
    try {
      res = await doFetch(USPTO_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://tmsearch.uspto.gov',
          'User-Agent': 'Mozilla/5.0',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch {
      throw new UnavailableError('USPTO search request failed');
    }
    if (!res.ok) throw new UnavailableError(`USPTO search returned HTTP ${res.status}`);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new UnavailableError('USPTO search returned an unexpected response');
    }
    return parsePage(body);
  })();
  work.catch(() => undefined); // a late failure after the timeout must not go unhandled
  try {
    return await Promise.race([work, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

interface TierState {
  rows: UsptoRow[];
  seen: Set<string>;
  totals: Record<string, number>;
  capped: boolean;
}

/** One tier, exactly as the script loops it. Returns the tier's first-page total (null if no request ran). */
async function runTier(
  label: string,
  query: string,
  limit: number,
  state: TierState,
  doFetch: FetchFn,
  timeoutMs: () => number,
): Promise<number | null> {
  let from = 0;
  let firstTotal: number | null = null;
  while (state.rows.length < limit) {
    const page = await searchPage(doFetch, query, from, timeoutMs());
    if (firstTotal === null) {
      firstTotal = page.total;
      state.totals[label] = page.total;
    }
    for (const { serial, source } of page.sources) {
      if (!state.seen.has(serial) && state.rows.length < limit) {
        state.seen.add(serial);
        state.rows.push(toRow(label, serial, source));
      }
    }
    from += PAGE_SIZE;
    if (page.sources.length === 0 || from >= page.total) break;
    if (from >= PAGING_CAP) {
      state.capped = true; // more exists beyond what the cap lets us fetch
      break;
    }
  }
  return firstTotal;
}

export async function searchUspto(input: UsptoInput): Promise<UsptoResult> {
  const mark = stripQuoting(String(input.mark ?? '')).trim();
  if (!mark) return { status: 'skipped', reason: 'no mark' };

  const limit = Number.isInteger(input.limit) && (input.limit as number) > 0 ? (input.limit as number) : DEFAULT_LIMIT;
  const perRequestMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : DEFAULT_TIMEOUT_MS;
  const clock = input.clock ?? Date.now;
  const deadline = input.deadline;
  // Each request gets min(per-request, time left); none starts once the budget is spent.
  const timeoutMs = (): number => {
    if (deadline === undefined) return perRequestMs;
    const left = deadline - clock();
    if (left <= 0) throw new UnavailableError('USPTO search ran out of time');
    return Math.min(perRequestMs, left);
  };
  const doFetch = input.fetch;
  const variants = cleanVariants(input.variants ?? [], mark);
  const stem = stripQuoting(String(input.stem ?? '')).trim();
  const classes = validClasses(input.classes ?? []);

  const tier1Label = '1-near-identical';
  const tier1Query = buildTier1Query(mark, variants);
  const canRunTier2 = stem !== '' && classes.length > 0;
  const tier2Label = canRunTier2 ? `2-live ${stem.toUpperCase()} in IC ${classes.map((c) => c.raw).join(',')}` : null;

  const state: TierState = { rows: [], seen: new Set(), totals: {}, capped: false };
  let tier1Total: number | null;
  let tier2Total: number | null = null;
  let stemSearch: StemSearch = 'not-run-no-stem';

  try {
    tier1Total = await runTier(tier1Label, tier1Query, limit, state, doFetch, timeoutMs);
    if (canRunTier2 && tier2Label) {
      if (state.rows.length >= limit) {
        stemSearch = 'not-run-filled';
      } else {
        const tier2Query = buildTier2Query(stem, classes.map((c) => c.ic));
        tier2Total = await runTier(tier2Label, tier2Query, limit, state, doFetch, timeoutMs);
        stemSearch = 'ran';
      }
    }
  } catch (err) {
    const reason = err instanceof UnavailableError ? err.reason : 'USPTO search request failed';
    return { status: 'unavailable', reason };
  }

  const nearRows = state.rows.filter((r) => r.tier === tier1Label);
  return {
    status: 'ok',
    mark,
    limit,
    rows: state.rows,
    written: state.rows.length,
    totals: state.totals,
    tier1Total: tier1Total ?? 0,
    tier2Total,
    tier2Label: stemSearch === 'ran' ? tier2Label : null,
    tier2Stem: stemSearch === 'ran' ? stem.toUpperCase() : null,
    tier2Classes: stemSearch === 'ran' ? classes.map((c) => String(parseInt(c.raw, 10))) : [],
    stemSearch,
    truncated: state.rows.length >= limit || state.capped,
    nearIdentical: nearRows.slice(0, NEAR_IDENTICAL_LISTED).map((r) => ({
      wordmark: r.wordmark,
      status: r.status,
      classes: r.classes,
      owner: r.owner,
      serial: r.serial,
    })),
  };
}

// ---------------------------------------------------------------------------
// The site's own basic search, for the exported workbook. The knockout above
// (`searchUspto`) stays the source of the brief's summary; this is what the
// site's "Export, First 500 results" lists for a typed term, in relevance order.

export const SITE_PAGE_SIZE = 100;
export const SITE_LIMIT = 500;
export const SITE_SOURCE_FIELDS = [
  'id',
  'wordmark',
  'alive',
  'currentBasis',
  'filedDate',
  'goodsAndServices',
  'internationalClass',
  'ownerFullText',
  'ownerName',
  'priorityDate',
  'registrationDate',
  'registrationId',
  'registrationType',
  'supplementalRegistrationDate',
] as const;

/** The exact body the site posts for a typed term (no aggs, no highlight). */
export function buildSiteQuery(term: string, from: number): Obj {
  return {
    query: {
      bool: {
        must: [
          {
            bool: {
              should: [
                { match_phrase: { WM: { query: term, boost: 5 } } },
                { match: { WM: { query: term, boost: 2 } } },
                { match_phrase: { PM: { query: term, boost: 2 } } },
              ],
            },
          },
        ],
      },
    },
    size: SITE_PAGE_SIZE,
    from,
    track_total_hits: true,
    _source: [...SITE_SOURCE_FIELDS],
  };
}

export interface UsptoSiteInput {
  term: string;
  fetch: FetchFn;
  timeoutMs?: number;
  deadline?: number;
  clock?: () => number;
}

export interface UsptoSiteOk {
  status: 'ok';
  term: string;
  /** In the order the service returned them (relevance); never re-sorted. */
  rows: UsptoRow[];
  written: number;
  /** The service's own total for the term. */
  total: number;
  /** The list is not every match: the total is above what was written, or a later page failed. */
  truncated: boolean;
  /** A page after the first failed or ran out of time; the rows are the pages that did arrive. */
  pageFailed: boolean;
}

export type UsptoSiteResult = UsptoSiteOk | UsptoUnavailable | UsptoSkipped;

export async function searchUsptoSite(input: UsptoSiteInput): Promise<UsptoSiteResult> {
  const term = stripQuoting(String(input.term ?? '')).trim();
  if (!term) return { status: 'skipped', reason: 'no mark' };
  const perRequestMs = input.timeoutMs && input.timeoutMs > 0 ? input.timeoutMs : DEFAULT_TIMEOUT_MS;
  const clock = input.clock ?? Date.now;
  const timeoutMs = (): number => {
    if (input.deadline === undefined) return perRequestMs;
    const left = input.deadline - clock();
    if (left <= 0) throw new UnavailableError('USPTO search ran out of time');
    return Math.min(perRequestMs, left);
  };

  const rows: UsptoRow[] = [];
  const seen = new Set<string>();
  let total = 0;
  let pageFailed = false;
  for (let from = 0; rows.length < SITE_LIMIT; from += SITE_PAGE_SIZE) {
    let page: Page;
    try {
      page = await postPage(input.fetch, buildSiteQuery(term, from), timeoutMs());
    } catch (err) {
      if (from === 0) {
        return { status: 'unavailable', reason: err instanceof UnavailableError ? err.reason : 'USPTO search request failed' };
      }
      pageFailed = true; // never presented as complete
      break;
    }
    if (from === 0) total = page.total;
    for (const { serial, source } of page.sources) {
      if (!seen.has(serial) && rows.length < SITE_LIMIT) {
        seen.add(serial);
        rows.push(toRow('site', serial, source));
      }
    }
    if (page.sources.length === 0 || from + SITE_PAGE_SIZE >= total) break;
  }
  return { status: 'ok', term, rows, written: rows.length, total, truncated: pageFailed || total > rows.length, pageFailed };
}
