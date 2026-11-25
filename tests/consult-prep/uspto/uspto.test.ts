import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatClass, searchUspto, tsdrLink, type UsptoOk, type UsptoResult } from '@/lib/consult-prep/uspto/uspto';
import {
  body,
  fakeFetch,
  hangingFetch,
  legacyConResponder,
  LEGACY_T1,
  LEGACY_T2,
  pagedHits,
  source,
  type RecordedCall,
  type Reply,
} from './uspto-fixtures';

const LEGACY = {
  mark: 'LegacyCon',
  stem: 'legacy',
  classes: [41, 35],
  variants: ['legacy con', 'legacy conference'],
};

function ok(r: UsptoResult): UsptoOk {
  expect(r.status).toBe('ok');
  return r as UsptoOk;
}

beforeEach(() => {
  // Any code path that reaches the platform fetch is a leak and fails loudly.
  vi.stubGlobal('fetch', () => {
    throw new Error('real network call attempted');
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('queries and request shape', () => {
  it('builds the LegacyCon tier 1 query', async () => {
    const f = fakeFetch(legacyConResponder);
    await searchUspto({ ...LEGACY, fetch: f.fetch });
    expect(f.calls[0].query).toBe(LEGACY_T1);
  });

  it('builds the LegacyCon tier 2 query with IC 041 and IC 035', async () => {
    const f = fakeFetch(legacyConResponder);
    await searchUspto({ ...LEGACY, fetch: f.fetch });
    expect(f.calls[1].query).toBe(LEGACY_T2);
  });

  it('labels tiers like the script', async () => {
    const f = fakeFetch(legacyConResponder);
    const r = ok(await searchUspto({ ...LEGACY, fetch: f.fetch }));
    expect(r.rows.filter((x) => x.tier === '1-near-identical')).toHaveLength(2);
    const t2 = r.rows.filter((x) => x.tier === '2-live LEGACY in IC 41,35');
    expect(t2.map((x) => x.serial)).toEqual(['90000003', '90000004']);
    expect(r.totals).toEqual({ '1-near-identical': 2, '2-live LEGACY in IC 41,35': 3 });
  });

  it("posts to the tmsearch endpoint with the script's headers and body shape", async () => {
    const f = fakeFetch(legacyConResponder);
    await searchUspto({ ...LEGACY, fetch: f.fetch });
    for (const c of f.calls) {
      expect(c.url).toBe('https://tmsearch.uspto.gov/prod-stage-v1-0-0/tmsearch');
      expect(c.method).toBe('POST');
      expect(c.headers).toEqual({
        'Content-Type': 'application/json',
        Origin: 'https://tmsearch.uspto.gov',
        'User-Agent': 'Mozilla/5.0',
      });
      expect(c.body.size).toBe(500);
      expect(c.body.track_total_hits).toBe(true);
      expect(c.body.query.bool.must[0].query_string.default_operator).toBe('AND');
    }
  });

  it('formats classes as IC 0NN', () => {
    expect([41, '035', '7'].map(formatClass)).toEqual(['IC 041', 'IC 035', 'IC 007']);
  });

  it('formats "041" and 41 identically and drops non-positive-integer classes', async () => {
    const f = fakeFetch(legacyConResponder);
    await searchUspto({ ...LEGACY, classes: ['041', 35, 'abc', 0, NaN, -3, '4.5'], fetch: f.fetch });
    expect(f.calls[1].query).toBe(LEGACY_T2);
    const g = fakeFetch(legacyConResponder);
    await searchUspto({ ...LEGACY, classes: [41, '035'], fetch: g.fetch });
    expect(g.calls[1].query).toBe(LEGACY_T2);
  });

  it('strips quotes and backslashes, trims, and dedupes variants and mark-equal variants', async () => {
    const f = fakeFetch(() => ({ body: body(0, []) }));
    await searchUspto({
      mark: '  Legacy"Con\\ ',
      stem: 'legacy',
      classes: [41],
      variants: [' legacy con ', 'LEGACY CON', '', '   ', 'LEGACYCON', 'legacy "conference"', 'legacy\\ conference'],
      fetch: f.fetch,
    });
    expect(f.calls[0].query).toBe('wordmark:(legacycon OR legacycon* OR "legacy con" OR "legacy conference")');
    expect(f.calls[0].query).not.toMatch(/\\/);
  });
});

describe('row mapping', () => {
  it('maps a fixture hit to a row', async () => {
    const f = fakeFetch(legacyConResponder);
    const r = ok(await searchUspto({ ...LEGACY, fetch: f.fetch }));
    expect(r.rows[0]).toEqual({
      tier: '1-near-identical',
      serial: '90000001',
      wordmark: 'LEGACYCON',
      status: 'LIVE',
      classes: '041; 035',
      reg_no: 'R90000001',
      filed: '2021-03-04',
      reg_date: '2022-05-06',
      basis: '1A',
      owner: 'Legacy Events, Inc.',
      goods_services: 'Services for 90000001',
      tsdr: 'https://tsdr.uspto.gov/#caseNumber=90000001&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch',
      sheet: {
        goods: 'Services for 90000001',
        basis: '1A',
        classes: '041 035',
        owner: '',
        priority: '',
        reg_type: '',
        supplemental: '',
      },
    });
    expect(r.rows[1].status).toBe('DEAD');
    expect(tsdrLink('1')).toContain('caseNumber=1&');
  });

  it('joins goods with " | " and caps them at 600 characters', async () => {
    const f = fakeFetch(() => ({ body: body(1, [source('1', { goodsAndServices: ['a'.repeat(400), 'b'.repeat(300)] })]) }));
    const r = ok(await searchUspto({ mark: 'X', fetch: f.fetch }));
    expect(r.rows[0].goods_services).toHaveLength(600);
    expect(r.rows[0].goods_services.slice(398, 403)).toBe('aa | ');
  });

  it('tolerates absent optional fields as empty strings', async () => {
    const f = fakeFetch(() => ({ body: body(1, [{ id: '77' }]) }));
    const r = ok(await searchUspto({ mark: 'X', fetch: f.fetch }));
    expect(r.rows[0]).toMatchObject({
      serial: '77', wordmark: '', status: 'DEAD', classes: '', reg_no: '', filed: '', reg_date: '', basis: '', owner: '', goods_services: '',
    });
  });
});

describe('tiers, dedupe and the limit', () => {
  it('puts tier 1 rows before tier 2 rows', async () => {
    const f = fakeFetch(legacyConResponder);
    const r = ok(await searchUspto({ ...LEGACY, fetch: f.fetch }));
    const tiers = r.rows.map((x) => x.tier[0]);
    expect(tiers).toEqual(['1', '1', '2', '2']);
  });

  it('dedupes a serial present in both tiers, keeping the tier 1 copy', async () => {
    const f = fakeFetch(legacyConResponder);
    const r = ok(await searchUspto({ ...LEGACY, fetch: f.fetch }));
    const dup = r.rows.filter((x) => x.serial === '90000001');
    expect(dup).toHaveLength(1);
    expect(dup[0].tier).toBe('1-near-identical');
    expect(r.written).toBe(4);
  });

  it('caps the combined list at 500 and skips tier 2 when tier 1 fills it', async () => {
    const f = fakeFetch((c) => pagedHits('a', 600, 600, c));
    const r = ok(await searchUspto({ ...LEGACY, fetch: f.fetch }));
    expect(r.rows).toHaveLength(500);
    expect(f.calls).toHaveLength(1);
    expect(f.calls.every((c) => c.query === LEGACY_T1)).toBe(true);
    expect(r.stemSearch).toBe('not-run-filled');
    expect(r.tier2Total).toBeNull();
    expect(r.truncated).toBe(true);
  });

  it('never exceeds a smaller custom limit across tiers', async () => {
    const f = fakeFetch((c) => (c.query === LEGACY_T1 ? pagedHits('a', 3, 3, c) : pagedHits('b', 10, 10, c)));
    const r = ok(await searchUspto({ ...LEGACY, limit: 5, fetch: f.fetch }));
    expect(r.rows).toHaveLength(5);
    expect(r.truncated).toBe(true);
  });

  it('is not truncated just because dedupe made written fewer than the tier totals', async () => {
    const f = fakeFetch(legacyConResponder);
    const r = ok(await searchUspto({ ...LEGACY, fetch: f.fetch }));
    expect(r.totals['1-near-identical'] + r.tier2Total!).toBe(5);
    expect(r.written).toBe(4);
    expect(r.truncated).toBe(false);
  });
});

describe('pagination', () => {
  it('advances from by 500 and stops when the offset reaches the total', async () => {
    const f = fakeFetch((c) => pagedHits('a', 1000, 1000, c));
    const r = ok(await searchUspto({ mark: 'X', limit: 5000, fetch: f.fetch }));
    expect(f.calls.map((c) => c.from)).toEqual([0, 500]);
    expect(r.rows).toHaveLength(1000);
    expect(r.truncated).toBe(false);
  });

  it('stops paging on an empty hits page', async () => {
    const f = fakeFetch((c) => (c.from === 0 ? pagedHits('a', 500, 5000, c) : { body: body(5000, []) }));
    const r = ok(await searchUspto({ mark: 'X', limit: 5000, fetch: f.fetch }));
    expect(f.calls.map((c) => c.from)).toEqual([0, 500]);
    expect(r.rows).toHaveLength(500);
  });

  it('stops paging at the 10,000 cap', async () => {
    const f = fakeFetch((c) => pagedHits('a', 50000, 50000, c));
    const r = ok(await searchUspto({ mark: 'X', limit: 100000, fetch: f.fetch }));
    const froms = f.calls.map((c) => c.from);
    expect(froms[froms.length - 1]).toBe(9000);
    expect(Math.max(...froms)).toBe(9000);
    expect(froms).toHaveLength(19);
    expect(r.truncated).toBe(true);
  });

  it('takes the tier total from the first page only', async () => {
    const f = fakeFetch((c) => pagedHits('a', 1000, c.from === 0 ? 1000 : 7, c));
    const r = ok(await searchUspto({ mark: 'X', limit: 5000, fetch: f.fetch }));
    expect(r.totals['1-near-identical']).toBe(1000);
    expect(r.tier1Total).toBe(1000);
    expect(f.calls).toHaveLength(2);
  });
});

describe('honest failure', () => {
  const failures: Array<[string, (c: RecordedCall) => Reply]> = [
    ['on a network error', () => new Error('ECONNRESET to tmsearch')],
    ['on a non-2xx response', () => ({ status: 503, body: { error: 'Secret server detail' } })],
    ['when hits is missing', () => ({ body: { nothing: true } })],
    ['when the body is not JSON', () => ({ text: '<html>not json' })],
    ['when totalValue is missing', () => ({ body: { hits: { hits: [] } } })],
    ['when hits.hits is not an array', () => ({ body: { hits: { totalValue: 1, hits: {} } } })],
    ['when a hit has no source.id', () => ({ body: { hits: { totalValue: 1, hits: [{ source: { wordmark: 'X' } }] } } })],
    ['when page 2 fails after page 1 succeeded', (c) => (c.from === 0 ? pagedHits('a', 1000, 1000, c) : { status: 500 })],
    ['when tier 2 fails after tier 1 succeeded', (c) => (c.query === LEGACY_T1 ? { body: body(1, [source('1')]) } : new Error('boom'))],
  ];

  for (const [name, responder] of failures) {
    it(`returns unavailable ${name}`, async () => {
      const f = fakeFetch(responder);
      const r = await searchUspto({ ...LEGACY, limit: 5000, fetch: f.fetch });
      expect(r.status).toBe('unavailable');
      expect('rows' in r).toBe(false);
    });
  }

  it('returns unavailable on a timeout', async () => {
    const r = await searchUspto({ ...LEGACY, fetch: hangingFetch(), timeoutMs: 20 });
    expect(r.status).toBe('unavailable');
    expect('rows' in r).toBe(false);
  });

  it('returns unavailable when headers arrive but the body stalls', async () => {
    const f = fakeFetch(() => 'stall-body');
    const r = await searchUspto({ ...LEGACY, fetch: f.fetch, timeoutMs: 20 });
    expect(r.status).toBe('unavailable');
  });

  it('gives a generic reason: a fixed phrase plus at most an HTTP status', async () => {
    const f = fakeFetch(() => ({ status: 503, body: { error: 'Secret server detail' } }));
    const r = await searchUspto({ ...LEGACY, fetch: f.fetch });
    expect(r).toEqual({ status: 'unavailable', reason: 'USPTO search returned HTTP 503' });
    const g = fakeFetch(() => new Error('ECONNRESET LegacyCon'));
    const r2 = await searchUspto({ ...LEGACY, fetch: g.fetch });
    expect(JSON.stringify(r2)).not.toMatch(/ECONNRESET|LegacyCon/);
  });
});

describe('skipped and edge inputs', () => {
  for (const mark of ['', '   ', '\t\n', '""']) {
    it(`returns skipped without any fetch call for mark ${JSON.stringify(mark)}`, async () => {
      const f = fakeFetch(legacyConResponder);
      const r = await searchUspto({ ...LEGACY, mark, fetch: f.fetch });
      expect(r).toEqual({ status: 'skipped', reason: 'no mark' });
      expect(f.spy).not.toHaveBeenCalled();
    });
  }

  it('skips tier 2 only when stem or classes are empty', async () => {
    for (const over of [{ stem: '' }, { stem: '  ' }, { classes: [] }, { classes: ['abc', 0] }]) {
      const f = fakeFetch(legacyConResponder);
      const r = ok(await searchUspto({ ...LEGACY, ...over, fetch: f.fetch }));
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0].query).toBe(LEGACY_T1);
      expect(r.stemSearch).toBe('not-run-no-stem');
      expect(r.tier2Total).toBeNull();
      expect(r.rows.length).toBe(2);
    }
  });

  it('builds near-identical list from the first 20 tier 1 rows', async () => {
    const f = fakeFetch((c) => pagedHits('t', 25, 25, c));
    const r = ok(await searchUspto({ mark: 'X', fetch: f.fetch }));
    expect(r.nearIdentical).toHaveLength(20);
    expect(Object.keys(r.nearIdentical[0]).sort()).toEqual(['classes', 'owner', 'serial', 'status', 'wordmark']);
    expect(r.nearIdentical[19].serial).toBe('t19');
    expect(r.tier1Total).toBe(25);
  });

  it('records a tier 2 total of 0 only when tier 2 ran and reported 0', async () => {
    const f = fakeFetch((c) => (c.query === LEGACY_T1 ? { body: body(0, []) } : { body: body(0, []) }));
    const r = ok(await searchUspto({ ...LEGACY, fetch: f.fetch }));
    expect(r.stemSearch).toBe('ran');
    expect(r.tier2Total).toBe(0);
  });
});

describe('no network and no logging', () => {
  it('never makes a real network call', async () => {
    // The global fetch stub throws; an injected fetch is the only way through.
    const f = fakeFetch(legacyConResponder);
    await searchUspto({ ...LEGACY, fetch: f.fetch });
    expect(f.spy).toHaveBeenCalled();
    await expect(Promise.resolve().then(() => (globalThis.fetch as unknown as () => void)())).rejects.toThrow('real network call');
  });

  it('logs nothing containing search content on success or any failure path', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const responders: Array<(c: RecordedCall) => Reply> = [
      legacyConResponder,
      () => new Error('LegacyCon Legacy Events'),
      () => ({ status: 500, body: { goods: 'Conferences' } }),
      () => ({ body: { nothing: 'LegacyCon' } }),
    ];
    for (const r of responders) await searchUspto({ ...LEGACY, fetch: fakeFetch(r).fetch });
    await searchUspto({ ...LEGACY, fetch: hangingFetch(), timeoutMs: 10 });
    await searchUspto({ ...LEGACY, mark: '', fetch: fakeFetch(legacyConResponder).fetch });
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});

describe('time budget (Sprint 5)', () => {
  it('a spent budget starts no request and is unavailable, never "no conflicts"', async () => {
    const f = fakeFetch(legacyConResponder);
    const r = await searchUspto({ ...LEGACY, fetch: f.fetch, deadline: 1_000, clock: () => 1_000 });
    expect(r).toEqual({ status: 'unavailable', reason: 'USPTO search ran out of time' });
    expect(f.calls).toHaveLength(0);
  });

  it('each request timeout is clipped to the time left', async () => {
    vi.useFakeTimers();
    try {
      const started = Date.now();
      const pending = searchUspto({ ...LEGACY, fetch: hangingFetch(), timeoutMs: 20_000, deadline: started + 50 });
      await vi.advanceTimersByTimeAsync(60);
      await expect(pending).resolves.toMatchObject({ status: 'unavailable' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('a budget that runs out between tiers stops before tier 2', async () => {
    let t = 0;
    const f = fakeFetch((call) => {
      t = 10_000; // the first request "takes" the whole budget
      return legacyConResponder(call);
    });
    const r = await searchUspto({ ...LEGACY, fetch: f.fetch, deadline: 5_000, clock: () => t });
    expect(r.status).toBe('unavailable');
    expect(f.calls.map((c) => c.query)).toEqual([LEGACY_T1]);
  });
});
