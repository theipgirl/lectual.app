import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchUspto, type UsptoOk, type UsptoResult } from '@/lib/consult-prep/uspto/uspto';
import { summarizeUspto } from '@/lib/consult-prep/uspto/uspto-summary';
import { buildUsptoXlsx } from '@/lib/consult-prep/uspto/xlsx';
import { body, fakeFetch, legacyConResponder, LEGACY_T1, pagedHits, source } from './uspto-fixtures';

const LEGACY = { mark: 'LegacyCon', stem: 'legacy', classes: [41, 35], variants: ['legacy con', 'legacy conference'] };
const DISCLAIMER = 'knockout list, not a clearance or comprehensive search';

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('real network call attempted');
  });
});
afterEach(() => vi.unstubAllGlobals());

const run = async (responder = legacyConResponder, extra = {}) =>
  (await searchUspto({ ...LEGACY, ...extra, fetch: fakeFetch(responder).fetch })) as UsptoOk;

const failures: Array<[string, UsptoResult]> = [
  ['unavailable', { status: 'unavailable', reason: 'USPTO search returned HTTP 503' }],
  ['skipped', { status: 'skipped', reason: 'no mark' }],
];

describe('summarizeUspto', () => {
  it('ok summary names near-identical hits with wordmark, LIVE/DEAD, classes and owner', async () => {
    const text = summarizeUspto(await run());
    expect(text).toContain('LEGACYCON — LIVE — IC 041; 035 — Legacy Events, Inc. — serial 90000001');
    expect(text).toContain('LEGACY CON — DEAD — IC 041 — Old Owner Co — serial 90000002');
    expect(text).toContain('Near-identical hits (2):');
  });

  it('ok summary reports the live stem total in the likely classes', async () => {
    const text = summarizeUspto(await run());
    expect(text).toContain('Live marks containing LEGACY in Classes 41, 35: 3 total.');
    // Plain words: the internal tier label never reaches the brief.
    expect(text).not.toMatch(/2-live|\bIC 41,35\b/);
  });

  it('says showing first 20 of N when the total exceeds 20', async () => {
    const text = summarizeUspto(await run((c) => (c.query === LEGACY_T1 ? pagedHits('t', 25, 25, c) : { body: body(0, []) })));
    expect(text).toContain('showing first 20 of 25');
    expect((text.match(/serial t\d+/g) ?? []).length).toBe(20);
  });

  it('ok summary says first 500 attached when the list was cut at the limit', async () => {
    const r = await run((c) => pagedHits('a', 600, 600, c));
    const text = summarizeUspto(r);
    expect(r.truncated).toBe(true);
    expect(text).toContain('First 500 attached');
    expect(text).toContain('Stem search was not run because the near-identical hits filled the list.');
    expect(text).not.toMatch(/stem[^.]*: 0 total/i);
  });

  it('says the full list is attached (with the row count) when not truncated, even with dedupe overlap', async () => {
    const r = await run();
    const text = summarizeUspto(r);
    expect(r.truncated).toBe(false);
    expect(text).toContain('Full list attached: 4 rows.');
    expect(text).not.toContain('First 500');
  });

  it('uses the actual limit in the truncated wording', async () => {
    const text = summarizeUspto(await run((c) => pagedHits('a', 50, 50, c), { limit: 10 }));
    expect(text).toContain('First 10 attached');
  });

  it('ok with zero near-identical hits says so and still includes the knockout disclaimer', async () => {
    const text = summarizeUspto(await run(() => ({ body: body(0, []) })));
    expect(text).toContain('0 near-identical hits found in this knockout list');
    const zeroLine = text.split('\n')[0];
    expect(zeroLine).not.toMatch(/no conflicts?|clear/i);
    expect(text).toContain(DISCLAIMER);
    expect(text).toContain('Live marks containing LEGACY in Classes 41, 35: 0 total.');
  });

  it('one class reads "Class 41", and a zero-padded class is shown plainly', async () => {
    const text = summarizeUspto(await run(legacyConResponder, { classes: ['041'] }));
    expect(text).toMatch(/Live marks containing LEGACY in Class 41: \d+ total\./);
    expect(text).not.toContain('2-live');
  });

  it('says the stem search was not run when stem or classes are missing', async () => {
    const text = summarizeUspto(await run(legacyConResponder, { stem: '' }));
    expect(text).toContain('Stem search was not run (no stem or likely classes were given).');
    expect(text).not.toContain('0 total');
  });

  it("unavailable summary reads 'USPTO search unavailable — run it on the call' and never says no conflicts", () => {
    const text = summarizeUspto(failures[0][1]);
    expect(text).toContain('USPTO search unavailable — run it on the call');
    expect(text).not.toMatch(/no conflicts?/i);
    expect(text).not.toContain('HTTP 503');
  });

  it("skipped summary reads 'Nothing to search'", () => {
    expect(summarizeUspto(failures[1][1])).toContain('Nothing to search');
    expect(summarizeUspto(failures[1][1])).not.toContain('near-identical hits found');
  });

  it("every status contains 'knockout list, not a clearance'", async () => {
    for (const r of [await run(), ...failures.map((f) => f[1])]) {
      expect(summarizeUspto(r)).toContain(DISCLAIMER);
    }
  });

  it('no failure path text contains zero-result wording', async () => {
    const real = [
      await searchUspto({ ...LEGACY, fetch: fakeFetch(() => new Error('x')).fetch }),
      await searchUspto({ ...LEGACY, fetch: fakeFetch(() => ({ status: 500 })).fetch }),
      await searchUspto({ ...LEGACY, fetch: fakeFetch(() => ({ body: {} })).fetch }),
      await searchUspto({ ...LEGACY, mark: ' ', fetch: fakeFetch(() => ({ body: {} })).fetch }),
      ...failures.map((f) => f[1]),
    ];
    for (const r of real) {
      expect(r.status).not.toBe('ok');
      const text = summarizeUspto(r);
      expect(text).not.toMatch(/no conflicts?|0 conflicts|none found|0 near-identical|0 total/i);
    }
  });

  it('composes end to end: fixture -> search -> xlsx -> summary with consistent counts', async () => {
    const f = fakeFetch(legacyConResponder);
    const r = (await searchUspto({ ...LEGACY, fetch: f.fetch })) as UsptoOk;
    const x = await buildUsptoXlsx({ result: r, date: '2026-11-25', fetch: (async () => new Response('', { status: 404 })) as typeof fetch, imageBudgetMs: 1000 });
    if (!x.ok) throw new Error('expected a file');
    expect(x.rows).toBe(r.written);
    expect(x.fileName).toBe('tmSearchResults2026-11-25.xlsx');
    const text = summarizeUspto(r);
    expect(text).toContain(`Full list attached: ${r.written} rows.`);
    expect(text).not.toContain('First 500');
  });

  it('composes a truncated list consistently (500 rows everywhere, first 500 attached)', async () => {
    const r = await run((c) => pagedHits('a', 600, 600, c));
    const x = await buildUsptoXlsx({ result: r, date: '2026-11-25', fetch: (async () => new Response('', { status: 404 })) as typeof fetch, imageBudgetMs: 1000 });
    if (!x.ok) throw new Error('expected a file');
    expect(x.rows).toBe(500);
    expect(summarizeUspto(r)).toContain('First 500 attached');
  });

  it('does not treat cap truncation as complete', async () => {
    const r = await run((c) => (c.query === LEGACY_T1 ? { body: body(1, [source('1')]) } : pagedHits('s', 50000, 50000, c)), { limit: 100000 });
    expect(r.truncated).toBe(true);
    // Sprint 4 carry-over: the written count, never the limit.
    expect(summarizeUspto(r)).toContain(`First ${r.written} attached`);
    expect(summarizeUspto(r)).not.toContain('First 100000');
    expect(summarizeUspto(r)).toContain('more exist');
  });
});

describe('summarizeUspto wording (Sprint 4 carry-over)', () => {
  const oneTier = { stem: '' };

  it('written count, not limit', async () => {
    const r = await run((c) => pagedHits('a', 500, 500, c), oneTier);
    expect(r.written).toBe(500);
    const text = summarizeUspto(r);
    expect(text).toContain('First 500 attached.');
    expect(text).not.toContain('more exist');
  });

  it('more exist only when it is true', async () => {
    const more = summarizeUspto(await run((c) => pagedHits('a', 800, 800, c), oneTier));
    expect(more).toMatch(/First 500 attached .*more exist/);
    const exact = summarizeUspto(await run((c) => pagedHits('a', 500, 500, c), oneTier));
    expect(exact).not.toContain('more exist');
    // A complete list never claims more, even when tier 2 overlaps tier 1.
    const complete = summarizeUspto(await run());
    expect(complete).not.toContain('more exist');
  });

  it('paging cap with a large limit', async () => {
    const r = await run((c) => pagedHits('a', 50000, 50000, c), { ...oneTier, limit: 20000 });
    expect(r.written).toBe(9500);
    const text = summarizeUspto(r);
    expect(text).toMatch(/First 9500 attached .*more exist/);
    expect(text).not.toContain('First 20000');
  });

  it('showing first N of T whenever shown < total', async () => {
    // Tier-1 total says 2 but only one row came back: shown 1 < total 2.
    const r = await run((c) => (c.query === LEGACY_T1 ? { body: body(2, [source('1')]) } : { body: body(0, []) }));
    const text = summarizeUspto(r);
    expect(text).toContain('showing first 1 of 2');
  });

  it('heading format', async () => {
    const text = summarizeUspto(await run());
    expect(text).toContain('Near-identical hits (2):');
    expect(text).not.toMatch(/:\s*\d*\s*:/);
    expect(text).not.toContain('showing first');
  });
});
