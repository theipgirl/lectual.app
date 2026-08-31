/**
 * The answer clock — a SUGGESTION, and only ever a suggestion.
 *
 * The attorney currently does this arithmetic by hand on timeanddate.com:
 * service date + 20 days is when the answer is due, and a default is
 * considered the day after that. This module does the counting so she stops
 * retyping dates into a website. It does not decide anything.
 *
 * WHAT THIS MODULE MUST NEVER DO
 * ------------------------------
 * 1. It never writes. There is no DB import here — no scoped client, no query
 *    builder — and no exported function that persists anything. The output is a value the UI
 *    renders with a dashed border and the words "Suggested — not on the
 *    docket". A suggestion is not a docket entry until she clicks, and until
 *    she does it is never counted in the hero and never on the calendar.
 *
 * 2. It never rolls a date off a weekend or a holiday. Moving a deadline
 *    because it lands on a Saturday is a legal determination — which rule
 *    governs, which holidays count, whether the period is computed in
 *    calendar or business days. So the weekday is surfaced instead, in words,
 *    and the attorney decides. `answerDueWeekday: "Saturday"` is information;
 *    silently returning the following Monday would be advice.
 *
 * 3. It never produces a calculated-source date. When she dockets one of
 *    these, the row is written `source='manual'`, `anchor_event='service'`,
 *    `anchor_date=<servedOn>`, `attorney_confirmed=false`, with `basis`
 *    stored verbatim in `calculation_basis` so the docket records where the
 *    date came from and that a human chose it. Twenty days is her own
 *    standing office rule, not a procedural period this product asserts.
 *
 * Pure module: civil-date arithmetic only, no time of day, no timezone.
 */

import { addCivilDays, civilWeekday, isCivilDate, type Weekday } from "./urgency";

/** The attorney's own standing office interval, in calendar days. */
export const ANSWER_WINDOW_DAYS = 20;

/** Days after the answer date at which she considers moving for default. */
export const DEFAULT_ELIGIBLE_OFFSET_DAYS = 1;

/**
 * The sentence stored in `calculation_basis` when a suggestion is docketed.
 * It names the interval, names whose rule it is, and says out loud that it
 * still has to be checked — so anyone reading the docket a year later can see
 * exactly how the date was reached.
 */
export const ANSWER_CLOCK_BASIS =
  "20 days from the date of service; default considered the following day. " +
  "Attorney's own standing rule — verify against the applicable rule and the docket.";

/** Shown wherever a suggestion is rendered. Never optional, never collapsed. */
export const SUGGESTION_NOTICE =
  "Suggested — not on the docket. Nothing is calendared or counted until you docket it.";

export type AnswerClockInput = {
  /** The date of service, a civil date (`YYYY-MM-DD`). */
  servedOn: string;
};

export type AnswerClock = {
  /** Echoed back so a rendered suggestion always carries its own anchor. */
  servedOn: string;
  /** Civil date: service + 20 days. Not rolled off weekends or holidays. */
  answerDue: string;
  /** Civil date: the day after the answer date. */
  defaultEligibleOn: string;
  /** Surfaced so the attorney can see a weekend landing and decide herself. */
  answerDueWeekday: Weekday;
  /** Same, for the default-eligible date. */
  defaultEligibleWeekday: Weekday;
  /** Plain-language record of the interval used. */
  basis: string;
  /**
   * Discriminant, always the literal `'suggestion'`. Nothing downstream may
   * treat one of these as a docketed obligation; the type makes that
   * impossible to do by accident.
   */
  kind: "suggestion";
};

/**
 * Counts the answer window from a service date.
 *
 * Throws on a date that is not a real civil date rather than guessing at one —
 * a silently-wrong answer date is precisely the failure this dashboard exists
 * to prevent. Callers taking form input should validate with `isCivilDate`
 * first and show a field error.
 */
export function computeAnswerClock({ servedOn }: AnswerClockInput): AnswerClock {
  if (!isCivilDate(servedOn)) {
    throw new TypeError(
      `computeAnswerClock: servedOn must be a civil date (YYYY-MM-DD); received ${JSON.stringify(servedOn)}`,
    );
  }

  const answerDue = addCivilDays(servedOn, ANSWER_WINDOW_DAYS);
  const defaultEligibleOn = addCivilDays(answerDue, DEFAULT_ELIGIBLE_OFFSET_DAYS);

  return {
    servedOn,
    answerDue,
    defaultEligibleOn,
    answerDueWeekday: civilWeekday(answerDue),
    defaultEligibleWeekday: civilWeekday(defaultEligibleOn),
    basis: ANSWER_CLOCK_BASIS,
    kind: "suggestion",
  };
}

/** True when the suggested answer date lands on a Saturday or Sunday. */
export function landsOnWeekend(clock: AnswerClock): boolean {
  return clock.answerDueWeekday === "Saturday" || clock.answerDueWeekday === "Sunday";
}

/**
 * The one-line caution shown when the suggested date falls on a weekend. It
 * states the fact and hands the decision back; it does not propose a date.
 */
export function weekendCaution(clock: AnswerClock): string | null {
  return landsOnWeekend(clock)
    ? `The suggested answer date falls on a ${clock.answerDueWeekday}. This app does not move it — check the applicable rule and docket the date you decide on.`
    : null;
}
