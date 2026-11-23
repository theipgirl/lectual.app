/**
 * The typed legal name at signing must equal the name the letter was sent with, folded the SAME way lectual 0117's
 * `client_proposal_signing_sign` folds it (v2, N3): `btrim` (spaces), runs of whitespace to one space, then ASCII A-Z to a-z
 * ONLY (`translate`), so "  sam   CLIENT " matches "Sam Client" and "ZOË" does not match "Zoë". Pure.
 */
export function foldName(raw: string): string {
  return raw
    .replace(/^ +| +$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
}

export function namesMatch(typed: string, frozen: string): boolean {
  return foldName(typed) === foldName(frozen);
}
