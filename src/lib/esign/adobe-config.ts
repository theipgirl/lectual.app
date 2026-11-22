import "server-only";
import { env } from "@/lib/env";
import { rootKeyOrNull } from "@/lib/mailbox/config";
import { DEFAULT_ADOBE_AUTHORIZE_URL, type AdobeClientCredentials } from "./adobe-oauth";
import { isAdobeAuthorizeUrl } from "./host-rule";

/**
 * Deployment configuration for Adobe Acrobat Sign (Sprint 5a, contract item 1). Env holds ONLY Lectual's partner-app OAuth id
 * and secret, two optional overrides, and the client-path switch. There is no deployment-wide Adobe token, account or API key
 * and no env var for one: each firm connects its own account.
 *
 * Every accessor answers "not set up" rather than throwing.
 */

export type AdobeEnv = {
  ADOBE_SIGN_OAUTH_CLIENT_ID?: string;
  ADOBE_SIGN_OAUTH_CLIENT_SECRET?: string;
  ADOBE_SIGN_OAUTH_REDIRECT_URI?: string;
  ADOBE_SIGN_AUTHORIZE_URL?: string;
  ADOBE_SIGN_CLIENT_SIGNING?: string;
};

export type AdobeSetup =
  | { ready: true; creds: AdobeClientCredentials; root: Buffer; authorizeUrl: string }
  | { ready: false; missing: "partner-app" | "authorize-url" | "encryption-key" };

/** Pure: the setup from raw values. Either OAuth id unset, or a bad authorize URL, is "not set up". */
export function adobeSetupFrom(values: AdobeEnv, root: Buffer | null): AdobeSetup {
  const clientId = (values.ADOBE_SIGN_OAUTH_CLIENT_ID ?? "").trim();
  const clientSecret = (values.ADOBE_SIGN_OAUTH_CLIENT_SECRET ?? "").trim();
  if (!clientId || !clientSecret) return { ready: false, missing: "partner-app" };
  const override = (values.ADOBE_SIGN_AUTHORIZE_URL ?? "").trim();
  if (override && !isAdobeAuthorizeUrl(override)) return { ready: false, missing: "authorize-url" };
  if (!root) return { ready: false, missing: "encryption-key" };
  return { ready: true, creds: { clientId, clientSecret }, root, authorizeUrl: override || DEFAULT_ADOBE_AUTHORIZE_URL };
}

/** Pure: the client-path switch (D15). Only the exact string "on" creates a NEW Adobe agreement. */
export function clientSigningOnFrom(values: AdobeEnv): boolean {
  return values.ADOBE_SIGN_CLIENT_SIGNING === "on";
}

function current(): AdobeEnv {
  return {
    ADOBE_SIGN_OAUTH_CLIENT_ID: env.ADOBE_SIGN_OAUTH_CLIENT_ID,
    ADOBE_SIGN_OAUTH_CLIENT_SECRET: env.ADOBE_SIGN_OAUTH_CLIENT_SECRET,
    ADOBE_SIGN_OAUTH_REDIRECT_URI: env.ADOBE_SIGN_OAUTH_REDIRECT_URI,
    ADOBE_SIGN_AUTHORIZE_URL: env.ADOBE_SIGN_AUTHORIZE_URL,
    ADOBE_SIGN_CLIENT_SIGNING: env.ADOBE_SIGN_CLIENT_SIGNING,
  };
}

/** Can a firm connect Adobe on this deployment right now, and if not, why. */
export function adobeSignSetup(): AdobeSetup {
  return adobeSetupFrom(current(), rootKeyOrNull());
}

/** Is the Adobe signing path switched on for clients (D15)? Default off. */
export function adobeClientSigningOn(): boolean {
  return clientSigningOnFrom(current());
}

export function adobeRedirectUri(origin: string): string {
  const override = (env.ADOBE_SIGN_OAUTH_REDIRECT_URI ?? "").trim();
  // Trailing slash: next.config sets trailingSlash, and the registered URI must match this string exactly.
  return override || `${origin}/api/esign/callback/`;
}
