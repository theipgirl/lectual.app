// Plain module (NOT "use server"): a "use server" file may only export async
// functions, so the shared refusal/error helpers live here — same split as
// src/app/dashboard/quotes/errors.ts.

export type ActionState = { error?: string; saved?: boolean; message?: string };

/** Shown when a caller below the automation admin tier hits a config-write action. Mirrors AUTOMATION_ADMIN_ROLES (@/lib/automation/rules). */
export const NOT_ADMIN: ActionState = {
  error: "Campaigns are configured by the firm's owners, admins and senior admins.",
};

/** Shown when a caller outside the automation staff set hits an operational action (enroll, pause, run a step). Mirrors AUTOMATION_STAFF_ROLES. */
export const NOT_STAFF: ActionState = {
  error: "You don't have permission to do this.",
};

/**
 * Turns a campaign write failure into something safe to show.
 *
 * `drips.ts` and `advance.ts` already throw plain `Error`s written to be
 * read (the role-gate messages, "this lead has no email address", the
 * queue-not-configured message) — those pass through as-is. Only a raw
 * database error (anything carrying a `code`) is translated, the same rule
 * `friendlyQuoteError` uses, so PostgREST internals never reach the screen.
 */
export function friendlyCampaignError(err: unknown, fallback: string): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    if (code === "42501") return "You don't have permission to do that.";
    if (code === "23503") return "That record no longer exists. Refresh and try again.";
    if (code === "23505") return "That already exists.";
    if (code === "PGRST116") return "That record couldn't be found. It may have been removed.";
    return fallback;
  }
  if (!(err instanceof Error)) return fallback;
  return err.message || fallback;
}
