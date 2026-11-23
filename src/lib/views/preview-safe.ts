import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { previewFlag } from "@/lib/views/view-as-flag";
import { noticeBackPath, refusesWrites } from "@/lib/views/view-as-rules";
import { VIEW_AS_READ_ONLY } from "@/lib/ui/words";

/**
 * Layer a of View as's write block (spec "The write block"): EVERY exported server action is `previewSafe(...)`, and every
 * mutating route handler is `previewSafeRoute(...)`. While the owner is previewing a teammate (or the preview state
 * couldn't be checked), the wrapper returns BEFORE the body runs, with VIEW_AS_READ_ONLY in the action's own result shape;
 * outside a preview it calls the body unchanged. It reads only the preview FLAG (view-as-flag.ts), never the viewer.
 * tests/views/view-as-actions-guarded.test.ts fails CI on an action or handler that isn't wrapped.
 *
 * The refusal is chosen per action, and TypeScript checks it fits the action's result:
 *   "state"     `{ ok: false, error }`, for actions whose result carries `error` (ActionForm states, `{ ok, error }` results)
 *   "redirect"  back to the page it came from with `?notice=preview`, for actions that return nothing
 *   a function  for any other result shape
 */
export type ReadOnlyState = { ok: false; error: string };
type Refusal<R> = ([ReadOnlyState] extends [R] ? "state" : never) | ((message: string) => R);

export function previewSafe<A extends unknown[]>(fn: (...args: A) => Promise<void>, refusal: "redirect"): (...args: A) => Promise<void>;
export function previewSafe<A extends unknown[], R>(fn: (...args: A) => Promise<R>, refusal: Refusal<NoInfer<R>>): (...args: A) => Promise<R>;
export function previewSafe<A extends unknown[], R>(fn: (...args: A) => Promise<R>, refusal: Refusal<R> | "redirect"): (...args: A) => Promise<R> {
  return keepShape(fn, async (...args: A): Promise<R> => {
    if (refusesWrites(await previewFlag())) return refuse(refusal);
    return fn(...args);
  });
}

/** The wrapper keeps the action's name and arity, so nothing that inspects it can tell it was wrapped. */
function keepShape<F extends (...args: never[]) => unknown>(fn: (...args: never[]) => unknown, wrapper: F): F {
  Object.defineProperty(wrapper, "name", { value: fn.name, configurable: true });
  Object.defineProperty(wrapper, "length", { value: fn.length, configurable: true });
  return wrapper;
}

async function refuse<R>(refusal: Refusal<R> | "redirect"): Promise<R> {
  if (typeof refusal === "function") return refusal(VIEW_AS_READ_ONLY);
  if (refusal === "redirect") {
    let referer: string | null = null;
    let origin: string | null = null;
    try {
      const h = await headers();
      referer = h.get("referer");
      const host = h.get("host");
      const proto = h.get("x-forwarded-proto") ?? "https";
      origin = host ? `${proto}://${host}` : null;
    } catch {
      // no request: the default path
    }
    redirect(noticeBackPath(referer, origin));
  }
  const state: ReadOnlyState = { ok: false, error: VIEW_AS_READ_ONLY };
  return state as unknown as R;
}

/**
 * The named read-only allowlist (spec Layer a). The body runs in a preview too. Only for actions that write NOTHING: no
 * database write, no queue or provider call, no token refresh (searches, pickers, previews, downloads). Each use names its
 * reason, and tests/views/view-as-read-only-allowlist.test.ts lists and checks every one. Its writes, if it ever made any,
 * would still meet the database net (Layer b).
 */
export function previewReadOnly<A extends unknown[], R>(fn: (...args: A) => Promise<R>, reason: string): (...args: A) => Promise<R> {
  void reason;
  return fn;
}

/** A mutating route handler: 409 with the sentence while previewing. */
export function previewSafeRoute<A extends unknown[]>(handler: (...args: A) => Promise<Response> | Response): (...args: A) => Promise<Response> {
  return keepShape(handler as (...args: never[]) => unknown, async (...args: A): Promise<Response> => {
    if (refusesWrites(await previewFlag())) {
      return new Response(JSON.stringify({ error: VIEW_AS_READ_ONLY }), {
        status: 409,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
      });
    }
    return handler(...args);
  });
}
