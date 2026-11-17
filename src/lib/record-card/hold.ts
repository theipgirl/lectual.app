import { NO_SHOW_HOLD_MS } from "./rules";

/**
 * The 5-second hold behind "Mark no-show" (the approval deck's rule): NOTHING is posted while it runs; Undo inside it
 * posts nothing; when it ends, `post` runs ONCE. After that there is no undo. PURE: the timer functions are injected so a
 * test can drive it without waiting.
 *
 * `pause` stops the countdown (the person is typing the optional note, so the post must not fire mid-word); `resume`
 * starts a FULL hold again from that moment. Neither does anything once the hold has posted or been cancelled.
 */
export type Hold = {
  cancel: () => boolean;
  pause: () => boolean;
  resume: () => boolean;
  readonly paused: () => boolean;
  readonly settled: () => "held" | "posted" | "cancelled";
};

export function startHold(
  post: () => void,
  opts: { ms?: number; setTimer?: (fn: () => void, ms: number) => unknown; clearTimer?: (id: unknown) => void } = {},
): Hold {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const ms = opts.ms ?? NO_SHOW_HOLD_MS;
  let state: "held" | "posted" | "cancelled" = "held";
  let paused = false;
  const fire = () => {
    if (state !== "held" || paused) return;
    state = "posted";
    post();
  };
  let id: unknown = setTimer(fire, ms);
  return {
    cancel() {
      if (state !== "held") return false;
      state = "cancelled";
      if (!paused) clearTimer(id);
      return true;
    },
    pause() {
      if (state !== "held" || paused) return false;
      paused = true;
      clearTimer(id);
      return true;
    },
    resume() {
      if (state !== "held" || !paused) return false;
      paused = false;
      id = setTimer(fire, ms);
      return true;
    },
    paused: () => paused,
    settled: () => state,
  };
}

/**
 * Starts a hold only when none is running: a second "Mark no-show" while one is held is ignored (it would otherwise replace the
 * first, leaving its timer to post a second `call_logged` row). Returns the hold to keep.
 */
export function beginOnce(current: Hold | null, post: () => void, opts: Parameters<typeof startHold>[1] = {}): Hold {
  return current && current.settled() === "held" ? current : startHold(post, opts);
}

/**
 * Whether "Mark no-show" may be offered (and a begin accepted). Not while a hold runs, not while its post is in flight or
 * after it saved (a second click would write a second `call_logged` row). After a refusal the person may try again: nothing
 * was written.
 */
export function noShowOffered(s: { held: boolean; posted: boolean; failed: boolean }): boolean {
  if (s.held) return false;
  if (s.posted && !s.failed) return false;
  return true;
}
