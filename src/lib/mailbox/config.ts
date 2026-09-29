import "server-only";
import { env } from "@/lib/env";
import { parseRootKey } from "./crypto";
import type { ClientCredentials, MailboxProvider } from "./providers";

/**
 * Deployment configuration for mailbox connections. Every accessor returns
 * null rather than throwing when something is unset, so a surface can say
 * "not set up yet" instead of 500ing — the mailbox equivalent of the queue's
 * `unconfigured` state.
 */

export function providerCredentials(provider: MailboxProvider): ClientCredentials | null {
  const clientId = provider === "google" ? env.GOOGLE_OAUTH_CLIENT_ID : env.MS_OAUTH_CLIENT_ID;
  const clientSecret =
    provider === "google" ? env.GOOGLE_OAUTH_CLIENT_SECRET : env.MS_OAUTH_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** The root key, or null if it is missing or malformed. */
export function rootKeyOrNull(): Buffer | null {
  try {
    return parseRootKey(env.MAILBOX_TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Which providers can actually be connected on this deployment right now. */
export function connectableProviders(): Record<MailboxProvider, boolean> {
  const keyOk = rootKeyOrNull() !== null;
  return {
    google: keyOk && providerCredentials("google") !== null,
    microsoft: keyOk && providerCredentials("microsoft") !== null,
  };
}
