import "server-only";
import { headers } from "next/headers";

/**
 * Per-request memo that also works in server actions and route handlers. React `cache` memoizes only inside a render
 * (it needs React's request dispatcher, which actions and route handlers don't run under: spec risk R2), so the memo is
 * keyed on the request's own headers object instead: `headers()` returns the same object for the whole request in a
 * page, an action and a route handler. Outside a request (a script, a test with no request) nothing is memoized and `fn`
 * simply runs.
 */
const memo = new WeakMap<object, Map<string, Promise<unknown>>>();

export async function perRequest<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let owner: object | null = null;
  try {
    owner = (await headers()) as unknown as object;
  } catch {
    owner = null;
  }
  if (!owner || typeof owner !== "object") return fn();
  let map = memo.get(owner);
  if (!map) {
    map = new Map();
    memo.set(owner, map);
  }
  const hit = map.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const p = fn();
  map.set(key, p);
  // A failure is not kept: the next caller in the same request reads again.
  p.catch(() => {
    if (map!.get(key) === p) map!.delete(key);
  });
  return p;
}
