import { describe, expect, it } from 'vitest';
import { buildSiteQuery, searchUsptoSite, SITE_SOURCE_FIELDS, type UsptoSiteOk } from '@/lib/consult-prep/uspto/uspto';

type Obj = Record<string, unknown>;
const src = (id: string) => ({ id, wordmark: `M${id}`, alive: true });
const pageBody = (total: number, ids: string[]) => ({ hits: { totalValue: total, hits: ids.map((id) => ({ source: src(id) })) } });

function fake(responder: (body: Obj, n: number) => Response | Error) {
  const calls: Obj[] = [];
  const fn = (async (_u: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Obj;
    calls.push(body);
    const r = responder(body, calls.length - 1);
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => String(1000 + from + i));
const ok = (r: unknown) => r as UsptoSiteOk;

describe('searchUsptoSite', () => {
  it('posts the site\'s exact basic-search body (no aggs, no highlight)', async () => {
    const f = fake(() => json(pageBody(1, ['1'])));
    await searchUsptoSite({ term: 'lumora', fetch: f.fetch });
    expect(f.calls[0]).toEqual({
      query: {
        bool: {
          must: [
            {
              bool: {
                should: [
                  { match_phrase: { WM: { query: 'lumora', boost: 5 } } },
                  { match: { WM: { query: 'lumora', boost: 2 } } },
                  { match_phrase: { PM: { query: 'lumora', boost: 2 } } },
                ],
              },
            },
          ],
        },
      },
      size: 100,
      from: 0,
      track_total_hits: true,
      _source: [...SITE_SOURCE_FIELDS],
    });
    expect(f.calls[0]).not.toHaveProperty('aggs');
    expect(f.calls[0]).not.toHaveProperty('highlight');
    expect(buildSiteQuery('x', 200).from).toBe(200);
  });

  it('cleans the term like the knockout and skips an empty one', async () => {
    const f = fake(() => json(pageBody(1, ['1'])));
    await searchUsptoSite({ term: ' "Lum\\ora" ', fetch: f.fetch });
    expect(JSON.stringify(f.calls[0])).toContain('"query":"Lumora"');
    expect(await searchUsptoSite({ term: ' "" ', fetch: f.fetch })).toEqual({ status: 'skipped', reason: 'no mark' });
    expect(f.calls).toHaveLength(1);
  });

  it('pages by 100, keeps the service order, and stops at 500 with truncated', async () => {
    const f = fake((b) => json(pageBody(900, ids(b.from as number, 100))));
    const r = ok(await searchUsptoSite({ term: 'a', fetch: f.fetch }));
    expect(f.calls.map((c) => c.from)).toEqual([0, 100, 200, 300, 400]);
    expect(r.written).toBe(500);
    expect(r.rows.map((x) => x.serial)).toEqual(ids(0, 500));
    expect(r).toMatchObject({ total: 900, truncated: true, pageFailed: false });
  });

  it('is complete (not truncated) when everything fits', async () => {
    const f = fake((b) => json(pageBody(150, ids(b.from as number, (b.from as number) === 0 ? 100 : 50))));
    const r = ok(await searchUsptoSite({ term: 'a', fetch: f.fetch }));
    expect(f.calls).toHaveLength(2);
    expect(r).toMatchObject({ written: 150, total: 150, truncated: false });
  });

  it('is truncated when the service total is above what came back', async () => {
    const f = fake(() => json(pageBody(40, ids(0, 28))));
    const r = ok(await searchUsptoSite({ term: 'a', fetch: f.fetch }));
    expect(r).toMatchObject({ written: 28, total: 40, truncated: true, pageFailed: false });
  });

  it('keeps the pages that arrived and says so when a later page fails', async () => {
    const f = fake((b) => (b.from === 0 ? json(pageBody(450, ids(0, 100))) : json({}, 503)));
    const r = ok(await searchUsptoSite({ term: 'a', fetch: f.fetch }));
    expect(r).toMatchObject({ status: 'ok', written: 100, total: 450, truncated: true, pageFailed: true });
    const g = fake((b) => (b.from === 0 ? json(pageBody(150, ids(0, 100))) : new Error('boom')));
    expect(ok(await searchUsptoSite({ term: 'a', fetch: g.fetch }))).toMatchObject({ truncated: true, pageFailed: true });
  });

  it('is unavailable (no rows) when the first page fails or is malformed', async () => {
    expect(await searchUsptoSite({ term: 'a', fetch: fake(() => json({}, 500)).fetch })).toEqual({ status: 'unavailable', reason: 'USPTO search returned HTTP 500' });
    expect(await searchUsptoSite({ term: 'a', fetch: fake(() => json({ nope: 1 })).fetch })).toMatchObject({ status: 'unavailable' });
    expect(await searchUsptoSite({ term: 'a', fetch: fake(() => new Error('x')).fetch })).toMatchObject({ status: 'unavailable' });
  });

  it('treats a spent deadline as unavailable first, truncated later', async () => {
    let now = 0;
    const f = fake(() => json(pageBody(300, ids(0, 100))));
    const first = await searchUsptoSite({ term: 'a', fetch: f.fetch, deadline: 0, clock: () => now });
    expect(first).toEqual({ status: 'unavailable', reason: 'USPTO search ran out of time' });
    const g = fake(() => { now = 10; return json(pageBody(300, ids(0, 100))); });
    now = 0;
    expect(ok(await searchUsptoSite({ term: 'a', fetch: g.fetch, deadline: 5, clock: () => now }))).toMatchObject({ written: 100, truncated: true, pageFailed: true });
  });
});
