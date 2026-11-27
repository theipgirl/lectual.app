/**
 * Reads the answer of lectual 0108's `mailbox_connections_for_owner()`. Pure (no server imports), so it is tested without a database.
 * Only the six named columns survive: a row is rebuilt field by field, so a function that ever returned more (a token, a scope
 * list, a sync cursor, an error text) could not reach the page through here.
 */
export type ColleagueMailbox = {
  id: string;
  userId: string | null;
  scope: "personal" | "firm";
  provider: "google" | "microsoft";
  email: string;
  status: "active" | "reauth" | "error" | "revoked";
};

export type ColleagueMailboxes =
  | { kind: "ok"; rows: ColleagueMailbox[] }
  /** 0108 is not applied to this database (42883 / PGRST202 by code). */
  | { kind: "not-switched-on" }
  /** The caller is not an owner: the function is not called. */
  | { kind: "not-asked" }
  /** Refused, failed or unreadable. Never "not connected". */
  | { kind: "unavailable" };

const PROVIDERS = ["google", "microsoft"] as const;
const SCOPES = ["personal", "firm"] as const;
const STATUSES = ["active", "reauth", "error", "revoked"] as const;

/** A missing function, by error CODE only (never by message text). */
export function isMissingOwnerFunction(error: { code?: string } | null | undefined): boolean {
  return !!error && (error.code === "42883" || error.code === "PGRST202");
}

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : null;
}

export function readColleagueRows(data: unknown, error: { code?: string } | null | undefined): ColleagueMailboxes {
  if (error) return isMissingOwnerFunction(error) ? { kind: "not-switched-on" } : { kind: "unavailable" };
  if (!Array.isArray(data)) return { kind: "unavailable" };
  const rows: ColleagueMailbox[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") return { kind: "unavailable" };
    const r = raw as Record<string, unknown>;
    const provider = oneOf(PROVIDERS, r.provider);
    const scope = oneOf(SCOPES, r.scope);
    const status = oneOf(STATUSES, r.status);
    if (typeof r.id !== "string" || !provider || !scope || !status || typeof r.email !== "string") return { kind: "unavailable" };
    rows.push({ id: r.id, userId: typeof r.user_id === "string" ? r.user_id : null, scope, provider, email: r.email, status });
  }
  return { kind: "ok", rows };
}
