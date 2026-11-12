/**
 * The STORED signed text of a signed version and its stored sha256, for the one case that needs it: building a signed PDF when
 * today's code no longer rebuilds the text that was signed (`buildVerifiedSignedPdf`). Fenced on the proposal's OWN org as well as
 * its id, so it is safe through the service role too (the client's download and the Lawmatics filing) and reads nothing of another
 * firm's through a scoped client. The row is the one the accepted snapshot names (`signatureId`), else the newest for the version.
 * Null for a failed read, no row or an unreadable row: the caller then builds no file. Never logged.
 */
export type StoredAgreementDb = {
  from(table: string): {
    select(columns: string): unknown;
  };
};

export async function readStoredAgreement(
  db: StoredAgreementDb,
  key: { proposalId: string; orgId: string; signatureId?: string | null },
): Promise<{ text: string; sha256: string } | null> {
  try {
    type Q = PromiseLike<{ data: unknown; error: unknown }> & { eq(column: string, value: unknown): Q; order(column: string, o: { ascending: boolean }): Q; limit(n: number): Q };
    let q = (db.from("client_proposal_signature").select("id, agreement_text, agreement_sha256") as Q).eq("proposal_id", key.proposalId).eq("org_id", key.orgId);
    if (key.signatureId) q = q.eq("id", key.signatureId);
    const { data, error } = await q.order("signed_at", { ascending: false }).limit(1);
    if (error) return null;
    const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
    if (!row || typeof row.agreement_text !== "string" || typeof row.agreement_sha256 !== "string") return null;
    return { text: row.agreement_text, sha256: row.agreement_sha256 };
  } catch {
    return null;
  }
}
