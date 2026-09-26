// Plain module (NOT "use server") — a "use server" file may only export async
// functions, so these pure sync helpers live here and are imported by the actions.

import { isLeadWriteError } from "@/lib/pipeline/errors";

const FORBIDDEN_COPY =
  "You don't have permission to do that — ask an attorney, admin, or intake lead.";

/** Translate a moveLeadStage refusal/throw into a friendly UI message. */
export function friendlyMoveStageError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/forbid/i.test(message) || /permission/i.test(message) || /role/i.test(message)) {
    return "You don't have permission to move this lead to that stage — ask an attorney, admin, or intake lead.";
  }
  return "Couldn't move this lead. Please try again.";
}

/**
 * Translate any lead create/edit/note/assign failure into something safe to
 * render.
 *
 * Only `LeadWriteError` — the one error type the data layer raises on purpose
 * for a human to read — passes its message through. Everything else (a
 * PostgrestError, a thrown string, an unexpected TypeError) collapses to
 * `fallback`, so a raw RLS/Postgres message can never reach a firm user's
 * screen. That is the whole point of the allowlist being a *type* rather than
 * a set of message patterns: there is nothing to keep in sync.
 */
export function friendlyLeadWriteError(err: unknown, fallback: string): string {
  if (isLeadWriteError(err)) {
    return err.forbidden ? FORBIDDEN_COPY : err.message;
  }

  // PostgREST returns plain objects (not Error instances) carrying a `code`.
  // A handful map to something a user can act on; the rest stay generic.
  const code = (err as { code?: unknown } | null)?.code;
  if (code === "23505") return "A lead with those details already exists.";
  if (code === "23503") return "That stage or teammate no longer exists — refresh and try again.";
  if (code === "42501") return FORBIDDEN_COPY;

  return fallback;
}

/** Per-field messages when the failure was a validation refusal, else undefined. */
export function leadFieldErrors(err: unknown): Record<string, string> | undefined {
  return isLeadWriteError(err) ? err.fieldErrors : undefined;
}
