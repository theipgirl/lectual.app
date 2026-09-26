// Plain module: a "use server" file may only export async functions.

/**
 * @/lib/settings throws plain Errors written to be read (rank ceilings, the
 * last-owner guard, "enter an email"). Database errors carry a `code` and
 * never pass through.
 */
export function friendlySettingsError(err: unknown, fallback: string): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string") {
    if (code === "42501") return "You don't have permission to do that.";
    if (code === "23505") return "That person is already on your team.";
    return fallback;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}
