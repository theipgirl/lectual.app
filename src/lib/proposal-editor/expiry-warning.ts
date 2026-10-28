/**
 * The plain warning under the Expiry date field. Pure and import-free of the server, so the
 * field (a client component) and its test use the same rule.
 *
 * Civil dates compare as text ("2026-10-28"). A date before today warns: the offer is open
 * through the end of its expiry day (`isProposalExpired`), so today is still fine. No date, or an
 * unreadable one, says nothing here: validation owns those.
 */

export const EXPIRY_PASSED_WARNING = "This date has passed. Pick a new expiry date before creating the link.";

const CIVIL = /^\d{4}-\d{2}-\d{2}$/;

/** `today` is the firm's civil date (`firmCivilDate`). */
export function expiryWarning(expiresOn: string | null | undefined, today: string): string | null {
  const v = (expiresOn ?? "").trim();
  if (!CIVIL.test(v) || !CIVIL.test(today)) return null;
  return v < today ? EXPIRY_PASSED_WARNING : null;
}
