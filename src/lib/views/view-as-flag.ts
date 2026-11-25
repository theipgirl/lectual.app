import "server-only";
import { cookies } from "next/headers";
import { getScopedClient } from "@/lib/db/scoped-client";
import { loadFirmSessionCore } from "@/lib/firm/session";
import { perRequest } from "@/lib/views/request-memo";
import { PREVIEW_OFF, VIEW_AS_COOKIE, flagOf, isRealOwner, stateFromRpc, type PreviewFlag, type PreviewState } from "@/lib/views/view-as-rules";

/**
 * Whether this request is inside an owner's View as preview. The DATABASE is the sole authority (0117's
 * `owner_view_as_state()`); no cookie decides anything. Read at most once per request (page, action or route handler) and
 * only for a REAL owner (an owner crm_org_member row in this firm, read by resolveFirmSession on every request anyway):
 * non-owners make no read, so a 0117 outage never touches them.
 *
 * This module carries the FLAG only, never the viewer (src/lib/views/view-as.ts): the write block (preview-safe.ts and the
 * database net in getScopedClient) reads it, and server actions and route handlers may import it.
 *
 *   on        an open preview for this owner, this sign-in and this firm
 *   off       not a real owner, signed out, or no open preview
 *   not-set-up 0117 (or 0116's guard) is not on the database: nothing is offered
 *   unknown   writes are refused until a refresh: a real owner whose state couldn't be read, an errored read for someone
 *             who could be a real owner (the membership read failed, or an owner row with a failed firm or platform-admin
 *             read; a non-owner row read fine is never blocked by such a hiccup), and, while the hint cookie is present, an auth-server failure or a
 *             session that couldn't be resolved at all (without the cookie those read as off, so an auth outage doesn't lock
 *             every person out)
 */
export function readPreviewState(): Promise<PreviewState> {
  return perRequest("view-as-state", readStateOnce);
}

export async function previewFlag(): Promise<PreviewFlag> {
  return flagOf(await readPreviewState());
}

async function readStateOnce(): Promise<PreviewState> {
  // The hint cookie never turns a preview ON. It only decides how a failure we can't attribute reads: a session that
  // couldn't be resolved at all, or an auth-server failure, is "unknown" (writes refused) while the cookie says a preview
  // may be open, and "off" without it, so an auth outage doesn't lock every person out of every write.
  const hinted = await hasHintCookie();
  let core: Awaited<ReturnType<typeof loadFirmSessionCore>>;
  try {
    core = await loadFirmSessionCore();
  } catch {
    return hinted ? { kind: "unknown" } : PREVIEW_OFF;
  }
  if (core.kind === "signed-out") return core.authFailed && hinted ? { kind: "unknown" } : PREVIEW_OFF;
  // An errored read for someone who could be a real owner (the membership read failed, or an owner row with a failed firm
  // or platform-admin read): we can't tell whether a preview is open. A platform admin who is a real owner reads as staff
  // with no row when the membership read fails, which must not read as "off". A non-owner row read fine is "off".
  if (core.kind === "no-access") return core.memberReadFailed ? { kind: "unknown" } : PREVIEW_OFF;
  if (core.readFailed) return { kind: "unknown" };
  if (!isRealOwner({ userId: core.user.id, orgId: core.org.id, member: core.member })) return PREVIEW_OFF;
  try {
    const supabase = await getScopedClient();
    const result = await supabase.rpc("owner_view_as_state" as never);
    return stateFromRpc(result as { data: unknown; error: { code?: string; message?: string } | null });
  } catch {
    return { kind: "unknown" };
  }
}

async function hasHintCookie(): Promise<boolean> {
  try {
    return Boolean((await cookies()).get(VIEW_AS_COOKIE)?.value);
  } catch {
    return false;
  }
}
