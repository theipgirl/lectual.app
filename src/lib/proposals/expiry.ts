import { firmCivilDate } from "@/lib/quotes/firm-time";
import { resolveTimeZone } from "@/lib/org/profile-rules";
import { isCivilDate } from "./validate";

/**
 * Pure and free of server imports, so the proposals list can decide
 * "Expired" with the very function the client's page uses (re-exported by
 * `public.ts`).
 */

/**
 * Whether an offer has expired, by the FIRM's calendar. `expires_on` is a date,
 * not an instant: the offer is open through the end of that day in the firm's
 * zone, so a client opening the link on the evening of the last day still finds
 * it. Vercel runs UTC and the firm does not; comparing civil dates (not the
 * server's calendar fields) is what makes "October 26" mean October 26 in New
 * York. No expiry date means no expiry; an unreadable one is treated as none
 * (validation, not the client's page, is where that is reported).
 */
export function isProposalExpired(expiresOn: string | null | undefined, now: Date, timeZone: string): boolean {
  if (typeof expiresOn !== "string" || !isCivilDate(expiresOn)) return false;
  return firmCivilDate(now, resolveTimeZone(timeZone)) > expiresOn;
}
