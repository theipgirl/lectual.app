import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { loadFirmSessionCore } from "@/lib/firm/session";
import { perRequest } from "@/lib/views/request-memo";
import { PREVIEW_OFF, flagOf, isRealOwner, stateFromRpc, type PreviewFlag, type PreviewState } from "@/lib/views/view-as-rules";

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
 *   unknown   a real owner whose state couldn't be read: writes are refused until a refresh
 */
export function readPreviewState(): Promise<PreviewState> {
  return perRequest("view-as-state", readStateOnce);
}

export async function previewFlag(): Promise<PreviewFlag> {
  return flagOf(await readPreviewState());
}

async function readStateOnce(): Promise<PreviewState> {
  let core: Awaited<ReturnType<typeof loadFirmSessionCore>>;
  try {
    core = await loadFirmSessionCore();
  } catch {
    // The session itself could not be resolved (no request, or the client could not be built): nobody is established as
    // an owner, so there is no preview to read. The action's own reads fail the same way.
    return PREVIEW_OFF;
  }
  if (core.kind === "signed-out") return PREVIEW_OFF;
  if (core.kind === "no-access") return core.memberReadFailed ? { kind: "unknown" } : PREVIEW_OFF;
  if (!isRealOwner({ userId: core.user.id, orgId: core.org.id, member: core.member })) return PREVIEW_OFF;
  try {
    const supabase = await getScopedClient();
    const result = await supabase.rpc("owner_view_as_state" as never);
    return stateFromRpc(result as { data: unknown; error: { code?: string; message?: string } | null });
  } catch {
    return { kind: "unknown" };
  }
}
