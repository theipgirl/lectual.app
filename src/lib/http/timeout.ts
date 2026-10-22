/**
 * Every outbound call an agent makes gets a deadline. A fetch with no signal waits for as long as the
 * other end keeps the socket open, and one of those inside a 300-second function is how a run is left
 * "running" forever when the platform kills the function.
 *
 * Pure apart from the timer: `withTimeout` adds `AbortSignal.timeout(ms)` to a RequestInit, merged with
 * any signal the caller already passed (the run's own abort signal, say), so whichever fires first wins.
 */

/** Graph, Gmail, the OAuth token endpoints: one request, one page. */
export const PROVIDER_FETCH_TIMEOUT_MS = 30_000;
/** The approval-queue API (lawmatics-mcp). */
export const QUEUE_API_TIMEOUT_MS = 20_000;
/** One database statement through the agents' service-role client. */
export const DB_FETCH_TIMEOUT_MS = 30_000;

export function withTimeout(init: RequestInit | undefined, ms: number): RequestInit {
  const timeout = AbortSignal.timeout(ms);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return { ...init, signal };
}

/** `fetchImpl` with a deadline on every call. */
export function fetchWithTimeout(fetchImpl: typeof fetch, ms: number): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => fetchImpl(input, withTimeout(init, ms))) as typeof fetch;
}
