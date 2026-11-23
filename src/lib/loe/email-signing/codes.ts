/**
 * Error codes the emailed-signing path judges by. CODE only, never message text: "lectual 0117 is not (fully) applied" is a
 * missing table (42P01 / PostgREST PGRST205) or a missing function (42883 / PostgREST PGRST202). Pure.
 */

type ErrorLike = { code?: unknown; message?: unknown } | null | undefined;

export const MISSING_OBJECT_CODES: readonly string[] = ["42P01", "PGRST205", "42883", "PGRST202"];

const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** 0117 (or one of its objects) is not there. */
export function isMissingObjectError(error: ErrorLike): boolean {
  return !!error && MISSING_OBJECT_CODES.includes(text(error.code));
}

/** Postgres reported a deadlock (the transaction was rolled back whole). */
export function isDeadlock(error: ErrorLike): boolean {
  return !!error && text(error.code) === "40P01";
}

/** Whether 0117's raised message starts with this stable prefix (the text after it is never shown). */
export function hasPrefix(error: ErrorLike, prefix: string): boolean {
  return !!error && text(error.message).startsWith(prefix);
}
