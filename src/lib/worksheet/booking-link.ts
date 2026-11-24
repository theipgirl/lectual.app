/**
 * The attendee's own pre-filled Lawmatics booking link, if the firm stored one.
 *
 * `crm_intake_form.config.bookingLinks` = { "<lowercased email>": "<link>" } is a PRIVATE config key: the intake config
 * parser drops it and `publicConfig` never picks it, so no public page carries it. It is read here, server-side only,
 * through the service role fenced on the form id the handler already resolved (never an org from the request body).
 * The link goes in the attendee's own email and nowhere else. A failed read, a missing entry or a link of the wrong
 * shape is `null`, and the email falls back to the general link.
 */

export const BOOKING_LINK_SHAPE = /^https:\/\/app\.lawmatics\.com\/forms\/share\/[0-9a-f-]{36}$/;

/** Pure: the personal link for an email out of a raw `config` value, or null. */
export function pickBookingLink(config: unknown, email: string): string | null {
  if (!config || typeof config !== "object") return null;
  const links = (config as Record<string, unknown>).bookingLinks;
  if (!links || typeof links !== "object" || Array.isArray(links)) return null;
  const key = email.trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(links, key)) return null;
  const link = (links as Record<string, unknown>)[key];
  return typeof link === "string" && BOOKING_LINK_SHAPE.test(link) ? link : null;
}
