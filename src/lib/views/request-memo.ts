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

/**
 * Forget this request's memo. A server action and the page it re-renders run in ONE request (same headers object), so
 * the write block calls this after an action's body: a `refresh()` / revalidate re-render then reads the session and the
 * preview state again, never the values read before the action changed them. The memo is keyed on the request itself, so
 * nothing ever carries from one request (or person) to another.
 */
export async function forgetRequestMemo(): Promise<void> {
  try {
    const owner = (await headers()) as unknown as object;
    if (owner && typeof owner === "object") memo.delete(owner);
  } catch {
    // outside a request: nothing was memoized
  }
}
