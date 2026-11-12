import type { AcceptedSnapshot } from "./types";

/**
 * Is this accepted version SIGNED? (lectual 0106, Sprint 6.) A signed acceptance is a schema-2 snapshot that carries
 * the agreement (who signed, when, the sha256). Every earlier acceptance is schema 1 and stays "accepted by client".
 * Pure. The signature ROW is the source for the staff card's detail; this snapshot test only decides the wording.
 */
export function isSignedSnapshot(snapshot: Pick<AcceptedSnapshot, "schema" | "agreement"> | null | undefined): boolean {
  return !!snapshot && snapshot.schema === 2 && !!snapshot.agreement && typeof snapshot.agreement.signer_name === "string" && snapshot.agreement.signer_name.trim().length > 0;
}
