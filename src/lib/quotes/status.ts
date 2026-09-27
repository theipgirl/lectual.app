/**
 * Quote lifecycle — the transition table, and expiry.
 *
 * Pure module: no database, no server-only imports. Safe from a `"use client"`
 * component and from a plain vitest run with no environment.
 *
 * ── WHY THE TRANSITIONS THROW ───────────────────────────────────────────────
 * Spec §4.1: "Illegal transitions throw; they are not silently ignored."
 *
 * This is the opposite of `pricing.ts`, which never throws, and the difference
 * is deliberate. Arithmetic runs over stored rows whose shape will keep moving,
 * so a bad row must degrade to a blocked accept button rather than a blank
 * page. A transition, by contrast, is always a decision some code made THIS
 * request — "mark this accepted" — and a decision that is wrong is a bug, not
 * data. Ignoring it returns HTTP 200 to a client who thinks they just signed.
 *
 * Two facts this table refuses to collapse:
 *
 *  - An `accepted` quote is IMMUTABLE. No line edits, no re-send, no further
 *    status change. Revising an accepted quote means creating a new one. This
 *    is what makes "the quote is the fee agreement" true: the client's
 *    signature is against a snapshot (§5), and nothing about the row it was
 *    taken from may move underneath it afterwards.
 *  - `withdrawn` is the FIRM's action; `declined` is the CLIENT's. They are
 *    different facts about who walked away, they carry different follow-up,
 *    and a single "cancelled" state would erase which happened. Kept apart.
 *
 * ── WHY EXPIRY TAKES `now` AS AN ARGUMENT ───────────────────────────────────
 * Nothing in this file calls `new Date()`. Every time-dependent function takes
 * the instant explicitly, so a test can pin one and a page can pass the request
 * time down rather than each helper sampling its own clock.
 *
 * Expiry is evaluated on READ by comparing INSTANTS, never by comparing civil
 * dates and never by trusting the stored status. A quote whose `expires_at` has
 * passed reads as expired even though the row still says `sent`, because the
 * job that writes `expired` may not have run — and a client shown a live accept
 * button on an expired quote can sign an offer the firm has withdrawn.
 *
 * ── AND WHY DISPLAY GOES THROUGH FIRM_TIME_ZONE ─────────────────────────────
 * This repo has shipped the process-zone bug twice: a deadline card that
 * flipped to red OVERDUE for four hours every evening because a helper read the
 * server's calendar fields, and a month grid that rendered 1 November twice
 * under DST. Both passed their tests, because the tests built expected values
 * with the same broken helper. Vercel runs UTC; the firm does not. So every
 * DATE this module renders goes through `FIRM_TIME_ZONE`, and the tests
 * alongside it use hand-computed strings and run under both TZ=UTC and
 * TZ=America/New_York.
 */

import { FIRM_TIME_ZONE, civilDaysBetween, firmCivilDate } from "./firm-time";

/** `crm_quote.status` (spec §4.1). `viewed` is an EVENT, not a status. */
export const QUOTE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
  "withdrawn",
] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export function isQuoteStatus(value: unknown): value is QuoteStatus {
  return typeof value === "string" && (QUOTE_STATUSES as readonly string[]).includes(value);
}

const STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  withdrawn: "Withdrawn",
};

/**
 * Friendly label. An unrecognised value is humanized rather than dropped or
 * relabelled — if a later migration adds a status this build has not heard of,
 * showing it verbatim is honest, whereas mapping it to "Draft" would be a
 * confident lie about a quote's state.
 */
export function quoteStatusLabel(status: string): string {
  return isQuoteStatus(status) ? STATUS_LABEL[status] : status.replace(/_/g, " ");
}

/**
 * The transition table, exactly as §4.1 draws it:
 *
 *   draft → sent → accepted | declined | expired | withdrawn
 *
 * Every terminal state has an EMPTY list, including `expired` and `withdrawn`.
 * Re-opening an expired quote by extending its date, or un-withdrawing one, are
 * both plausible product asks and neither is in the spec — so neither is here.
 * Adding them silently would mean a quote a client was told had expired could
 * become live again with no new record of the firm's decision. When the firm
 * asks for it, it is a spec change and a new event type, not a line in this map.
 *
 * `draft` cannot go to `withdrawn` either: a quote nobody has seen is deleted,
 * not withdrawn from a client who never received it.
 */
const ALLOWED_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  draft: ["sent"],
  sent: ["accepted", "declined", "expired", "withdrawn"],
  accepted: [],
  declined: [],
  expired: [],
  withdrawn: [],
};

/** States from which nothing further may happen — see ALLOWED_TRANSITIONS. */
export function isTerminalQuoteStatus(status: string): boolean {
  return isQuoteStatus(status) && ALLOWED_TRANSITIONS[status].length === 0;
}

/**
 * Whether the quote's LINES may still be edited.
 *
 * True for `draft` and `sent`, false for every terminal state. Editing a sent
 * quote is legitimate (the firm corrects a typo before the client opens it) and
 * is the caller's judgement to warn about; editing a terminal one is not, and
 * on an `accepted` quote it is the failure §5 exists to prevent — which is why
 * every read of an accepted quote goes to the snapshot rather than the lines.
 */
export function isQuoteEditable(status: string): boolean {
  return status === "draft" || status === "sent";
}

/** The statuses reachable from here. Unknown status → nothing, fail closed. */
export function nextQuoteStatuses(from: string): QuoteStatus[] {
  return isQuoteStatus(from) ? [...ALLOWED_TRANSITIONS[from]] : [];
}

export function canTransitionQuote(from: string, to: string): boolean {
  if (!isQuoteStatus(from) || !isQuoteStatus(to)) return false;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/**
 * Thrown by `assertQuoteTransition`. Carries `from`/`to` as fields so a caller
 * can branch on them (the public accept route turns an `accepted → accepted`
 * double-submit into the receipt page rather than a 500) without matching on
 * message text — the mistake `loadCalendarEvents` avoids by branching on
 * PostgREST error codes instead of strings.
 */
export class QuoteTransitionError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(`Illegal quote transition: ${from} → ${to}`);
    this.name = "QuoteTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Enforce a transition, or throw.
 *
 * Note that a no-op (`from === to`) throws too. It is never a legitimate
 * request: re-sending a `sent` quote is a new send event on an unchanged
 * status, and a second acceptance of an `accepted` quote is the double-submit
 * §6.5 guards with a conditional update. Letting either through as "already
 * there, fine" is how a race gets reported as a success.
 */
export function assertQuoteTransition(from: string, to: string): void {
  if (!canTransitionQuote(from, to)) throw new QuoteTransitionError(from, to);
}

/* ─────────────────────────────── expiry ─────────────────────────────────── */

/** The quote fields expiry needs — a structural subset of `crm_quote`. */
export type QuoteExpiryInput = {
  status?: string | null;
  /** `timestamptz`; null means this quote never expires. */
  expires_at?: string | Date | null;
};

/**
 * Parse a `timestamptz` into an instant, or null.
 *
 * Postgres' own text output for a timestamptz is `2026-09-12 16:00:00+00` —
 * a space instead of `T`, and a two-digit offset. Neither is valid ISO 8601,
 * so `Date.parse` treats the whole thing as an implementation-defined string,
 * and V8's answer is NaN. That matters here more than anywhere else in the
 * app: an unreadable expiry fails CLOSED, so a value this function cannot
 * parse marks a perfectly live quote expired and the client cannot sign it.
 * Both shapes are normalized before parsing rather than bet on.
 */
function parseInstant(value: string | Date | null | undefined): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed
    // "2026-09-12 16:00:00+00" → "2026-09-12T16:00:00+00"
    .replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T")
    // "...+00" → "...+00:00" (Postgres emits the hours-only offset form)
    .replace(/([+-]\d{2})$/, "$1:00");
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Has this quote's link expired at instant `now`?
 *
 * Compares instants — `expires_at` is a real point in time and so is `now`, so
 * no calendar and no timezone is involved in the DECISION. Only the DISPLAY of
 * the date needs a zone.
 *
 * The boundary is exclusive: a quote is expired strictly AFTER `expires_at`, so
 * a client clicking accept on the exact millisecond still gets in. Erring the
 * other way would refuse an on-time signature.
 *
 * Three cases and their reasoning:
 *  - no `expires_at` → never expires. The column is nullable and a quote with
 *    no deadline is a legitimate thing for a firm to send.
 *  - unparseable `expires_at` → EXPIRED. Fail closed. A value that is present
 *    but unreadable means a deadline exists and we cannot tell whether it has
 *    passed; showing a live accept button on that is the failure §4.3 names,
 *    while wrongly refusing one is a phone call to the firm.
 *  - `now` itself unusable → not expired, because the caller has a broken clock
 *    and refusing every quote in the product is a worse answer than refusing
 *    none. Callers pass a real request time; this branch is unreachable in
 *    practice and exists so the function stays total.
 */
export function isQuoteExpired(quote: QuoteExpiryInput, now: Date): boolean {
  const raw = quote.expires_at;
  if (raw === null || raw === undefined || (typeof raw === "string" && !raw.trim())) {
    return false;
  }
  const expiresAt = parseInstant(raw);
  if (!expiresAt) return true;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return false;
  return now.getTime() > expiresAt.getTime();
}

/**
 * The status a surface should actually render, expiry included.
 *
 * Only `sent` is overridden, and that is the whole point of the function:
 *
 *  - `accepted`, `declined`, `withdrawn` are FACTS that already happened. An
 *    acceptance beat the clock; re-labelling a signed quote "expired" three
 *    weeks later would misreport a fee agreement that is in force.
 *  - `draft` is not overridden either. A draft has never been sent, so its
 *    expiry clock has not started; showing the firm "expired" on a quote it has
 *    not sent yet would block it from sending — and validating that a firm is
 *    not sending an already-stale date is the builder's job, not this one's.
 *  - an unrecognised stored status is returned as-is, never coerced.
 *
 * Read this, never `quote.status`, on any surface with an accept button.
 */
export function effectiveQuoteStatus(quote: QuoteExpiryInput, now: Date): string {
  const stored = typeof quote.status === "string" ? quote.status : "draft";
  if (stored !== "sent") return stored;
  return isQuoteExpired(quote, now) ? "expired" : "sent";
}

/**
 * Whether the client may accept right now: the quote is `sent`, and it has not
 * expired. Deliberately derived from `effectiveQuoteStatus` so there is one
 * definition of "live" and the button cannot disagree with the banner above it.
 */
export function isQuoteAcceptable(quote: QuoteExpiryInput, now: Date): boolean {
  return effectiveQuoteStatus(quote, now) === "sent";
}

/* ───────────────────────────── expiry display ───────────────────────────── */

/**
 * The civil date an expiry falls on FOR THE FIRM — "2026-09-12".
 *
 * Goes through `firmCivilDate`, never the server's calendar. A quote expiring
 * at 2026-09-12T02:00:00Z expires on the 11th in New York, and telling a client
 * "expires 12 September" when the link dies on the 11th is a date this app
 * invented. Returns null when there is no readable expiry, so a caller renders
 * nothing rather than "Invalid Date".
 */
export function quoteExpiryCivilDate(
  expiresAt: string | Date | null | undefined,
): string | null {
  const instant = parseInstant(expiresAt);
  return instant ? firmCivilDate(instant) : null;
}

/**
 * The expiry date as a client-facing string — "Friday, September 12, 2026".
 *
 * Date only, no clock time: `expires_at` is usually set to end-of-day and a
 * displayed time implies a precision the firm did not choose. The instant is
 * still what `isQuoteExpired` compares; this is only the label.
 */
export function formatQuoteExpiry(
  expiresAt: string | Date | null | undefined,
): string | null {
  const instant = parseInstant(expiresAt);
  if (!instant) return null;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: FIRM_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(instant);
}

/**
 * Whole days from the firm's today to the firm's expiry date; negative once it
 * has passed, null when there is no expiry.
 *
 * Both ends are converted to firm civil dates first, so this counts CALENDAR
 * days the way a person does ("expires tomorrow") rather than 24-hour blocks —
 * an expiry 20 hours away is "tomorrow" if it lands on tomorrow's date, and
 * `Math.floor(ms / 86400000)` would have called it "today".
 *
 * Not used to decide expiry — `isQuoteExpired` compares instants. This is a
 * label only, and the two must never be swapped: a civil-date comparison would
 * keep the accept button alive for the rest of the expiry day.
 */
export function daysUntilQuoteExpiry(
  expiresAt: string | Date | null | undefined,
  now: Date,
): number | null {
  const instant = parseInstant(expiresAt);
  if (!instant) return null;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return null;
  return civilDaysBetween(firmCivilDate(now), firmCivilDate(instant));
}
