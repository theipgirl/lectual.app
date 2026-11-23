/**
 * Is the proposal's client email an address the emailed link may be sent to? EXACTLY lectual 0117's rule, so the app and the
 * database can never disagree (v3, B1b): `btrim` (spaces), then the pattern below, then 3..320 characters.
 *
 * 0117 uses this pattern in TWO places, which must stay equal to this constant:
 *   - `client_proposal_signing_open` / `client_proposal_signing_readiness`: `btrim(client_email) !~ '^[^@\s]+@[^@\s]+$'`;
 *   - the `client_proposal_signing_request_email` CHECK on `sent_to` (with `char_length(sent_to) between 3 and 320`).
 * Pure.
 */
export const SIGNING_ADDRESS_PATTERN = /^[^@\s]+@[^@\s]+$/;
export const SIGNING_ADDRESS_MIN = 3;
export const SIGNING_ADDRESS_MAX = 320;

/** Postgres `btrim(x)` with no second argument trims SPACES only. */
export function btrimSpaces(value: string): string {
  return value.replace(/^ +| +$/g, "");
}

export function isSigningAddress(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const v = btrimSpaces(raw);
  return v.length >= SIGNING_ADDRESS_MIN && v.length <= SIGNING_ADDRESS_MAX && SIGNING_ADDRESS_PATTERN.test(v);
}
