/**
 * Adobe's answers mapped to OUR fixed codes (Sprint 5a, contract item 9). PURE.
 *
 * Raw Adobe text (an error body's `message`, an HTML error page, a header) is never shown, logged or stored: this file reads
 * only the HTTP status and Adobe's own machine `code`, and turns them into one of a closed set. What ends up in
 * `client_proposal_esign_request.last_error` is one of `LAST_ERROR_CODES` (lectual 0113 CHECKs the same list). A cancel Adobe
 * refuses is the `cancel_failed` flag, never a `last_error` value.
 */

export const LAST_ERROR_CODES = [
  "adobe_unavailable",
  "adobe_rate_limited",
  "adobe_timeout",
  "adobe_refused",
  "creation_interrupted",
  "webhook_not_registered",
  "esign_proposal_changed",
  "signed_after_close",
] as const;

export type LastErrorCode = (typeof LAST_ERROR_CODES)[number];

export function isLastErrorCode(value: unknown): value is LastErrorCode {
  return typeof value === "string" && (LAST_ERROR_CODES as readonly string[]).includes(value);
}

/** What went wrong with one call, as this app understands it. */
export type AdobeFailure = "adobe_unavailable" | "adobe_rate_limited" | "adobe_timeout" | "adobe_refused";

/**
 * A call Adobe answered with something we can't use. `reauth` is true only when the FIRM's grant was refused (401, or a token
 * code), which pauses the firm (`reauth`); a refusal about one agreement never does. `notReady` marks the documented 404 from
 * `signingUrls` just after an agreement is created, which is retried.
 */
export class AdobeCallError extends Error {
  constructor(
    readonly failure: AdobeFailure,
    readonly status: number | null,
    readonly reauth: boolean,
    readonly notReady: boolean = false,
    readonly retryAfterSeconds: number | null = null,
  ) {
    // The message is a fixed code, never Adobe's words.
    super(`adobe_call_failed:${failure}`);
    this.name = "AdobeCallError";
  }
}

/** Adobe codes that mean the firm's access token or grant is no longer good. */
const REAUTH_CODES = new Set(["INVALID_ACCESS_TOKEN", "EXPIRED_ACCESS_TOKEN", "NO_AUTHORIZATION_HEADER", "INVALID_USER", "USER_NOT_AUTHORIZED"]);
/** `signingUrls` just after creation: Adobe is still processing the document. Retried, never an error on its own. */
const NOT_READY_CODES = new Set(["AGREEMENT_NOT_EXPOSED", "DOCUMENTS_NOT_YET_PROCESSED"]);

/** Reads ONLY Adobe's `code` field, and only when it looks like one of its upper-case codes. Never the message. */
export function adobeCodeOf(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const code = (body as Record<string, unknown>).code;
  return typeof code === "string" && /^[A-Z][A-Z0-9_]{1,80}$/.test(code) ? code : null;
}

function retryAfter(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 3600) : null;
}

/** A non-2xx answer as an `AdobeCallError`. */
export function errorForResponse(status: number, adobeCode: string | null, retryAfterHeader?: string | null): AdobeCallError {
  if (status === 401 || (adobeCode !== null && REAUTH_CODES.has(adobeCode))) return new AdobeCallError("adobe_refused", status, true);
  if (status === 429) return new AdobeCallError("adobe_rate_limited", status, false, false, retryAfter(retryAfterHeader));
  if (status === 404 && adobeCode !== null && NOT_READY_CODES.has(adobeCode)) return new AdobeCallError("adobe_unavailable", status, false, true);
  if (status >= 500) return new AdobeCallError("adobe_unavailable", status, false);
  return new AdobeCallError("adobe_refused", status, false);
}

/** A call that never got an answer: a deadline (`AbortError` / `TimeoutError`) or the network. */
export function errorForThrown(err: unknown): AdobeCallError {
  if (err instanceof AdobeCallError) return err;
  const name = err && typeof err === "object" ? (err as { name?: unknown }).name : null;
  if (name === "AbortError" || name === "TimeoutError") return new AdobeCallError("adobe_timeout", null, false);
  return new AdobeCallError("adobe_unavailable", null, false);
}

/** The `last_error` code a failed creation step is recorded with. */
export function lastErrorFor(err: unknown): LastErrorCode {
  return errorForThrown(err).failure;
}
