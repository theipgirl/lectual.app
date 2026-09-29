import "server-only";
import { env } from "@/lib/env";
import { rootKeyOrNull } from "@/lib/mailbox/config";
import { DEFAULT_API_BASE, type LawPayClientCredentials, type LawPayMode } from "./lawpay-oauth";

/**
 * Deployment configuration for "Connect LawPay". Every accessor returns null
 * rather than throwing, so a surface can say "not set up yet" honestly.
 *
 * There is deliberately NO deployment-wide LawPay secret key here. The old
 * design read one `LAWPAY_SECRET_KEY` belonging to one firm's merchant account;
 * every charge now uses the calling firm's own credentials, fetched when that
 * firm signed in (lawpay-connection.ts).
 */

export function lawPayClientCredentials(): LawPayClientCredentials | null {
  const clientId = (env.LAWPAY_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = (env.LAWPAY_OAUTH_CLIENT_SECRET ?? "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function lawPayApiBase(): string {
  return (env.LAWPAY_API_BASE ?? "").trim() || DEFAULT_API_BASE;
}

export function lawPayAuthorizeBase(): string | undefined {
  return (env.LAWPAY_OAUTH_AUTHORIZE_URL ?? "").trim() || undefined;
}

/**
 * Which half of a merchant's credentials this deployment charges with. Only the
 * exact string "live" is live; a typo stays in test, which can't move money.
 */
export function lawPayDeploymentMode(): LawPayMode {
  return (env.LAWPAY_MODE ?? "").trim() === "live" ? "live" : "test";
}

export function lawPayRedirectUri(origin: string): string {
  const override = (env.LAWPAY_OAUTH_REDIRECT_URI ?? "").trim();
  // Trailing slash: next.config sets trailingSlash, and the registered URI must
  // match this string exactly.
  return override || `${origin}/api/lawpay/callback/`;
}

export type LawPaySetup =
  | { ready: true; creds: LawPayClientCredentials; root: Buffer }
  | { ready: false; missing: "partner-app" | "encryption-key" };

/** Can a firm connect LawPay on this deployment right now, and if not, why. */
export function lawPaySetup(): LawPaySetup {
  const creds = lawPayClientCredentials();
  if (!creds) return { ready: false, missing: "partner-app" };
  const root = rootKeyOrNull();
  if (!root) return { ready: false, missing: "encryption-key" };
  return { ready: true, creds, root };
}
