import "server-only";

import { includedIndex, metaTotalPages, records, type Raw } from "./jsonapi";

/**
 * Typed read-only client for the Lawmatics REST API.
 *
 * READ-ONLY BY CONSTRUCTION. This module exposes `get` and nothing else — no
 * post/patch/delete. The importer is one-way (Lawmatics → Lectual) and must not
 * be able to mutate a firm's CRM even by accident.
 *
 * Two facts from the verified live probe (lawmatics-mcp/CLAUDE.md) drive the
 * whole design:
 *
 *  1. Matters live at `/prospects`. There is NO `/matters` endpoint — it 404s
 *     with "This resource path does not exist". Lawmatics calls the record a
 *     *prospect*; their UI labels it a Matter.
 *  2. List responses are JSON:API shaped and FLAT `page` / `per_page` PARAMS
 *     ARE IGNORED — a probe asking for `per_page=1` still got 25 records back.
 *     Pagination must use the bracket form `page[number]` / `page[size]`.
 *
 * Because (2) was discovered by a server silently ignoring a param, the pager
 * below never assumes its parameters were honoured: it stops if a page repeats
 * ids it has already seen, and it hard-caps both pages and records. A server
 * that ignores `page[number]` yields one page of data and a `truncated`
 * warning — never an infinite loop.
 */

const DEFAULT_BASE_URL = "https://api.lawmatics.com/v1";

/** Page size requested from the API. Lawmatics' own default is 25. */
const DEFAULT_PAGE_SIZE = 50;
/** Hard ceilings so one import can never run away. Surfaced as `truncated`. */
const DEFAULT_MAX_PAGES = 60;
const DEFAULT_MAX_RECORDS = 3000;

export class LawmaticsApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(`Lawmatics API ${status} on ${path}: ${message}`);
    this.name = "LawmaticsApiError";
  }
}

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
}>;

export type LawmaticsClientOptions = {
  token: string;
  /** Override for tests. Defaults to the live v1 base URL. */
  baseUrl?: string;
  /** Override for tests. Defaults to global `fetch`. */
  fetchImpl?: FetchLike;
};

export type LawmaticsClient = {
  get(path: string, params?: Record<string, string>): Promise<unknown>;
  listAll(path: string, opts?: ListOptions): Promise<ListResult>;
};

export type ListOptions = {
  /** JSON:API `include` value, e.g. "stage,practice_area,contact". */
  include?: string;
  pageSize?: number;
  maxPages?: number;
  maxRecords?: number;
  /** Extra query params (filters). Values are sent verbatim. */
  params?: Record<string, string>;
};

export type ListResult = {
  /** Every record across every page, in server order, de-duplicated by id. */
  records: Raw[];
  /** Merged `included` sideload index across all pages ("type:id" -> record). */
  included: Map<string, Raw>;
  pagesFetched: number;
  /**
   * True when a cap stopped the pull, or the server appears to ignore
   * pagination. The import preview MUST show this — a truncated pull means the
   * "nothing else to import" conclusion is not trustworthy.
   */
  truncated: boolean;
  /** Human-readable reason for `truncated`. */
  truncatedReason?: string;
  /**
   * True when the server rejected the `include` parameter and the pull fell
   * back to fetching pages WITHOUT sideloaded relationships.
   *
   * This must be surfaced, loudly, and it is deliberately NOT folded into
   * `truncated`: the record count is complete, so nothing looks wrong, but
   * every relationship-backed field (stage, contact) comes back null. The
   * planner then honestly reports "this record has no stage" — which reads as
   * a fact about the firm's Lawmatics data when it is actually a fact about
   * our request. That misreading nearly drove a real import decision: a dry
   * run returned 450 stage-less records and the only way to tell "they have no
   * stage" from "we failed to ask for it" was to go and look in Lawmatics.
   */
  includeDropped: boolean;
  /** Which include string was rejected, and how — for the operator's banner. */
  includeDroppedReason?: string;
};

export function createLawmaticsClient(opts: LawmaticsClientOptions): LawmaticsClient {
  const base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const doFetch: FetchLike = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  if (!opts.token) throw new Error("Lawmatics token is required");

  async function get(path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

    const res = await doFetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${opts.token}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LawmaticsApiError(res.status, path, body.slice(0, 500) || res.statusText);
    }
    return res.json();
  }

  async function listAll(path: string, listOpts: ListOptions = {}): Promise<ListResult> {
    const pageSize = clampInt(listOpts.pageSize, DEFAULT_PAGE_SIZE, 1, 100);
    const maxPages = clampInt(listOpts.maxPages, DEFAULT_MAX_PAGES, 1, 500);
    const maxRecords = clampInt(listOpts.maxRecords, DEFAULT_MAX_RECORDS, 1, 50_000);

    const all: Raw[] = [];
    const seen = new Set<string>();
    const included = new Map<string, Raw>();
    let pagesFetched = 0;
    let truncated = false;
    let truncatedReason: string | undefined;
    let includeDropped = false;
    let includeDroppedReason: string | undefined;
    const noteIncludeDropped = (reason: string) => {
      // First reason wins — a later page repeating the same rejection adds
      // nothing, and the operator needs one clear sentence, not N.
      if (includeDropped) return;
      includeDropped = true;
      includeDroppedReason = reason;
    };

    for (let page = 1; page <= maxPages; page += 1) {
      const payload = await getPage(path, page, pageSize, listOpts, noteIncludeDropped);
      pagesFetched += 1;

      const pageRecords = records(payload);
      for (const [key, rec] of includedIndex(payload)) {
        if (!included.has(key)) included.set(key, rec);
      }

      let fresh = 0;
      for (const rec of pageRecords) {
        const id = typeof rec.id === "string" || typeof rec.id === "number" ? String(rec.id) : null;
        // A record with no id can't be de-duplicated or matched; keep it so the
        // planner can report it as unusable rather than dropping it silently.
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        all.push(rec);
        fresh += 1;
        if (all.length >= maxRecords) break;
      }

      if (all.length >= maxRecords) {
        truncated = true;
        truncatedReason = `Stopped at the ${maxRecords}-record safety cap.`;
        break;
      }
      // The server ignored `page[number]`: it handed back the same records
      // again. Stop rather than loop forever on page 1.
      if (pageRecords.length > 0 && fresh === 0) {
        truncated = true;
        truncatedReason =
          "The API returned the same records for the next page — it appears to ignore pagination, so this pull may be incomplete.";
        break;
      }
      if (pageRecords.length === 0) break;

      const totalPages = metaTotalPages(payload);
      if (totalPages !== null && page >= totalPages) break;
      // No meta to go on: a short page means this was the last one.
      if (totalPages === null && pageRecords.length < pageSize) break;

      if (page === maxPages) {
        truncated = true;
        truncatedReason = `Stopped at the ${maxPages}-page safety cap.`;
      }
    }

    return {
      records: all,
      included,
      pagesFetched,
      truncated,
      truncatedReason,
      includeDropped,
      includeDroppedReason,
    };
  }

  async function getPage(
    path: string,
    page: number,
    pageSize: number,
    listOpts: ListOptions,
    onIncludeDropped: (reason: string) => void,
  ): Promise<unknown> {
    const params: Record<string, string> = {
      ...(listOpts.params ?? {}),
      // Bracket form — the flat `page`/`per_page` params are ignored by
      // Lawmatics (verified by live probe). Do not "simplify" these.
      "page[number]": String(page),
      "page[size]": String(pageSize),
    };
    if (!listOpts.include) return get(path, params);

    try {
      return await get(path, { ...params, include: listOpts.include });
    } catch (err) {
      // A server that rejects an unknown include path answers 400/422. Retry
      // without it so the pull still returns the fields we can read; the
      // relationship-backed ones (stage, contact) then come back null and the
      // planner reports them as unmapped instead of inventing values. Any other
      // failure (5xx, auth, network) propagates — a real outage must surface.
      const status = err instanceof LawmaticsApiError ? err.status : 0;
      if (status !== 400 && status !== 422) throw err;
      onIncludeDropped(
        `Lawmatics rejected \`include=${listOpts.include}\` with HTTP ${status}, so records were fetched without their related stage / contact records.`,
      );
      return get(path, params);
    }
  }

  return { get, listAll };
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}
