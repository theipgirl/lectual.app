// Plain module (NOT "use server"): a "use server" file may only export async
// functions, so the shared refusal and error helper live here.

export type ActionState = { error?: string; saved?: boolean };

/**
 * The one refusal every quote action returns to a caller below attorney. Same
 * shape as any other failure, so the form renders it inline instead of a
 * thrown digest.
 *
 * `lectual` said "limited to owners, admins, and senior admins" while its gate
 * (`callerHasRole("attorney")`) also admits the attorney — the copy now names
 * the four roles the gate actually lets through.
 */
export const NOT_ENTITLED: ActionState = {
  error: "Quotes are built by the firm's owners, admins, senior admins and attorneys.",
};

/**
 * Turns a quote write failure into something safe to show — the same rule as
 * `friendlyMatterError`. `lectual`'s quote actions returned `err.message` as-is,
 * which put raw PostgREST text on screen whenever the database refused. A
 * database error (anything carrying a `code`) never passes its message
 * through; the store's own refusals are plain Errors written to be read (the
 * USPTO-at-signing rule, "this quote is accepted and can no longer be edited",
 * the lost-race message), and those do.
 */
export function friendlyQuoteError(err: unknown, fallback: string): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    if (code === "42501") return "You don't have permission to do that.";
    if (code === "23514") return "That combination isn't allowed on a quote line. Check the kind, schedule and amount.";
    if (code === "23503") return "That record no longer exists. Refresh and try again.";
    if (code === "PGRST116") return "That quote couldn't be found. It may have been removed.";
    return fallback;
  }
  if (!(err instanceof Error)) return fallback;
  return err.message || fallback;
}
