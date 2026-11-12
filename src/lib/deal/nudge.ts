import { DEFAULT_DEAL_TIMES, dealFor } from "@/lib/deal/times";

/**
 * The deal-ready nudge. Pure: the clock, the firm's zone, the person's two deal times, one read of their deck and the
 * time they last opened the deck come in.
 *
 * The dot means "a NEW deal is ready" (the rail already shows the waiting count). Ready only when all hold:
 *  - the read is `ok` and the person has at least one undecided card in their deck right now (the deck holds only the
 *    viewer's own cards of the current deal: not decided, not put off with Later, not a later arrival, not handed away);
 *  - the person's CURRENT deal exists today (before the first deal there is none, even with cards carried over);
 *  - that deal opened AFTER the time the person last opened the deck (`lectual_deck_seen`), or there is no usable stamp.
 * A read that failed, or a queue that isn't connected, gives no nudge, never a 0 and never a guess. A malformed stamp
 * counts as no stamp.
 */
export type NudgeRead = { status: "ok"; undecided: number } | { status: "unconfigured" } | { status: "unavailable" };
export type DealNudge = { ready: true; label: string; count: number } | { ready: false };

export const NO_NUDGE: DealNudge = { ready: false };

/** `user_metadata.lectual_deck_seen`: an ISO time, the last time this person opened the deck. Draw-only. */
export const DECK_SEEN_KEY = "lectual_deck_seen";

/** The stored stamp as a Date, or null for a missing, non-string or unparseable one. */
export function parseDeckSeen(meta: unknown): Date | null {
  if (!meta || typeof meta !== "object") return null;
  const raw = (meta as Record<string, unknown>)[DECK_SEEN_KEY];
  if (typeof raw !== "string") return null;
  const at = new Date(raw);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** `meta` with only the stamp set; every other key is kept. */
export function withDeckSeen(meta: unknown, at: Date): Record<string, unknown> {
  const base = meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  return { ...base, [DECK_SEEN_KEY]: at.toISOString() };
}

export function dealNudge(input: { now: Date; timeZone: string; times?: readonly string[]; read: NudgeRead; seen?: Date | null }): DealNudge {
  const { read } = input;
  if (read.status !== "ok") return NO_NUDGE;
  if (!Number.isFinite(read.undecided) || read.undecided < 1) return NO_NUDGE;
  const deal = dealFor(input.now, input.timeZone, input.times ?? DEFAULT_DEAL_TIMES);
  if (!deal.current) return NO_NUDGE;
  if (input.seen && input.seen.getTime() >= deal.current.at.getTime()) return NO_NUDGE;
  return { ready: true, label: deal.current.label, count: Math.floor(read.undecided) };
}

/**
 * Whether opening the deck now should write the stamp: the current deal exists and opened AFTER the stored stamp (or
 * there is none). So at most two writes a day. Returns the time to store, or null for "write nothing".
 */
export function deckSeenStamp(input: { now: Date; timeZone: string; times?: readonly string[]; meta: unknown }): Date | null {
  const deal = dealFor(input.now, input.timeZone, input.times ?? DEFAULT_DEAL_TIMES);
  if (!deal.current) return null;
  const seen = parseDeckSeen(input.meta);
  if (seen && seen.getTime() >= deal.current.at.getTime()) return null;
  return input.now;
}
