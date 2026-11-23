import { isMissingObjectError } from "./codes";
import { parseEvent, parseRequest, type EvidenceRead } from "./evidence";

/**
 * The ONE reader of a signing request's evidence (Sprint B), for both paths: the public / follow-up path (the service role it is
 * handed, fenced on the proposal row's org) and the dashboard (the SCOPED client; 0117 grants the eight `SIGNATURE_READ_ROLES`
 * these columns and the events). It selects exactly the columns 0117 grants to `authenticated`, so the two paths read the same
 * set and a certificate is built from the same facts on both. NEVER `token_sha256`, `agreement_text`, `agreement_sha256`,
 * `consent_sha256`, `sent_to` of the request, the snapshot, the details or any other ungranted column (a grep test lists the
 * strings below).
 *
 * Three-state, judged by error CODE: the evidence / 0117 missing (42P01, PGRST205, 42883, PGRST202) / any other failure,
 * including an empty answer (a role the database hides the row from, or a request that is not there). Never logs.
 */

export const EVIDENCE_REQUEST_COLUMNS =
  "id, org_id, proposal_id, status, sent_at, opened_at, consent_at, signed_at, signature_id, words_version, copy_subject, copy_body";
export const EVIDENCE_EVENT_COLUMNS =
  "kind, at, ip, user_agent, sent_to, consent_sha256, signature_kind, signature_png, typed_style, signature_sha256, typed_name, agreement_sha256";

/** Structural: the service-role client, the scoped client and a test fake all fit. */
export type EvidenceDb = { from(table: string): { select(columns: string): unknown } };

type Q = PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }> & {
  eq(column: string, value: unknown): Q;
  order(column: string, options?: { ascending?: boolean }): Q;
  limit(count: number): Q;
};

const MAX_EVENTS = 50;

export async function readSigningEvidence(
  db: EvidenceDb,
  key: { proposalId: string; orgId: string; requestId: string | null | undefined },
): Promise<EvidenceRead> {
  try {
    if (!key.requestId) return "unavailable";
    const req = await (db.from("client_proposal_signing_request").select(EVIDENCE_REQUEST_COLUMNS) as Q)
      .eq("id", key.requestId)
      .eq("org_id", key.orgId)
      .eq("proposal_id", key.proposalId)
      .limit(1);
    if (req.error) return isMissingObjectError(req.error) ? "not_set_up" : "unavailable";
    const request = parseRequest(Array.isArray(req.data) ? req.data[0] : null);
    if (!request) return "unavailable";

    const ev = await (db.from("client_proposal_signing_event").select(EVIDENCE_EVENT_COLUMNS) as Q)
      .eq("request_id", request.id)
      .eq("org_id", key.orgId)
      .order("at", { ascending: true })
      .limit(MAX_EVENTS);
    if (ev.error) return isMissingObjectError(ev.error) ? "not_set_up" : "unavailable";
    if (!Array.isArray(ev.data)) return "unavailable";
    const events = ev.data.map(parseEvent);
    // A row the code cannot read makes the whole read unavailable (a certificate is never built from part of the record).
    if (events.some((e) => e === null)) return "unavailable";
    return { request, events: events as NonNullable<(typeof events)[number]>[] };
  } catch {
    return "unavailable";
  }
}
