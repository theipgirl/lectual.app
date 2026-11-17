import "server-only";
import { env } from "@/lib/env";

/**
 * The ONE place the USPTO TSDR API key is read. The key is a deployment-wide credential for a public-record
 * lookup (USPTO's own API Key Manager issues it); it is never a firm's secret and never touches the database.
 *
 * Unset, empty or whitespace = null = "not-set-up". The value is returned to the caller that puts it in the
 * request header and nowhere else: never logged, never placed in an error, never returned in a result.
 */
export function tsdrApiKey(): string | null {
  const raw = env.USPTO_TSDR_API_KEY;
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return key === "" ? null : key;
}
