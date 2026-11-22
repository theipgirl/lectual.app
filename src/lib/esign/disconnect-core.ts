import type { AdobeAccess, AgreementStatus } from "./adobe-client";
import type { AdobeAccessResult, AdobeConnection, AdobeConnectionRead } from "./adobe-connection";

/**
 * Disconnect Adobe Acrobat Sign: the ordered core (Sprint 5a, contract item 3; D6), every dependency injected. The wiring is
 * `disconnect.ts`; the action re-resolves the admin tier BEFORE either runs. See `disconnect.ts` for the order and the seam.
 */

export type OpenRequestRow = { id: string; status: "creating" | "out_for_signature"; agreementId: string | null };

export type DisconnectDeps = {
  readConnection: () => Promise<AdobeConnectionRead>;
  loadAccess: (conn: AdobeConnection) => Promise<AdobeAccessResult>;
  listOpen: (orgId: string) => Promise<OpenRequestRow[] | null>;
  readStatus: (access: AdobeAccess, agreementId: string) => Promise<AgreementStatus>;
  cancel: (access: AdobeAccess, agreementId: string) => Promise<void>;
  /** Sprint 5b: complete one SIGNED request; resolves with whether its signed files were stored. */
  complete?: (req: OpenRequestRow) => Promise<{ files: "stored" | "not_stored" }>;
  closeRequest: (orgId: string, req: OpenRequestRow, patch: Record<string, unknown>) => Promise<number>;
  markRevoked: (conn: AdobeConnection) => Promise<boolean>;
  revokeAtAdobe: (accessPoint: string, refreshToken: string) => Promise<boolean>;
  deleteRow: (conn: AdobeConnection) => Promise<boolean>;
};

export type DisconnectResult =
  | { ok: true; cancelFailed: number; signedNotCopied: number; revokedAtAdobe: boolean }
  | { ok: false; reason: "read" | "permission" | "delete" };

const CLOSED_BY_ADOBE: Partial<Record<AgreementStatus, string>> = { CANCELLED: "cancelled", EXPIRED: "expired", DECLINED: "declined" };

export async function runDisconnectAdobe(deps: DisconnectDeps): Promise<DisconnectResult> {
  const read = await deps.readConnection();
  if (read.state === "not-set-up") return { ok: true, cancelFailed: 0, signedNotCopied: 0, revokedAtAdobe: false };
  if (read.state !== "ok") return { ok: false, reason: "read" };
  const conn = read.connection;
  if (!conn) return { ok: true, cancelFailed: 0, signedNotCopied: 0, revokedAtAdobe: false };

  const access = await deps.loadAccess(conn);
  const acc: AdobeAccess | null = access.kind === "ok" ? { accessPoint: access.accessPoint, accessToken: access.accessToken } : null;

  let cancelFailed = 0;
  let signedNotCopied = 0;
  // A list we couldn't read is never "nothing open": stop before anything changes.
  const open = await deps.listOpen(conn.org_id);
  if (open === null) return { ok: false, reason: "read" };
  for (const req of open) {
    if (!req.agreementId) {
      await deps.closeRequest(conn.org_id, req, { status: "cancelled" });
      continue;
    }
    if (!acc) {
      cancelFailed += 1;
      await deps.closeRequest(conn.org_id, req, { status: "cancelled", cancel_failed: true });
      continue;
    }
    let status: AgreementStatus;
    try {
      status = await deps.readStatus(acc, req.agreementId);
    } catch {
      // A failed re-read is a failed cancel, never "signed".
      cancelFailed += 1;
      await deps.closeRequest(conn.org_id, req, { status: "cancelled", cancel_failed: true });
      continue;
    }
    if (status === "SIGNED") {
      if (!deps.complete) {
        signedNotCopied += 1;
        continue;
      }
      try {
        const done = await deps.complete(req);
        if (done.files !== "stored") signedNotCopied += 1;
      } catch {
        signedNotCopied += 1;
      }
      continue;
    }
    const closedAs = CLOSED_BY_ADOBE[status];
    if (closedAs) {
      await deps.closeRequest(conn.org_id, req, { status: closedAs });
      continue;
    }
    try {
      await deps.cancel(acc, req.agreementId);
      await deps.closeRequest(conn.org_id, req, { status: "cancelled" });
    } catch {
      cancelFailed += 1;
      await deps.closeRequest(conn.org_id, req, { status: "cancelled", cancel_failed: true });
    }
  }

  if (!(await deps.markRevoked(conn))) return { ok: false, reason: "permission" };

  // Anything opened while step 3 ran.
  for (const req of (await deps.listOpen(conn.org_id)) ?? []) {
    await deps.closeRequest(conn.org_id, req, { status: "cancelled", cancel_failed: true });
  }

  const revokedAtAdobe = access.kind === "ok" ? await deps.revokeAtAdobe(access.accessPoint, access.refreshToken) : false;
  if (!(await deps.deleteRow(conn))) return { ok: false, reason: "delete" };
  return { ok: true, cancelFailed, signedNotCopied, revokedAtAdobe };
}

