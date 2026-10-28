// Plain module: a "use server" file may only export async functions.

import { isQueueError, readableMessage } from "@/lib/ui/readable-error";
import { APPROVALS_NOT_READY } from "@/lib/ui/words";

/**
 * @/lib/settings throws ReadableErrors (rank ceilings, the last-owner guard,
 * "enter an email"). Database errors carry a `code` and anything else becomes
 * the fallback.
 */
export function friendlySettingsError(err: unknown, fallback: string): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    if (code === "42501") return "You don't have permission to do that.";
    if (code === "23505") return "That person is already on your team.";
    return fallback;
  }
  if (isQueueError(err)) return APPROVALS_NOT_READY;
  return readableMessage(err) ?? fallback;
}
