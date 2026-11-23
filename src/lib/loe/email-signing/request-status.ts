import { SIGNING_LINK_STATE, SIGNING_LINK_UNREADABLE } from "@/lib/ui/words";
import { isMissingObjectError } from "./codes";
import { isObject } from "./db";
import { letterDateText, signedAtText } from "../signing";

/**
 * The newest signing request's state, for the staff proposal page (Sprint B). Pure rules plus one reader over a structural client
 * (the SCOPED client: 0117 grants the eight `SIGNATURE_READ_ROLES` these columns and nobody else). Granted columns only:
 * `id, status, closed_reason, sent_at, expires_at, opened_at, consent_at, signed_at, created_at`; never the address, the token hash
 * or any text. Three-state, judged by error CODE: a failed read is "couldn't be loaded", never "not sent"; 0117 missing draws nothing.
 */

export const REQUEST_STATUS_COLUMNS = "id, status, closed_reason, sent_at, expires_at, opened_at, consent_at, signed_at, created_at";

export type RequestStatusRow = {
  id: string;
  status: string;
  closed_reason: string | null;
  sent_at: string | null;
  expires_at: string | null;
  opened_at: string | null;
  consent_at: string | null;
  signed_at: string | null;
  created_at: string | null;
};

export type RequestStatusRead = { status: "ok"; request: RequestStatusRow | null } | { status: "not_set_up" } | { status: "unavailable" };

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function parseRequestStatus(row: unknown): RequestStatusRow | null {
  if (!isObject(row)) return null;
  const id = str(row.id);
  const status = str(row.status);
  if (!id || !status) return null;
  return {
    id,
    status,
    closed_reason: str(row.closed_reason),
    sent_at: str(row.sent_at),
    expires_at: str(row.expires_at),
    opened_at: str(row.opened_at),
    consent_at: str(row.consent_at),
    signed_at: str(row.signed_at),
    created_at: str(row.created_at),
  };
}

type Q = PromiseLike<{ data: unknown; error: { code?: string } | null }> & { eq(c: string, v: unknown): Q; order(c: string, o: { ascending: boolean }): Q; limit(n: number): Q };

/** The newest request of one proposal version. */
export async function readLatestRequest(db: { from(table: string): { select(columns: string): unknown } }, proposalId: string): Promise<RequestStatusRead> {
  try {
    const { data, error } = await (db.from("client_proposal_signing_request").select(REQUEST_STATUS_COLUMNS) as Q).eq("proposal_id", proposalId).order("created_at", { ascending: false }).limit(1);
    if (error) return isMissingObjectError(error) ? { status: "not_set_up" } : { status: "unavailable" };
    if (!Array.isArray(data)) return { status: "unavailable" };
    if (data.length === 0) return { status: "ok", request: null };
    const request = parseRequestStatus(data[0]);
    return request ? { status: "ok", request } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * The one line for a live version's Engagement letter card, or null (no request, or 0117 isn't there). `now` decides an open
 * request past its expiry (a request is only closed `expired` when someone opens it).
 */
export function requestStatusLine(read: RequestStatusRead | null, tz: string, now: Date): string | null {
  if (!read) return null;
  if (read.status === "unavailable") return SIGNING_LINK_UNREADABLE;
  if (read.status === "not_set_up" || !read.request) return null;
  const r = read.request;
  const at = (iso: string | null): string => (iso ? signedAtText(iso, tz) : "");
  const day = (iso: string | null): string => (iso && !Number.isNaN(new Date(iso).getTime()) ? letterDateText(new Date(iso), tz) : "");
  switch (r.status) {
    case "signed":
      return SIGNING_LINK_STATE.signed(at(r.signed_at)).trim();
    case "closed": {
      if (r.closed_reason === "expired") return SIGNING_LINK_STATE.expired(day(r.expires_at)).trim();
      const reasons = SIGNING_LINK_STATE.closed as Record<string, string>;
      return (r.closed_reason && reasons[r.closed_reason]) || SIGNING_LINK_STATE.closed.other;
    }
    case "sending":
      return SIGNING_LINK_STATE.sending;
    case "open": {
      const expires = r.expires_at ? Date.parse(r.expires_at) : Number.NaN;
      if (!Number.isNaN(expires) && expires <= now.getTime()) return SIGNING_LINK_STATE.expired(day(r.expires_at)).trim();
      if (r.consent_at) return SIGNING_LINK_STATE.consent(at(r.consent_at)).trim();
      if (r.opened_at) return SIGNING_LINK_STATE.opened(at(r.opened_at)).trim();
      return SIGNING_LINK_STATE.sent(at(r.sent_at)).trim();
    }
    default:
      return null;
  }
}
