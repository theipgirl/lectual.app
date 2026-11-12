import { DEFAULT_DEAL_TIMES, dealLabel } from "@/lib/deal/times";
import { DEAL_TIMES_APART, DEAL_TIMES_INVALID, DEAL_TIMES_STEP } from "@/lib/ui/words";

/**
 * A person's own two deal times: `user_metadata.lectual_deal_times = { v: 1, times: ["HH:MM", "HH:MM"] }` on their own
 * account, in the firm's time zone. Pure. It decides only WHEN the deck is dealt to that person, never who may approve
 * anything. A missing, malformed or other-version value reads as the defaults (`DEFAULT_DEAL_TIMES`).
 */
export const DEAL_TIMES_KEY = "lectual_deal_times";
export const DEAL_TIMES_VERSION = 1;
export const DEAL_STEP_MINUTES = 5;
export const DEAL_MIN_GAP_MINUTES = 120;
export const SHOW_DEAL_TIMES_EVENT = "lectual:show-deal-times";

const STRICT_HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type DealTimesPair = [string, string];
export type DealTimesCheck = { ok: true; times: DealTimesPair } | { ok: false; error: string };

const minutesOf = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** Two valid, sorted, step-aligned, far-enough-apart times, or the reason not. */
export function validateDealTimes(a: unknown, b: unknown): DealTimesCheck {
  if (typeof a !== "string" || typeof b !== "string" || !STRICT_HHMM.test(a) || !STRICT_HHMM.test(b)) return { ok: false, error: DEAL_TIMES_INVALID };
  if (minutesOf(a) % DEAL_STEP_MINUTES !== 0 || minutesOf(b) % DEAL_STEP_MINUTES !== 0) return { ok: false, error: DEAL_TIMES_STEP };
  const sorted: DealTimesPair = minutesOf(a) <= minutesOf(b) ? [a, b] : [b, a];
  // At least 2 hours apart on the clock both ways round, so the second deal and the next day's first are not close either.
  const gap = minutesOf(sorted[1]) - minutesOf(sorted[0]);
  if (gap < DEAL_MIN_GAP_MINUTES || 24 * 60 - gap < DEAL_MIN_GAP_MINUTES) return { ok: false, error: DEAL_TIMES_APART };
  return { ok: true, times: sorted };
}

/** The person's two times, or the defaults for anything missing, malformed, failing the rules, or another version. */
export function parseDealTimes(meta: unknown): DealTimesPair {
  const fallback: DealTimesPair = [DEFAULT_DEAL_TIMES[0], DEFAULT_DEAL_TIMES[1]];
  if (!meta || typeof meta !== "object") return fallback;
  const stored = (meta as Record<string, unknown>)[DEAL_TIMES_KEY];
  if (!stored || typeof stored !== "object" || (stored as Record<string, unknown>).v !== DEAL_TIMES_VERSION) return fallback;
  const times = (stored as Record<string, unknown>).times;
  if (!Array.isArray(times) || times.length !== 2) return fallback;
  const checked = validateDealTimes(times[0], times[1]);
  return checked.ok ? checked.times : fallback;
}

/** `meta` with only the deal-times key set; every other key (tour, hub, view preview, full_name...) is kept. */
export function withDealTimes(meta: unknown, times: readonly [string, string]): Record<string, unknown> {
  const base = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  return { ...base, [DEAL_TIMES_KEY]: { v: DEAL_TIMES_VERSION, times: [times[0], times[1]] } };
}

export type DealTimeOption = { value: string; label: string };

/** Every "HH:MM" of the day in 5-minute steps with its label ("7:00 AM"), for the dialog's two selects. */
export function dealTimeOptions(): DealTimeOption[] {
  const out: DealTimeOption[] = [];
  for (let m = 0; m < 24 * 60; m += DEAL_STEP_MINUTES) {
    const value = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    out.push({ value, label: dealLabel(value) });
  }
  return out;
}

type Dispatcher = { dispatchEvent: (event: Event) => boolean };
/** Asks the one deal-times dialog in the owner layout to open. `opener` is where focus returns. */
export function requestDealTimesDialog(target: Dispatcher, opener: { focus?: () => void; isConnected?: boolean } | null): void {
  target.dispatchEvent(new CustomEvent(SHOW_DEAL_TIMES_EVENT, { detail: { opener } }));
}
