/**
 * Who may change a view's structure: an OWNER, by the caller's own membership ROW in the active firm (the 0116 pattern), never by the role
 * claim in the token. Lectual staff acting inside a firm they don't belong to have no membership row and are never owners here
 * (`actingAsStaff`, from `resolveFirmSession`, is checked first and the row isn't even read for them). Pure over an injected client, so it
 * is tested with fakes; `loadIsOwner` (owner-load.ts) is the page's one call.
 *
 * Three states, and anything unreadable is NOT owner: `owner`, `not-owner`, `unreadable` (a read that errored). The page draws structure
 * controls only for `owner`, and every structure action will ask again on the server (build step 3).
 */
export type OwnerState = "owner" | "not-owner" | "unreadable";

type Answer = { data: unknown; error: unknown };
type MemberClient = {
  from(table: string): { select(columns: string): { eq(column: string, value: unknown): { eq(column: string, value: unknown): { maybeSingle(): PromiseLike<Answer> } } } };
};

export const isOwner = (state: OwnerState): boolean => state === "owner";

export async function ownerState(input: { db: unknown; userId: string | null | undefined; orgId: string | null | undefined; actingAsStaff: boolean }): Promise<OwnerState> {
  // Lectual staff inside a firm: never an owner of it, whatever claim their token carries. No read.
  if (input.actingAsStaff !== false) return "not-owner";
  if (!input.userId || !input.orgId) return "not-owner";
  try {
    const { data, error } = await (input.db as MemberClient).from("crm_org_member").select("role").eq("user_id", input.userId).eq("org_id", input.orgId).maybeSingle();
    if (error) return "unreadable";
    if (data === null || data === undefined) return "not-owner";
    if (typeof data !== "object" || Array.isArray(data)) return "unreadable";
    const role = (data as { role?: unknown }).role;
    return role === "owner" ? "owner" : "not-owner";
  } catch {
    return "unreadable";
  }
}
