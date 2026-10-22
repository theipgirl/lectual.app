type DbError = { code?: string; message?: string } | null | undefined;

/**
 * The Outlook columns (lectual migration 0098) are not in this database yet:
 * Postgres says undefined_column (42703) and PostgREST says its schema cache
 * has no such column (PGRST204). The sync and every reader turn this into a
 * named "not available until the database update" state, never an empty list.
 */
export function isDatabaseUpdateNeeded(error: DbError): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column .* does not exist|could not find the .* column/i.test(error.message ?? "");
}
