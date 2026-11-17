import { fetchWithTimeout } from "@/lib/http/timeout";
import { parseTsdrStatus, type TsdrStatus } from "./parse";

/** TSDR host and path (README.md: from USPTO's published Swagger; the `.json` suffix is UNVERIFIED). */
export const TSDR_BASE = "https://tsdrapi.uspto.gov/ts/cd/casestatus";
export const TSDR_TIMEOUT_MS = 15_000;

export const SERIAL_PATTERN = /^\d{8}$/;

export type UnavailableReason =
  | "timeout"
  | "shape"
  | "rate_limited"
  | "not_found"
  | "network"
  | "bad_serial"
  | `http_${number}`;

export type FetchStatusResult =
  | { status: "ok"; result: TsdrStatus }
  | { status: "not-set-up" }
  | { status: "unavailable"; reason: UnavailableReason };

export type FetchStatusDeps = {
  /** Injected in tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Pass `null` for "no key". Omitted = read the deployment key through config.ts. */
  apiKey?: string | null;
  timeoutMs?: number;
};

function unavailable(reason: UnavailableReason): FetchStatusResult {
  return { status: "unavailable", reason };
}

/**
 * Read one application's status by serial number.
 *
 * Decision on 404: it is `unavailable` with reason `not_found`, never "ok". USPTO documents 404 as "Trademark
 * for the case ID does not exist", but 404 was also observed from the gateway for an INVALID key (an absent key
 * gives 401), so it cannot be trusted to mean the serial is wrong. Callers must treat it as "couldn't confirm".
 * A 204 ("not registered") is likewise `http_204`.
 *
 * Every failure is a fixed code. Nothing here logs, and the key and the response body never appear in a result.
 * No result of an unavailable read is ever "no change".
 */
export async function fetchTsdrStatus(serial: string, deps: FetchStatusDeps = {}): Promise<FetchStatusResult> {
  if (typeof serial !== "string" || !SERIAL_PATTERN.test(serial)) return unavailable("bad_serial");

  let key: string | null;
  if (deps.apiKey !== undefined) {
    key = deps.apiKey === null || deps.apiKey.trim() === "" ? null : deps.apiKey.trim();
  } else {
    const { tsdrApiKey } = await import("./config");
    key = tsdrApiKey();
  }
  if (key === null) return { status: "not-set-up" };

  const doFetch = fetchWithTimeout(deps.fetchImpl ?? fetch, deps.timeoutMs ?? TSDR_TIMEOUT_MS);
  let res: Response;
  try {
    res = await doFetch(`${TSDR_BASE}/sn${serial}/info.json`, {
      method: "GET",
      headers: { "USPTO-API-KEY": key, Accept: "application/json" },
      cache: "no-store",
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return unavailable(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
  }

  if (res.status === 404) return unavailable("not_found");
  if (res.status === 429) return unavailable("rate_limited");
  if (res.status !== 200) return unavailable(`http_${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    return unavailable(name === "TimeoutError" || name === "AbortError" ? "timeout" : "shape");
  }
  const parsed = parseTsdrStatus(body, serial);
  if (!parsed.ok) return unavailable("shape");
  return { status: "ok", result: parsed.value };
}
