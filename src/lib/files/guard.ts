import { getScopedClient } from "@/lib/db/scoped-client";
import { ROLES, type Role } from "@/lib/auth/roles";
import { logFileFailure } from "./errors";
import { FILE_MESSAGES, isFileParentKind, isUuid, type FileParentKind } from "./rules";

export type ScopedClient = Awaited<ReturnType<typeof getScopedClient>>;

/** What the browser sends to say which record a file belongs to. Validated again on the server. */
export type FileParentInput = { kind: FileParentKind; id: string };

export type Refusal = { ok: false; error: string; notSetUp?: boolean };

export function refuse(error: string, extra: { notSetUp?: boolean } = {}): Refusal {
  return { ok: false, error, ...extra };
}

/** A lead or matter reference that is the right shape. Anything else is "not found" with no database or storage call. */
export function parseParent(parent: unknown): FileParentInput | null {
  if (!parent || typeof parent !== "object") return null;
  const { kind, id } = parent as { kind?: unknown; id?: unknown };
  if (!isFileParentKind(kind) || !isUuid(id)) return null;
  return { kind, id };
}

function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/**
 * The session and the caller's role, resolved on EVERY call (never cached, so a
 * role revoked a moment ago takes effect on the next request). Fails closed: no
 * session, an unreadable role and a role outside `allowed` are all refusals.
 * RLS and the storage policies are the real boundary; this makes the refusal a
 * sentence instead of a Postgres or storage error.
 */
export async function authorize(
  supabase: ScopedClient,
  allowed: readonly Role[],
  notAllowed: string,
): Promise<{ ok: true; role: Role } | Refusal> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return refuse(FILE_MESSAGES.signedOut);
  } catch (err) {
    logFileFailure("read session", err);
    return refuse(FILE_MESSAGES.signedOut);
  }
  try {
    const { data, error } = await supabase.rpc("current_org_role");
    if (error || !isRole(data)) {
      if (error) logFileFailure("read role", error);
      return refuse(FILE_MESSAGES.roleUnknown);
    }
    if (!allowed.includes(data)) return refuse(notAllowed);
    return { ok: true, role: data };
  } catch (err) {
    logFileFailure("read role", err);
    return refuse(FILE_MESSAGES.roleUnknown);
  }
}

/**
 * Reads the parent lead or matter through the caller's scoped client and takes
 * `org_id` FROM THAT ROW. Another firm's id (or a deleted record) reads as no
 * row under RLS, which is "not found". Nothing from the browser can supply an org.
 */
export async function loadParentOrg(supabase: ScopedClient, parent: FileParentInput): Promise<{ ok: true; orgId: string } | Refusal> {
  const query =
    parent.kind === "lead"
      ? supabase.from("crm_lead").select("id, org_id").eq("id", parent.id).maybeSingle()
      : supabase.from("crm_matter").select("id, org_id").eq("id", parent.id).maybeSingle();
  const { data, error } = await query;
  if (error) {
    logFileFailure("read parent", error);
    return refuse(FILE_MESSAGES.generic);
  }
  if (!data || typeof data.org_id !== "string" || !data.org_id) return refuse(FILE_MESSAGES.notFound);
  return { ok: true, orgId: data.org_id };
}

/** The page whose list changes with a file, written the way the other actions write it. */
export function parentPath(parent: FileParentInput): string {
  return `/dashboard/${parent.kind === "lead" ? "leads" : "matters"}/${parent.id}/`;
}
