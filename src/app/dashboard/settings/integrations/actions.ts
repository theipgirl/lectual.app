"use server";

import { refresh } from "next/cache";
import { orgHasModule } from "@/lib/org/modules";
import { rootKeyOrNull } from "@/lib/mailbox/config";
import { disconnect } from "@/lib/mailbox/connections";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { disconnectAdobeSign } from "@/lib/esign/disconnect";
import {
  ADOBE_DISCONNECTED,
  ADOBE_DISCONNECT_FAILED,
  ADOBE_DISCONNECT_FORBIDDEN,
  ADOBE_DISCONNECT_READ_FAILED,
  adobeCancelFailedLine,
  adobeNotCopiedLine,
} from "@/lib/ui/words";

export type DisconnectState = { ok?: boolean; error?: string; revoked?: boolean };

/**
 * A server action is its own POST entry point and never renders the page's
 * guard, so the module check is repeated here (AGENTS.md "Gate the PAGE and
 * the ACTION"). Who may remove WHICH mailbox is left to RLS: disconnect()
 * deletes through the caller's scoped client and reports 0 rows as refused.
 */
export async function disconnectMailboxAction(
  _prev: DisconnectState,
  formData: FormData,
): Promise<DisconnectState> {
  if (!(await orgHasModule("mailbox"))) return { error: "Not available." };
  const id = String(formData.get("id") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: "Unknown mailbox." };

  const result = await disconnect({ root: rootKeyOrNull(), id });
  if (!result.ok) return { error: result.message };
  refresh();
  return { ok: true, revoked: result.revoked };
}

export type AdobeDisconnectState = { ok?: boolean; error?: string; lines?: string[] };

/**
 * Disconnect Adobe Acrobat Sign (Sprint 5a, contract item 3). Its own POST entry point: the admin tier is re-resolved HERE,
 * before anything is read. The work (cancel open letters at Adobe, revoke, delete) is `disconnectAdobeSign`, which uses the
 * caller's scoped client for the row and the service role only fenced on that row's (id, org_id). Fixed sentences only.
 */
export async function disconnectAdobeAction(): Promise<AdobeDisconnectState> {
  try {
    const session = await resolveFirmSession();
    if (session.kind !== "ok" || !hasRole(session.role, "senior_admin")) return { error: ADOBE_DISCONNECT_FORBIDDEN };
    const r = await disconnectAdobeSign();
    if (!r.ok) return { error: r.reason === "read" ? ADOBE_DISCONNECT_READ_FAILED : r.reason === "permission" ? ADOBE_DISCONNECT_FORBIDDEN : ADOBE_DISCONNECT_FAILED };
    const lines = [ADOBE_DISCONNECTED];
    if (r.cancelFailed > 0) lines.push(adobeCancelFailedLine(r.cancelFailed));
    if (r.signedNotCopied > 0) lines.push(adobeNotCopiedLine(r.signedNotCopied));
    refresh();
    return { ok: true, lines };
  } catch {
    return { error: ADOBE_DISCONNECT_FAILED };
  }
}
