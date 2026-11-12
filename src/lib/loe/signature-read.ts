import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";

/**
 * The signature row of a signed proposal version (lectual 0106 `client_proposal_signature`), for the staff card. Reads through
 * the caller's SCOPED client (RLS: the active firm's rows only). Three states, never two:
 *   ok          the newest signature of this version (a reset keeps earlier rows; the newest belongs to the current acceptance);
 *   none        the read worked and found no row (the card says it wasn't found, never "Signed" from the snapshot alone);
 *   unavailable the read failed (the card says it couldn't be loaded).
 * Named columns only: the address, the IP and the user agent are never selected, `agreement_text` is selected only by
 * `readStoredAgreement` below (for the signed PDF, when the rebuilt text no longer matches), and nothing here logs.
 */

export type SignatureRecord = {
  id: string;
  signerName: string;
  signedAt: string;
  fingerprint: string;
  entityName: string | null;
  signerTitle: string | null;
  templateVersion: number | null;
};

export type SignatureRead = { status: "ok"; signature: SignatureRecord } | { status: "none" } | { status: "unavailable" };

const COLUMNS = "id, signer_name, signed_at, agreement_sha256, entity_name, signer_title, template_version";

export async function readSignature(db: SupabaseClient<Database>, proposalId: string): Promise<SignatureRead> {
  try {
    const { data, error } = await db
      .from("client_proposal_signature")
      .select(COLUMNS)
      .eq("proposal_id", proposalId)
      .order("signed_at", { ascending: false })
      .limit(1);
    if (error) return { status: "unavailable" };
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return { status: "none" };
    const r = row as unknown as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.signer_name !== "string" || typeof r.signed_at !== "string" || typeof r.agreement_sha256 !== "string") return { status: "unavailable" };
    return {
      status: "ok",
      signature: {
        id: r.id,
        signerName: r.signer_name,
        signedAt: r.signed_at,
        fingerprint: r.agreement_sha256,
        entityName: typeof r.entity_name === "string" ? r.entity_name : null,
        signerTitle: typeof r.signer_title === "string" ? r.signer_title : null,
        templateVersion: typeof r.template_version === "number" ? r.template_version : null,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

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
