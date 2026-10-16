// Plain module (NOT "use server"): a "use server" file may only export async
// functions, so this pure helper lives here and the actions import it.

const FORBIDDEN_COPY = "You don't have permission to do that. Ask an attorney or an admin.";

/**
 * Turns a matter write failure into something safe to show.
 *
 * lectual's matter actions returned `err.message` as-is, which put raw
 * PostgREST/RLS text on screen. Here a database error (anything carrying a
 * `code`) never passes its message through: a few codes map to something a
 * person can act on and the rest become `fallback`. Errors the app raises on
 * purpose (a bad date, a malformed class list, the role gate) are plain
 * Errors with no code, and their message was written to be read.
 */
export function friendlyMatterError(err: unknown, fallback: string): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    if (code === "42501") return FORBIDDEN_COPY;
    if (code === "23505") return "That matter number is already in use.";
    if (code === "23503") return "That stage or teammate no longer exists. Refresh and try again.";
    if (code === "23514") return "That value isn't allowed here.";
    if (code === "PGRST116") return "That record couldn't be found. It may have been removed.";
    return fallback;
  }
  if (!(err instanceof Error)) return fallback;
  if (/forbidden|permission|cannot write|not allowed/i.test(err.message)) return FORBIDDEN_COPY;
  return err.message || fallback;
}
