import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { readColleagueRows, type ColleagueMailboxes } from "./colleague-rows";

/**
 * Which mailbox each colleague has connected: ADDRESS AND STATUS ONLY, for the firm OWNER (Taylor, Nov 17, T7).
 *
 * A colleague's personal mailbox is invisible to everyone else by RLS (lectual 0075). Owners see it through lectual 0108's
 * `mailbox_connections_for_owner()`, a SECURITY DEFINER function that returns six columns and ONLY for an owner of the
 * caller's active org. It is called with the caller's scoped client (never the service role), and ONLY for role `owner`:
 * any other role makes no call at all and keeps today's "Only <name> can see this".
 *
 * The migration lives in the `lectual` repo and may not be applied yet. A missing function (42883 / PGRST202, by CODE)
 * is "not switched on yet"; any other failure is "couldn't check", never "not connected".
 */
export async function loadColleagueMailboxes(role: string | null | undefined): Promise<ColleagueMailboxes> {
  if (role !== "owner") return { kind: "not-asked" };
  try {
    const db = await getScopedClient();
    const untyped = db as unknown as { rpc: (name: string, args: undefined, options: { get: true }) => PromiseLike<{ data: unknown; error: { code?: string } | null }> };
    // A read (STABLE): GET, so it passes View as's database net.
    const { data, error } = await untyped.rpc("mailbox_connections_for_owner", undefined, { get: true });
    return readColleagueRows(data, error);
  } catch {
    return { kind: "unavailable" };
  }
}
