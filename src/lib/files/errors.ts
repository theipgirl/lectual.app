/**
 * Reading the errors storage and the table hand back. Nothing here returns
 * their text to a person: the actions show a fixed sentence (FILE_MESSAGES) and
 * the server log carries a CODE only, never a message, a path or an org id.
 */

type Failure = { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown } | null | undefined;

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** "crm_file is not in this database" (PGRST205 / Postgres 42P01), judged on the CODE; the message only when there is no code. */
export function isMissingTableError(error: Failure): boolean {
  if (!error) return false;
  const code = text(error.code);
  if (code) return code === "PGRST205" || code === "42P01";
  return /could not find the table|schema cache|relation .* does not exist/i.test(text(error.message));
}

/** Storage says the client-files bucket does not exist. */
export function isBucketMissingError(error: Failure): boolean {
  return !!error && /bucket not found/i.test(text(error.message));
}

/** Storage says the OBJECT is not there (not the bucket). Removing an object that is already gone counts as removed. */
export function isObjectMissingError(error: Failure): boolean {
  if (!error || isBucketMissingError(error)) return false;
  const status = String(error.statusCode ?? error.status ?? "");
  return /object not found|not[ _-]found/i.test(text(error.message)) || status === "404";
}

/** A short, safe token for the server log: the code or status, never the message. */
export function errorCodeOf(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const e = error as Failure;
  return text(e?.code) || String(e?.statusCode ?? e?.status ?? "") || "unknown";
}

export function logFileFailure(where: string, error: unknown): void {
  console.error(`[files] ${where} failed (code ${errorCodeOf(error)})`);
}
