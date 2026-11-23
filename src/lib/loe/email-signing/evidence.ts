import { isObject } from "./db";

/**
 * What 0117 records about one emailed signing request, as the app reads it (Sprint B). Types and the pure reading rules only:
 * `evidence-read.ts` does the I/O. ONLY columns 0117 grants to `authenticated` appear here, so the service-role and the dashboard
 * paths read the same set and the certificate is built from the same facts on both (never `token_sha256`, `agreement_text`,
 * `agreement_sha256`, `consent_sha256` or `sent_to` of the REQUEST).
 */

export type EvidenceRequest = {
  id: string;
  org_id: string;
  proposal_id: string;
  status: string;
  sent_at: string | null;
  opened_at: string | null;
  consent_at: string | null;
  signed_at: string | null;
  signature_id: string | null;
  words_version: number | null;
  copy_subject: string;
  copy_body: string;
};

export type EvidenceKind = "sent" | "opened" | "consent" | "signature" | "signed" | "closed";

export type EvidenceEvent = {
  kind: EvidenceKind | string;
  at: string | null;
  ip: string | null;
  user_agent: string | null;
  sent_to: string | null;
  consent_sha256: string | null;
  signature_kind: string | null;
  /** The drawn PNG's bytes (parsed from PostgREST's `\x...` hex), or null. */
  signature_png: Uint8Array | null;
  typed_style: string | null;
  signature_sha256: string | null;
  typed_name: string | null;
  agreement_sha256: string | null;
};

export type SigningEvidence = { request: EvidenceRequest; events: EvidenceEvent[] };

/** The result every `readEvidence` answers: the evidence, 0117 missing (by code), or any other failure. */
export type EvidenceRead = SigningEvidence | "not_set_up" | "unavailable";

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** A `bytea` as PostgREST sends it (`\x` + hex), a Buffer or a Uint8Array. Null for anything else, or odd-length / non-hex text. */
export function bytesFrom(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return new Uint8Array(v);
  if (typeof v !== "string") return null;
  const m = /^\\x([0-9a-fA-F]*)$/.exec(v);
  if (!m || m[1].length % 2 !== 0) return null;
  return new Uint8Array(Buffer.from(m[1], "hex"));
}

export function parseRequest(row: unknown): EvidenceRequest | null {
  if (!isObject(row)) return null;
  const id = str(row.id);
  const org = str(row.org_id);
  const proposal = str(row.proposal_id);
  const status = str(row.status);
  if (!id || !org || !proposal || !status) return null;
  return {
    id,
    org_id: org,
    proposal_id: proposal,
    status,
    sent_at: str(row.sent_at),
    opened_at: str(row.opened_at),
    consent_at: str(row.consent_at),
    signed_at: str(row.signed_at),
    signature_id: str(row.signature_id),
    words_version: typeof row.words_version === "number" ? row.words_version : null,
    copy_subject: typeof row.copy_subject === "string" ? row.copy_subject : "",
    copy_body: typeof row.copy_body === "string" ? row.copy_body : "",
  };
}

export function parseEvent(row: unknown): EvidenceEvent | null {
  if (!isObject(row)) return null;
  const kind = str(row.kind);
  if (!kind) return null;
  return {
    kind,
    at: str(row.at),
    ip: str(row.ip),
    user_agent: str(row.user_agent),
    sent_to: str(row.sent_to),
    consent_sha256: str(row.consent_sha256),
    signature_kind: str(row.signature_kind),
    signature_png: bytesFrom(row.signature_png),
    typed_style: str(row.typed_style),
    signature_sha256: str(row.signature_sha256),
    typed_name: str(row.typed_name),
    agreement_sha256: str(row.agreement_sha256),
  };
}

/** The `sent` event's address: where the link went, and where the signed copy goes. Null unless exactly one `sent` event exists. */
export function sentToOf(events: readonly EvidenceEvent[]): string | null {
  const sent = events.filter((e) => e.kind === "sent");
  return sent.length === 1 ? sent[0].sent_to : null;
}
