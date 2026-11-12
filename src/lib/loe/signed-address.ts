import "server-only";

import { getScopedClient } from "@/lib/db/scoped-client";
import type { Role } from "@/lib/auth/roles";
import { addressBlock, cleanSigningDetails, emptyDetails } from "./signing";
import { canReadSignature } from "./signature-roles";

/**
 * The mailing address a client gave when they signed their engagement letter, for the staff lead and matter pages (aside, near the
 * contact details). Read from the NEWEST `client_proposal_signature` row of a proposal linked to the lead or matter, through the
 * caller's SCOPED client (RLS: the active firm's rows only, and only the staff roles in `signature-roles.ts` can read the table at
 * all). Named columns only: never `agreement_text`, the IP or the user agent.
 *
 * Three states, never two, plus "not asked":
 *   ok          the newest signed address (lines of text, and when it was signed);
 *   none        the read worked and there is no signed letter for this record (the card draws NOTHING);
 *   unavailable the read failed (one quiet line, never "no address");
 *   null        the role may not read signature records, so nothing was asked and nothing is drawn.
 * Nothing here logs: the address is privileged client content.
 */

export type SignedAddress = { lines: string[]; signedAt: string };
export type SignedAddressRead = { status: "ok"; address: SignedAddress } | { status: "none" } | { status: "unavailable" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** At most this many proposals are looked at for one record; far more than any lead or matter has. */
const PROPOSAL_CAP = 200;

/** The address column (jsonb object of text parts) as display lines, or null when it holds nothing usable. Pure. */
export function addressLinesOf(address: unknown): string[] | null {
  if (!address || typeof address !== "object" || Array.isArray(address)) return null;
  const d = cleanSigningDetails(address);
  const block = addressBlock({ ...emptyDetails(), street: d.street, street2: d.street2, city: d.city, region: d.region, postal: d.postal, country: d.country });
  const lines = block.split("\n").filter((l) => l.trim().length > 0);
  return lines.length > 0 ? lines : null;
}

type Query = {
  select(columns: string): Query;
  eq(column: string, value: string): Query;
  or(filter: string): Query;
  in(column: string, values: string[]): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(n: number): PromiseLike<{ data: unknown; error: unknown }>;
};
export type AddressDb = { from(table: string): unknown };

export async function readSignedAddress(db: AddressDb, link: { leadId?: string | null; matterId?: string | null }): Promise<SignedAddressRead> {
  try {
    const lead = typeof link.leadId === "string" && UUID.test(link.leadId) ? link.leadId : null;
    const matter = typeof link.matterId === "string" && UUID.test(link.matterId) ? link.matterId : null;
    if (!lead && !matter) return { status: "none" };
    // A proposal linked to this matter, or to the lead the matter came from (ids were checked above, so nothing else reaches the filter).
    const clauses = [matter ? `matter_id.eq.${matter}` : null, lead ? `lead_id.eq.${lead}` : null].filter((c): c is string => c !== null);
    const proposals = await (db.from("client_proposal") as unknown as Query).select("id").or(clauses.join(",")).limit(PROPOSAL_CAP);
    if (proposals.error) return { status: "unavailable" };
    const ids = (Array.isArray(proposals.data) ? proposals.data : [])
      .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>).id : null))
      .filter((v): v is string => typeof v === "string");
    if (ids.length === 0) return { status: "none" };

    const sigs = await (db.from("client_proposal_signature") as unknown as Query)
      .select("id, proposal_id, address, signed_at")
      .in("proposal_id", ids)
      .order("signed_at", { ascending: false })
      .limit(1);
    if (sigs.error) return { status: "unavailable" };
    const row = Array.isArray(sigs.data) ? sigs.data[0] : null;
    if (!row) return { status: "none" };
    const r = row as Record<string, unknown>;
    const lines = addressLinesOf(r.address);
    // A signature with no usable address (an older partial one) is "nothing to show", not a failure.
    if (!lines || typeof r.signed_at !== "string") return { status: "none" };
    return { status: "ok", address: { lines, signedAt: r.signed_at } };
  } catch {
    return { status: "unavailable" };
  }
}

/** The page's entry: null (not asked) for a role that may not read signature records. Never throws. */
export async function loadSignedAddress(role: Role | null | undefined, link: { leadId?: string | null; matterId?: string | null }): Promise<SignedAddressRead | null> {
  if (!canReadSignature(role)) return null;
  try {
    return await readSignedAddress((await getScopedClient()) as unknown as AddressDb, link);
  } catch {
    return { status: "unavailable" };
  }
}
