import "server-only";

import { getAdminClient } from "@/lib/db/admin";
import { getScopedClient } from "@/lib/db/scoped-client";
import { adobeSignSetup } from "./adobe-config";
import { cancelAgreement, readAgreementStatus } from "./adobe-client";
import { loadAdobeAccess, readAdobeConnection } from "./adobe-connection";
import { runDisconnectAdobe, type DisconnectResult, type OpenRequestRow } from "./disconnect-core";

export type { DisconnectResult } from "./disconnect-core";
import { revokeAdobeToken } from "./adobe-oauth";
import { OPEN_REQUEST_STATUSES, type EsignDb } from "./db";

/**
 * Disconnect Adobe Acrobat Sign (Sprint 5a, contract item 3; D6). The action re-resolves the admin tier BEFORE this runs. Order:
 *   1. scoped read of the firm's row;
 *   2. service-role read of the sealed token, fenced on THAT (id, org_id);
 *   3. for each open request: re-read the agreement. SIGNED → the one completion path (`complete`, Sprint 5b; awaited, with its
 *      `adobe_signed_files` step, before step 4); otherwise cancel at Adobe with the cancellation email off, then `cancelled`.
 *      A `creating` row with no agreement → `cancelled`. A refused or unreachable cancel, OR a re-read that fails (never taken as
 *      signed), → `cancelled` with `cancel_failed`;
 *   4. scoped update to `revoked` (0113's trigger clears both secrets): the permission check;
 *   5. re-list the open requests and close any found (one opened during step 3), `cancelled` + `cancel_failed`;
 *   6. revoke at Adobe; 7. delete the row (requests keep theirs; `connection_id` becomes null).
 * Every request status change is fenced on its from-status. Known limit: once revoked, nothing watches those agreements.
 *
 * SEAM (5a): `complete` is Sprint 5b's completion path. Until it exists, a request Adobe reports SIGNED is counted as "in your
 * Adobe account, not copied into Lectual" and closed at step 5 like any other open request.
 */

/* ─────────────────────────────── production wiring ─────────────────────────────── */

async function listOpenFor(admin: EsignDb, orgId: string): Promise<OpenRequestRow[] | null> {
  try {
    const { data, error } = await admin
      .from("client_proposal_esign_request")
      .select("id, status, adobe_agreement_id")
      .eq("org_id", orgId)
      .in("status", OPEN_REQUEST_STATUSES);
    if (error || !Array.isArray(data)) return null;
    return (data as Record<string, unknown>[])
      .filter((r) => typeof r.id === "string" && (r.status === "creating" || r.status === "out_for_signature"))
      .map((r) => ({ id: String(r.id), status: r.status as OpenRequestRow["status"], agreementId: typeof r.adobe_agreement_id === "string" ? r.adobe_agreement_id : null }));
  } catch {
    return null;
  }
}

/** The signed-in admin's disconnect. Scoped client for the row; the service role only fenced on the row's (id, org_id). */
export async function disconnectAdobeSign(): Promise<DisconnectResult> {
  const scoped = (await getScopedClient()) as unknown as EsignDb;
  const admin = getAdminClient() as unknown as EsignDb;
  const setup = adobeSignSetup();
  const fetchImpl = globalThis.fetch.bind(globalThis);
  return runDisconnectAdobe({
    readConnection: () => readAdobeConnection(scoped),
    loadAccess: async (conn) =>
      setup.ready ? loadAdobeAccess({ db: admin, orgId: conn.org_id, connectionId: conn.id, root: setup.root, creds: setup.creds }) : { kind: "unavailable" },
    listOpen: (orgId) => listOpenFor(admin, orgId),
    readStatus: (access, id) => readAgreementStatus(fetchImpl, access, id),
    cancel: (access, id) => cancelAgreement(fetchImpl, access, id),
    closeRequest: async (orgId, req, patch) => {
      try {
        const { data } = await admin.from("client_proposal_esign_request").update(patch).eq("id", req.id).eq("org_id", orgId).eq("status", req.status).select("id");
        return Array.isArray(data) ? data.length : 0;
      } catch {
        return 0;
      }
    },
    markRevoked: async (conn) => {
      try {
        const { data, error } = await scoped
          .from("adobe_sign_connection")
          .update({ status: "revoked" })
          .eq("id", conn.id)
          .select("id");
        return !error && Array.isArray(data) && data.length > 0;
      } catch {
        return false;
      }
    },
    revokeAtAdobe: (accessPoint, token) => revokeAdobeToken({ accessPoint, token, fetchImpl }),
    deleteRow: async (conn) => {
      try {
        const { error } = await scoped.from("adobe_sign_connection").delete().eq("id", conn.id);
        return !error;
      } catch {
        return false;
      }
    },
  });
}
