/** Where signing in lands when nothing safe was asked for: Today. */
export const SIGN_IN_HOME = "/dashboard/";

/**
 * The in-app path to go to after sign-in. Only a path inside this app is kept
 * (one leading slash, no protocol-relative "//", no backslash); the bare root
 * "/", nothing, or anything else lands on Today.
 */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\") || next === "/") return SIGN_IN_HOME;
  return next;
}
