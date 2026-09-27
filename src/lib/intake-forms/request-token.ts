import { randomBytes } from "node:crypto";

/**
 * The credential in `/r/<token>` (`crm_intake_request.token`, 0075): 32 bytes
 * of server-side randomness, base64url — 43 characters, inside 0075's
 * `char_length(token) between 32 and 128`. The link IS the credential, so it
 * is only ever made here, never taken from a browser.
 */
export function generateRequestToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Shape check before a lookup; a malformed token is not found, like any other. */
export function isRequestTokenShape(token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token);
}
