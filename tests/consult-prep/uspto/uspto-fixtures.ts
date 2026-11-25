// Mock-only fixtures for the USPTO tests. The fake fetch records every call
// and serves canned bodies in the script's response shape:
// { hits: { totalValue, hits: [{ source: { id, wordmark, ... } }] } }.

import { vi } from 'vitest';

type Obj = Record<string, unknown>;

export interface RecordedCall {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: { query: { bool: { must: Array<{ query_string: { query: string; default_operator: string } }> } }; size: number; from: number; track_total_hits: boolean };
  query: string;
  from: number;
}

export type Reply = { status?: number; body?: unknown; text?: string } | Error | 'stall-body';

export const LEGACY_T1 = 'wordmark:(legacycon OR legacycon* OR "legacy con" OR "legacy conference")';
export const LEGACY_T2 = 'wordmark:legacy* AND alive:true AND (internationalClass:"IC 041" OR internationalClass:"IC 035")';

export function source(id: string, over: Obj = {}): Obj {
  return {
    id,
    wordmark: `MARK ${id}`,
    alive: true,
    internationalClass: ['041'],
    registrationId: `R${id}`,
    filedDate: '2021-03-04T00:00:00.000Z',
    registrationDate: '2022-05-06T00:00:00.000Z',
    currentBasis: ['1A'],
    ownerName: [`Owner ${id} LLC`],
    goodsAndServices: [`Services for ${id}`],
    ...over,
  };
}

export function body(total: number, sources: Obj[]): Obj {
  return { hits: { totalValue: total, hits: sources.map((s) => ({ source: s })) } };
}

/** The LegacyCon fixture: 2 near-identical hits, 3 live stem hits (one shared with tier 1). */
export function legacyConResponder(call: RecordedCall): Reply {
  if (call.query === LEGACY_T1) {
    return {
      body: body(2, [
        source('90000001', { wordmark: 'LEGACYCON', internationalClass: ['041', '035'], ownerName: ['Legacy Events, Inc.'] }),
        source('90000002', { wordmark: 'LEGACY CON', alive: false, internationalClass: ['041'], ownerName: ['Old Owner Co'] }),
      ]),
    };
  }
  return {
    body: body(3, [
      source('90000001', { wordmark: 'LEGACYCON' }),
      source('90000003', { wordmark: 'LEGACY SUMMIT', ownerName: ['A, B & "C" Holdings'], goodsAndServices: ['Conferences,\nseminars', 'Trade shows'] }),
      source('90000004', { wordmark: 'LEGACY LABS', internationalClass: ['035'] }),
    ]),
  };
}

export function fakeFetch(responder: (call: RecordedCall) => Reply) {
  const calls: RecordedCall[] = [];
  const fn = vi.fn(async (url: unknown, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body));
    const call: RecordedCall = {
      url: String(url),
      method: init?.method,
      headers: init?.headers as Record<string, string>,
      body: parsed,
      query: parsed.query.bool.must[0].query_string.query,
      from: parsed.from,
    };
    calls.push(call);
    const reply = responder(call);
    if (reply instanceof Error) throw reply;
    if (reply === 'stall-body') {
      return {
        ok: true,
        status: 200,
        json: () =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      } as unknown as Response;
    }
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (reply.text !== undefined) return JSON.parse(reply.text);
        return reply.body;
      },
    } as unknown as Response;
  });
  return { fetch: fn as unknown as typeof fetch, calls, spy: fn };
}

/** A fetch that never answers but honours the abort signal, like a real hung socket. */
export function hangingFetch(): typeof fetch {
  return ((_url: unknown, init?: RequestInit) =>
    new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
}

/** A tier responder serving `n` distinct serials (prefix + index), paged by `from`. */
export function pagedHits(prefix: string, n: number, total: number, call: RecordedCall, size = 500): Reply {
  const sources: Obj[] = [];
  for (let i = call.from; i < Math.min(n, call.from + size); i++) sources.push(source(`${prefix}${i}`));
  return { body: body(total, sources) };
}
