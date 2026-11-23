/** The one-shot result params an OAuth return puts on the Integrations URL. */
export const RESULT_PARAMS = ["connected", "reconnected", "error"] as const;

/**
 * The URL to show once the result banner has been painted: the same path and query without the one-shot
 * params. `null` when there is nothing to remove (so nothing is rewritten).
 */
export function urlWithoutResultParams(pathname: string, search: string): string | null {
  const params = new URLSearchParams(search);
  if (!RESULT_PARAMS.some((p) => params.has(p))) return null;
  for (const p of RESULT_PARAMS) params.delete(p);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}
