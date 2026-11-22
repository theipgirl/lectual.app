import "server-only";

import { getAdminClient } from "@/lib/db/admin";
import { adobeClientSigningOn, adobeSignSetup } from "./adobe-config";
import { OPEN_REQUEST_STATUSES, isNotSetUpError, stuckCutoff, type EsignDb } from "./db";
import { decideSigningPath, type OpenRequestFact, type PathFacts, type SigningPathKind } from "./path-rules";

/**
 * The reads behind `decideSigningPath` for one live proposal version, as the service role, every statement FENCED on the
 * proposal row's own `org_id` (from the token's read, never the browser). Every status change is fenced on the expected
 * from-status (and, for a stuck row, on `created_at < now() - 10 min`). A missing 0113 table answers in-app.
 *
 * Nothing here calls Adobe. Never throws: anything unexpected is in-app.
 */

export type ProposalRef = { proposalId: string; orgId: string };

export async function closeStuckCreating(db: EsignDb, ref: ProposalRef, now: Date): Promise<"ok" | "not-set-up" | "failed"> {
  try {
    const { error } = await db
      .from("client_proposal_esign_request")
      .update({ status: "failed", last_error: "creation_interrupted" })
      .eq("proposal_id", ref.proposalId)
      .eq("org_id", ref.orgId)
      .eq("status", "creating")
      .lt("created_at", stuckCutoff(now));
    if (error) return isNotSetUpError(error) ? "not-set-up" : "failed";
    return "ok";
  } catch {
    return "failed";
  }
}

export async function readOpenRequest(db: EsignDb, ref: ProposalRef): Promise<PathFacts["requests"]> {
  try {
    const { data, error } = await db
      .from("client_proposal_esign_request")
      .select("id, status, connection_id")
      .eq("proposal_id", ref.proposalId)
      .eq("org_id", ref.orgId)
      .in("status", OPEN_REQUEST_STATUSES);
    if (error) return isNotSetUpError(error) ? { state: "not-set-up" } : { state: "unavailable" };
    const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const row = rows[0];
    if (!row) return { state: "ok", open: null };
    if (typeof row.id !== "string" || (row.status !== "creating" && row.status !== "out_for_signature")) return { state: "unavailable" };
    const open: OpenRequestFact = { id: row.id, status: row.status, connectionId: typeof row.connection_id === "string" ? row.connection_id : null };
    return { state: "ok", open };
  } catch {
    return { state: "unavailable" };
  }
}

export async function readConnectionFact(db: EsignDb, orgId: string): Promise<PathFacts["connection"]> {
  try {
    // Status only: never a sealed column.
    const { data, error } = await db.from("adobe_sign_connection").select("id, org_id, status").eq("org_id", orgId).maybeSingle();
    if (error) return isNotSetUpError(error) ? { state: "not-set-up" } : { state: "unavailable" };
    const row = data as Record<string, unknown> | null;
    if (!row) return { state: "ok", id: null, status: null };
    if (row.org_id !== orgId || typeof row.id !== "string") return { state: "unavailable" };
    const status = row.status === "active" || row.status === "reauth" || row.status === "revoked" ? row.status : null;
    if (!status) return { state: "unavailable" };
    return { state: "ok", id: row.id, status };
  } catch {
    return { state: "unavailable" };
  }
}

/** Closes an open request whose connection is gone, fenced on its from-status. Never thrown. */
export async function closeOrphanedRequest(db: EsignDb, ref: ProposalRef, open: OpenRequestFact): Promise<void> {
  try {
    await db
      .from("client_proposal_esign_request")
      .update({ status: "cancelled", cancel_failed: true })
      .eq("id", open.id)
      .eq("org_id", ref.orgId)
      .eq("status", open.status);
  } catch {
    // The sweep (5b) closes it next time.
  }
}

export async function loadSigningPath(input: { db: EsignDb; ref: ProposalRef; now: Date; switchOn: boolean; setupReady: boolean }): Promise<SigningPathKind> {
  try {
    const closed = await closeStuckCreating(input.db, input.ref, input.now);
    if (closed === "not-set-up") return "in_app";
    const [requests, connection] = await Promise.all([readOpenRequest(input.db, input.ref), readConnectionFact(input.db, input.ref.orgId)]);
    const decision = decideSigningPath({ setupReady: input.setupReady, switchOn: input.switchOn, requests, connection });
    if (decision.close) await closeOrphanedRequest(input.db, input.ref, decision.close);
    return decision.kind;
  } catch {
    return "in_app";
  }
}

/** The page's read for a live letter proposal. Service role, fenced on the proposal row's org. */
export async function signingPathFor(ref: ProposalRef, now: Date): Promise<SigningPathKind> {
  let db: EsignDb;
  try {
    db = getAdminClient() as unknown as EsignDb;
  } catch {
    return "in_app";
  }
  return loadSigningPath({ db, ref, now, switchOn: adobeClientSigningOn(), setupReady: adobeSignSetup().ready });
}

/**
 * The in-app accept's own check (the page refuses in-app while a request is open; lectual 0113's amended
 * `client_proposal_sign_and_accept` refuses it too). "open" only on a read that worked and found one: a failed or missing read
 * leaves the decision to the database.
 */
export async function inAppBlockedByOpenRequest(ref: ProposalRef, db?: EsignDb): Promise<boolean> {
  try {
    const client = db ?? (getAdminClient() as unknown as EsignDb);
    const read = await readOpenRequest(client, ref);
    return read.state === "ok" && read.open !== null;
  } catch {
    return false;
  }
}
