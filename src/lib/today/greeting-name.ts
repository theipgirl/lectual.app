/**
 * The first name Today greets the signed-in user by.
 *
 * `session.displayName` is NOT used for this: it falls back to the email's
 * local part ("taylormcghee93"), which is a login handle, not a name. Here the
 * member directory's display name wins, then the account's own name, and an
 * email is never turned into a name. No usable name means no name at all, and
 * the heading reads "Good morning." instead.
 */

export type GreetingMember = { userId: string; displayName: string | null; identified?: boolean };

export type GreetingInput = {
  userId: string;
  members: readonly GreetingMember[];
  /** Supabase `user.user_metadata` (provider-supplied, so anything may be in it). */
  metadata?: Record<string, unknown> | null;
  email?: string | null;
};

function localPartOf(email: string | null | undefined): string {
  return (email ?? "").split("@")[0].trim().toLowerCase();
}

/** A name worth greeting someone by: non-blank, not an address, not the email's own handle. */
function usableName(value: unknown, email: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (!name || name.includes("@")) return null;
  const handle = localPartOf(email);
  if (handle && name.toLowerCase() === handle) return null;
  return name;
}

const firstWord = (name: string) => name.split(/\s+/)[0] || null;

export function greetingName({ userId, members, metadata, email }: GreetingInput): string | null {
  const member = members.find((m) => m.userId === userId);
  const fromDirectory = member && member.identified !== false ? usableName(member.displayName, email) : null;
  const name = fromDirectory ?? usableName(metadata?.full_name, email) ?? usableName(metadata?.name, email);
  return name ? firstWord(name) : null;
}

/** ", Taylor" or "", so the heading is "Good morning, Taylor." or "Good morning." with no stray comma. */
export function greetingSuffix(name: string | null): string {
  return name ? `, ${name}` : "";
}
