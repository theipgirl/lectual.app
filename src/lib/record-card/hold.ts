import { NO_SHOW_HOLD_MS } from "./rules";

/**
 * The 5-second hold behind "Mark no-show" (the approval deck's rule): NOTHING is posted while it runs; Undo inside it
 * posts nothing; when it ends, `post` runs ONCE. After that there is no undo. PURE: the timer functions are injected so a
 * test can drive it without waiting.
 */
export type Hold = { cancel: () => boolean; readonly settled: () => "held" | "posted" | "cancelled" };

export function startHold(
  post: () => void,
  opts: { ms?: number; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (id: unknown) => void } = {},
): Hold {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let state: "held" | "posted" | "cancelled" = "held";
  const id = setTimer(() => {
    if (state !== "held") return;
    state = "posted";
    post();
  }, opts.ms ?? NO_SHOW_HOLD_MS);
  return {
    cancel() {
      if (state !== "held") return false;
      state = "cancelled";
      clearTimer(id);
      return true;
    },
    settled: () => state,
  };
}
