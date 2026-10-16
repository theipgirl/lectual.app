/**
 * The client's link for a matter's intake questions: `<origin>/r/<token>`.
 * Pure and browser-safe (the token itself is made in request-token.ts).
 */
export function intakeRequestUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/r/${token}`;
}
