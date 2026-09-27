import { describe, it, expect } from "vitest";

import {
  QUOTE_STATUSES,
  QuoteTransitionError,
  assertQuoteTransition,
  canTransitionQuote,
  daysUntilQuoteExpiry,
  effectiveQuoteStatus,
  formatQuoteExpiry,
  isQuoteAcceptable,
  isQuoteEditable,
  isQuoteExpired,
  isTerminalQuoteStatus,
  nextQuoteStatuses,
  quoteExpiryCivilDate,
  quoteStatusLabel,
} from "@/lib/quotes/status";

/**
 * Two failures these tests exist to prevent, both of which this repo has
 * actually shipped a version of.
 *
 * 1. A state change that is silently ignored. The route returns 200, the
 *    client believes they signed, and nothing was written. §4.1 says illegal
 *    transitions throw, and an accepted quote never changes again — that is
 *    what makes the frozen snapshot (§5) a fee agreement rather than a draft.
 *
 * 2. A date read in the server's zone. Vercel runs UTC; the firm is in New
 *    York. A deadline card here once flipped to red OVERDUE for four hours
 *    every evening, and a month grid rendered 1 November twice under DST —
 *    and both passed their tests, because the tests built their expected
 *    values with the same broken helper.
 *
 * So every expected date below is hand-computed (verified independently with
 * GNU `date -d` under TZ=America/New_York) and written as a literal. This file
 * must pass identically under TZ=UTC and TZ=America/New_York; if a helper ever
 * starts reading the process zone, the two runs disagree.
 */

const ALL: readonly string[] = QUOTE_STATUSES;

describe("the transition table (§4.1)", () => {
  it("is exactly draft → sent → accepted | declined | expired | withdrawn", () => {
    expect(nextQuoteStatuses("draft")).toEqual(["sent"]);
    expect(nextQuoteStatuses("sent")).toEqual(["accepted", "declined", "expired", "withdrawn"]);
    expect(nextQuoteStatuses("accepted")).toEqual([]);
    expect(nextQuoteStatuses("declined")).toEqual([]);
    expect(nextQuoteStatuses("expired")).toEqual([]);
    expect(nextQuoteStatuses("withdrawn")).toEqual([]);
  });

  it("makes an accepted quote immutable — no re-send, no re-status, nothing", () => {
    // The client's signature is against a frozen snapshot. If the row it was
    // taken from can still move, "the quote is the fee agreement" is not true.
    for (const to of ALL) {
      expect(canTransitionQuote("accepted", to)).toBe(false);
      expect(() => assertQuoteTransition("accepted", to)).toThrow(QuoteTransitionError);
    }
    expect(isTerminalQuoteStatus("accepted")).toBe(true);
    expect(isQuoteEditable("accepted")).toBe(false);
  });

  it("keeps withdrawn (firm) and declined (client) as separate, final facts", () => {
    expect(canTransitionQuote("sent", "withdrawn")).toBe(true);
    expect(canTransitionQuote("sent", "declined")).toBe(true);
    // Neither collapses into the other, in either direction: they record who
    // walked away, and that is not something a later write may overwrite.
    expect(canTransitionQuote("withdrawn", "declined")).toBe(false);
    expect(canTransitionQuote("declined", "withdrawn")).toBe(false);
  });

  it("will not withdraw a draft — a quote nobody received is deleted, not withdrawn", () => {
    expect(canTransitionQuote("draft", "withdrawn")).toBe(false);
    expect(canTransitionQuote("draft", "accepted")).toBe(false);
    expect(canTransitionQuote("draft", "declined")).toBe(false);
  });

  it("throws rather than silently ignoring, and carries from/to for the caller", () => {
    try {
      assertQuoteTransition("accepted", "accepted");
      throw new Error("expected assertQuoteTransition to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(QuoteTransitionError);
      const e = err as QuoteTransitionError;
      // Branch on the fields, never on the message — the same discipline as
      // reading PostgREST error codes instead of matching message text.
      expect(e.from).toBe("accepted");
      expect(e.to).toBe("accepted");
      expect(e.name).toBe("QuoteTransitionError");
    }
  });

  it("rejects a no-op transition — a second accept is a race, not 'already there'", () => {
    for (const s of ALL) expect(canTransitionQuote(s, s)).toBe(false);
  });

  it("fails closed on a status this build does not know", () => {
    expect(nextQuoteStatuses("countersigned")).toEqual([]);
    expect(canTransitionQuote("countersigned", "accepted")).toBe(false);
    expect(canTransitionQuote("sent", "countersigned")).toBe(false);
    expect(() => assertQuoteTransition("sent", "countersigned")).toThrow(QuoteTransitionError);
  });

  it("labels an unknown status verbatim rather than calling it a Draft", () => {
    expect(quoteStatusLabel("withdrawn")).toBe("Withdrawn");
    expect(quoteStatusLabel("counter_signed")).toBe("counter signed");
  });

  it("allows line edits while drafting or sent, never once terminal", () => {
    expect(isQuoteEditable("draft")).toBe(true);
    expect(isQuoteEditable("sent")).toBe(true);
    for (const s of ["accepted", "declined", "expired", "withdrawn"]) {
      expect(isQuoteEditable(s)).toBe(false);
    }
  });
});

describe("expiry compares INSTANTS, using the `now` it is given", () => {
  const EXPIRES = "2026-09-12T16:00:00Z";

  it("is not expired before the instant, and is after it", () => {
    expect(isQuoteExpired({ expires_at: EXPIRES }, new Date("2026-09-12T15:59:59Z"))).toBe(false);
    expect(isQuoteExpired({ expires_at: EXPIRES }, new Date("2026-09-12T16:00:01Z"))).toBe(true);
  });

  it("lets an on-time signature in — the boundary is exclusive", () => {
    expect(isQuoteExpired({ expires_at: EXPIRES }, new Date("2026-09-12T16:00:00Z"))).toBe(false);
  });

  it("never samples the system clock", () => {
    // An expiry long past in real time, evaluated at a `now` before it. If the
    // function reached for new Date() this would be true.
    expect(isQuoteExpired({ expires_at: "2020-01-01T00:00:00Z" }, new Date("2019-06-01T00:00:00Z")))
      .toBe(false);
    // And the converse: a far-future expiry evaluated at a later `now`.
    expect(isQuoteExpired({ expires_at: "2030-01-01T00:00:00Z" }, new Date("2031-01-01T00:00:00Z")))
      .toBe(true);
  });

  it("never expires when the column is null — a quote may have no deadline", () => {
    const now = new Date("2099-01-01T00:00:00Z");
    expect(isQuoteExpired({ expires_at: null }, now)).toBe(false);
    expect(isQuoteExpired({}, now)).toBe(false);
    expect(isQuoteExpired({ expires_at: "   " }, now)).toBe(false);
  });

  it("fails CLOSED on an expiry value it cannot read", () => {
    // A deadline exists and we cannot tell whether it has passed. Showing a
    // live accept button on that is the failure §4.3 names; wrongly refusing
    // one is a phone call to the firm.
    const now = new Date("2026-09-10T00:00:00Z");
    expect(isQuoteExpired({ expires_at: "not a date" }, now)).toBe(true);
    expect(isQuoteExpired({ expires_at: new Date(Number.NaN) }, now)).toBe(true);
  });

  it("reads Postgres' own timestamptz text form, which is not valid ISO 8601", () => {
    // `2026-09-12 16:00:00+00` — a space instead of T, and an hours-only
    // offset. Date.parse answers NaN for it, and because an unreadable expiry
    // fails closed, that would mark a live quote expired and lock the client
    // out of signing. Regression: this was the shipped behaviour until a test
    // ran the real string.
    for (const raw of [
      "2026-09-12 16:00:00+00",
      "2026-09-12T16:00:00+00",
      "2026-09-12 16:00:00+00:00",
      "2026-09-12T16:00:00Z",
    ]) {
      expect(isQuoteExpired({ expires_at: raw }, new Date("2026-09-12T15:00:00Z"))).toBe(false);
      expect(isQuoteExpired({ expires_at: raw }, new Date("2026-09-12T17:00:00Z"))).toBe(true);
    }
    // A non-UTC stored offset resolves to the same instant, not the same clock.
    expect(quoteExpiryCivilDate("2026-09-11 22:00:00-04")).toBe("2026-09-11");
  });

  it("accepts a Date as well as a string", () => {
    expect(isQuoteExpired({ expires_at: new Date(EXPIRES) }, new Date("2026-09-13T00:00:00Z")))
      .toBe(true);
  });
});

describe("effectiveQuoteStatus — the stored status is never trusted alone", () => {
  const past = new Date("2026-09-20T00:00:00Z");
  const expired = { status: "sent", expires_at: "2026-09-12T16:00:00Z" };

  it("reads a past-due `sent` quote as expired even though the row says sent", () => {
    // The job that writes `expired` may not have run. A client must never be
    // shown a live accept button because a cron did not fire.
    expect(effectiveQuoteStatus(expired, past)).toBe("expired");
    expect(isQuoteAcceptable(expired, past)).toBe(false);
  });

  it("leaves a sent quote alone while it is still live", () => {
    const now = new Date("2026-09-11T00:00:00Z");
    expect(effectiveQuoteStatus(expired, now)).toBe("sent");
    expect(isQuoteAcceptable(expired, now)).toBe(true);
  });

  it("never re-labels an acceptance that beat the clock", () => {
    // Re-reporting a signed fee agreement as "expired" three weeks later would
    // misstate a contract that is in force.
    expect(effectiveQuoteStatus({ status: "accepted", expires_at: "2026-09-12T16:00:00Z" }, past))
      .toBe("accepted");
    expect(effectiveQuoteStatus({ status: "declined", expires_at: "2026-09-12T16:00:00Z" }, past))
      .toBe("declined");
    expect(effectiveQuoteStatus({ status: "withdrawn", expires_at: "2026-09-12T16:00:00Z" }, past))
      .toBe("withdrawn");
  });

  it("does not expire a draft — its clock has not started", () => {
    // Marking an unsent draft "expired" would block the firm from ever sending
    // it. Warning that the date is already stale is the builder's job.
    expect(effectiveQuoteStatus({ status: "draft", expires_at: "2026-09-12T16:00:00Z" }, past))
      .toBe("draft");
  });

  it("returns an unknown stored status untouched", () => {
    expect(effectiveQuoteStatus({ status: "countersigned", expires_at: null }, past))
      .toBe("countersigned");
  });

  it("treats a missing status as draft rather than as acceptable", () => {
    expect(effectiveQuoteStatus({}, past)).toBe("draft");
    expect(isQuoteAcceptable({}, past)).toBe(false);
  });
});

/**
 * Every literal below is the answer for AMERICA/NEW_YORK, computed by hand and
 * confirmed with `TZ=America/New_York date -d <instant>`. Run this file under
 * TZ=UTC and under TZ=America/New_York: both must produce these same strings.
 */
describe("expiry DISPLAY is the firm's calendar, never the server's", () => {
  it("renders the firm's civil date, not UTC's", () => {
    // 16:00Z on 12 Sept is 12:00 EDT — same date either way, the easy case.
    expect(quoteExpiryCivilDate("2026-09-12T16:00:00Z")).toBe("2026-09-12");
    // 02:00Z on 12 Sept is 22:00 EDT on the ELEVENTH. Telling a client
    // "expires 12 September" when the link dies on the 11th invents a date.
    expect(quoteExpiryCivilDate("2026-09-12T02:00:00Z")).toBe("2026-09-11");
    // Winter, EST (UTC-5): 04:00Z on 15 Jan is 23:00 on the 14th.
    expect(quoteExpiryCivilDate("2026-01-15T04:00:00Z")).toBe("2026-01-14");
  });

  it("survives the DST fall-back that once rendered 1 November twice", () => {
    // US DST ends 2026-11-01 at 02:00 EDT (06:00Z).
    // 05:30Z is 01:30 EDT — still 1 November in New York.
    expect(quoteExpiryCivilDate("2026-11-01T05:30:00Z")).toBe("2026-11-01");
    // 03:00Z is 23:00 EDT on 31 October, not 1 November.
    expect(quoteExpiryCivilDate("2026-11-01T03:00:00Z")).toBe("2026-10-31");
    // And the spring-forward side: 06:30Z on 8 March is 01:30 EST, still the 8th.
    expect(quoteExpiryCivilDate("2026-03-08T06:30:00Z")).toBe("2026-03-08");
  });

  it("formats a client-facing date in the firm's zone", () => {
    expect(formatQuoteExpiry("2026-09-12T16:00:00Z")).toBe("Saturday, September 12, 2026");
    expect(formatQuoteExpiry("2026-09-12T02:00:00Z")).toBe("Friday, September 11, 2026");
    expect(formatQuoteExpiry("2026-11-01T03:00:00Z")).toBe("Saturday, October 31, 2026");
  });

  it("renders nothing rather than 'Invalid Date' when there is no readable expiry", () => {
    expect(quoteExpiryCivilDate(null)).toBeNull();
    expect(quoteExpiryCivilDate("not a date")).toBeNull();
    expect(formatQuoteExpiry(undefined)).toBeNull();
    expect(formatQuoteExpiry("")).toBeNull();
  });

  it("counts calendar days the way a person does", () => {
    // now = 2026-09-10T20:00Z = 16:00 EDT on the 10th. expiry 16:00Z on the
    // 12th = 12:00 EDT on the 12th. Two calendar days in New York.
    expect(daysUntilQuoteExpiry("2026-09-12T16:00:00Z", new Date("2026-09-10T20:00:00Z"))).toBe(2);
    // now = 2026-09-12T02:30Z = 22:30 EDT on the ELEVENTH; expiry is 12:00 EDT
    // on the 12th. That is "tomorrow" to the firm — and would be "today", i.e.
    // 0, to a UTC server reading its own calendar fields.
    expect(daysUntilQuoteExpiry("2026-09-12T16:00:00Z", new Date("2026-09-12T02:30:00Z"))).toBe(1);
    // Past due counts negative rather than clamping — a blown date is never
    // hidden inside a quieter number.
    expect(daysUntilQuoteExpiry("2026-09-12T16:00:00Z", new Date("2026-09-15T16:00:00Z"))).toBe(-3);
    expect(daysUntilQuoteExpiry(null, new Date("2026-09-15T16:00:00Z"))).toBeNull();
  });

  it("counts days by the calendar, never by 24-hour blocks", () => {
    // 20 hours apart, but a different day in New York: 2026-09-11T22:00 EDT →
    // 2026-09-12T18:00 EDT. Math.floor(ms / 86400000) would answer 0.
    expect(daysUntilQuoteExpiry("2026-09-12T22:00:00Z", new Date("2026-09-12T02:00:00Z"))).toBe(1);
  });
});
