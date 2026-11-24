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
  /** Response headers when the fetch exposes them (the real fetch does); read only for `Retry-After`. */
  headers?: { get(name: string): string | null };
}>;

/** Every request gets this deadline unless the caller asks for another (daily sync contract: 20 s). */
export const LAWMATICS_REQUEST_TIMEOUT_MS = 20_000;
/** A 429 is retried at most this many times per request. */
export const RATE_LIMIT_RETRIES = 2;
/** `Retry-After` is honoured up to this long; past it the wait is capped here. */
export const RETRY_AFTER_CAP_MS = 10_000;
/** The waits used when a 429 carries no usable `Retry-After`: first retry, second retry. */
export const RATE_LIMIT_FALLBACK_MS = [2_000, 5_000] as const;

export type LawmaticsClientOptions = {
  token: string;
  /** Override for tests. Defaults to the live v1 base URL. */
  baseUrl?: string;
  /** Override for tests. Defaults to global `fetch`. */
  fetchImpl?: FetchLike;
  /** Per-request deadline. Defaults to `LAWMATICS_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** The caller's own abort signal (a step's budget). Merged with the per-request deadline; whichever fires first wins. */
  signal?: AbortSignal;
  /**
   * How long the caller still has. A 429 is retried only when the wait fits inside it; absent, a retry is
   * always allowed (still at most `RATE_LIMIT_RETRIES`).
   */
  timeLeftMs?: () => number;
  /** Override for tests. Defaults to a timer that the caller's signal cancels. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
};

/** The wait before retry number `attempt` (0-based) after a 429: `Retry-After` (seconds or a date), capped, else the fallback. */
export function retryWaitMs(retryAfter: string | null | undefined, attempt: number, nowMs: number = Date.now()): number {
  const fallback = RATE_LIMIT_FALLBACK_MS[Math.min(attempt, RATE_LIMIT_FALLBACK_MS.length - 1)];
  const raw = (retryAfter ?? "").trim();
  if (!raw) return fallback;
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.min(Math.max(0, Math.round(Number(raw) * 1000)), RETRY_AFTER_CAP_MS);
  const at = Date.parse(raw);
  if (Number.isFinite(at)) return Math.min(Math.max(0, at - nowMs), RETRY_AFTER_CAP_MS);
  return fallback;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The status class of a failed Lawmatics call, for counts. Never the message: `LawmaticsApiError.message`
 * carries up to 500 characters of the response body and must never be logged, returned or stored.
 */
export type LawmaticsFailureClass = "auth" | "forbidden" | "rate" | "server" | "timeout" | "shape";

/**
 * `auth` (the firm's key is refused: the connection is marked invalid) is a 401 anywhere, or a 403 on the `/prospects` list
 * every step needs. A 403 on any other endpoint is `forbidden`: that one step fails, the key is not judged by it.
 */
export function lawmaticsFailureClass(err: unknown): LawmaticsFailureClass {
  if (err instanceof LawmaticsApiError) {
    if (err.status === 401 || (err.status === 403 && err.path === "/prospects")) return "auth";
    if (err.status === 403) return "forbidden";
    if (err.status === 429) return "rate";
    if (err.status >= 500) return "server";
    return "shape";
  }
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  return "server";
}

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
  /**
   * True when a 2xx page was neither an array nor an object with an array `data`. `records()` reads such a
   * payload as no records, which is indistinguishable from an empty list; callers that must not treat it
   * as "nothing there" check this.
   */
  unrecognisedShape?: boolean;
};

function isListShaped(payload: unknown): boolean {
  if (Array.isArray(payload)) return true;
  return typeof payload === "object" && payload !== null && Array.isArray((payload as { data?: unknown }).data);
}

export function createLawmaticsClient(opts: LawmaticsClientOptions): LawmaticsClient {
  const base = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const doFetch: FetchLike = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  if (!opts.token) throw new Error("Lawmatics token is required");
  const timeoutMs = typeof opts.timeoutMs === "number" && opts.timeoutMs > 0 ? opts.timeoutMs : LAWMATICS_REQUEST_TIMEOUT_MS;
  const sleep = opts.sleep ?? defaultSleep;

  async function get(path: string, params?: Record<string, string>): Promise<unknown> {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

    for (let attempt = 0; ; attempt += 1) {
      // A fresh deadline per request (a retry is a new request), merged with the caller's own signal.
      const deadline = AbortSignal.timeout(timeoutMs);
      const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
      const res = await doFetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${opts.token}`,
          Accept: "application/json",
        },
        signal,
      });
      if (res.ok) return res.json();
      if (res.status === 429 && attempt < RATE_LIMIT_RETRIES) {
        const wait = retryWaitMs(res.headers?.get("retry-after"), attempt);
        // Only when the wait still fits the caller's budget; otherwise the read has failed (counted as `rate`).
        if (!opts.timeLeftMs || wait < opts.timeLeftMs()) {
          await res.text().catch(() => "");
          await sleep(wait, opts.signal);
          continue;
        }
      }
      const body = await res.text().catch(() => "");
      throw new LawmaticsApiError(res.status, path, body.slice(0, 500) || res.statusText);
    }
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
    let unrecognisedShape = false;
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
      if (!isListShaped(payload)) unrecognisedShape = true;

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
      unrecognisedShape,
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
