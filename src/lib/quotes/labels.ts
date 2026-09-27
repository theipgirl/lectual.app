import {
  QUOTE_CHARGE_SCHEDULES,
  QUOTE_LINE_KINDS,
  QUOTE_LINE_SELECTIONS,
  type QuoteChargeAt,
  type QuoteLineKind,
  type QuoteLineSelection,
} from "./pricing";
import type { QuoteStatus } from "./status";
import type { QuoteEventType } from "./types";
import { FIRM_TIME_ZONE } from "./firm-time";

/**
 * Display vocabulary for the quote surfaces. Pure, so the builder's client
 * forms, the list, the service library and the tests share one copy.
 *
 * In `lectual` these were `line-fields.ts`, `field-meta.ts` and `quote-meta.ts`,
 * three copies kept apart to avoid cross-directory merge conflicts between
 * concurrent agents. The port has one owner, so it has one file.
 */

export const KIND_LABEL: Record<QuoteLineKind, string> = {
  legal_fee: "Legal fee",
  government_fee: "Government fee (USPTO)",
  expense: "Expense",
  discount: "Discount",
};

export const CHARGE_AT_LABEL: Record<QuoteChargeAt, string> = {
  signing: "At signing",
  filing: "At filing",
  not_charged: "Not charged",
};

export const SELECTION_LABEL: Record<QuoteLineSelection, string> = {
  included: "Included",
  optional: "Optional add-on",
  tier_option: "Package option",
};

export function kindLabel(kind: string): string {
  return (KIND_LABEL as Record<string, string>)[kind] ?? kind.replace(/_/g, " ");
}

export function chargeAtLabel(chargeAt: string): string {
  return (CHARGE_AT_LABEL as Record<string, string>)[chargeAt] ?? chargeAt.replace(/_/g, " ");
}

/**
 * The charge-schedule options to OFFER for a line kind — spec §0: a government
 * fee "must be impossible to set to charge_at 'signing' in this UI — don't
 * offer the option." The store (`assertLineKindChargeAt`) and the database
 * CHECK are still the real enforcement; this is the first of three.
 */
export function chargeAtOptionsFor(kind: string): QuoteChargeAt[] {
  if (kind === "government_fee") {
    return QUOTE_CHARGE_SCHEDULES.filter((c) => c !== "signing");
  }
  return [...QUOTE_CHARGE_SCHEDULES];
}

/**
 * `lx-pill` tone per EFFECTIVE status (never the stored column alone — a `sent`
 * quote past its `expires_at` reads as expired).
 *
 * `declined` (the client) and `withdrawn` (the firm) get different tones on
 * purpose: they are different facts and must not read as one.
 */
const STATUS_TONE: Record<QuoteStatus, string> = {
  draft: "lx-pill-mute",
  sent: "lx-pill-ox",
  accepted: "lx-pill-ok",
  declined: "lx-pill-risk",
  expired: "lx-pill-warn",
  withdrawn: "lx-pill-mute",
};

/** An unrecognised status gets the neutral tone — never a guess. */
export function quoteStatusTone(status: string): string {
  return (STATUS_TONE as Record<string, string>)[status] ?? "lx-pill-mute";
}

export const EVENT_LABEL: Record<QuoteEventType, string> = {
  created: "Created",
  sent: "Sent to client",
  viewed: "Viewed by client",
  selection_changed: "Client changed a selection",
  accepted: "Accepted by client",
  declined: "Declined by client",
  expired: "Expired",
  withdrawn: "Withdrawn",
  revised: "Revised",
  payment_recorded: "Payment recorded",
};

/** A future event type this build has not heard of is shown humanized. */
export function eventLabel(type: string): string {
  return (EVENT_LABEL as Record<string, string>)[type] ?? type.replace(/_/g, " ");
}

/**
 * An instant in the FIRM's zone, with the zone named — "Sep 11, 2026, 8:30 PM
 * EDT". The event list is an audit trail; a bare `toLocaleString()` renders the
 * server's zone (UTC on Vercel) and moves an evening signature to the next day.
 * Component options rather than dateStyle/timeStyle, because ECMA-402 throws if
 * those are combined with `timeZoneName`.
 */
export function formatFirmDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: FIRM_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(ms));
}

/** The firm-zone civil date of an instant, for a `<input type="date">`'s
 * default value — "2026-09-30". Empty when there is none. */
export function expiryInputValue(expiresAt: string | null | undefined): string {
  if (!expiresAt) return "";
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FIRM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export { QUOTE_LINE_KINDS, QUOTE_LINE_SELECTIONS };
