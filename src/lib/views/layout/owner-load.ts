import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { loadFirmSessionCore } from "@/lib/firm/session";
import { ownerState, type OwnerState } from "./owner";

/**
 * Whether the person asking is an owner of the firm they are standing in: the session (once per request), then their own membership row
 * through the scoped client. A signed-out or no-access person, a Lectual staff member acting inside a firm, a failed read: not an owner.
 */
export async function loadOwnerState(): Promise<OwnerState> {
  try {
    const session = await loadFirmSessionCore();
    if (session.kind !== "ok") return "not-owner";
    return await ownerState({ db: await getScopedClient(), userId: session.user.id, orgId: session.org.id, actingAsStaff: session.actingAsStaff });
  } catch {
    return "unreadable";
  }
}
