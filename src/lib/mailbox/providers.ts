import { pkceChallenge } from "./state";

/**
 * Google and Microsoft, behind one shape.
 *
 * What we ask for, and why it's the minimum:
 *   Google    gmail.readonly — read mail to match it to clients
 *             gmail.compose  — create DRAFTS (an approved queue item becomes a
 *                              draft in the approver's mailbox; a person sends)
 *   Microsoft Mail.Read, Mail.ReadWrite — the same pair in Graph terms
 *             (ReadWrite is what drafts need; we never send or delete)
 *   Both      offline_access / access_type=offline — a refresh token, so the
 *             15-minute sync keeps working while nobody is signed in
 *
 * A firm mailbox (intake@, trademark@) is connected by signing in AS that
 * mailbox's own account. That works the same on both providers and needs no
 * extra "shared mailbox" permission.
 *
 * Every network call takes `fetchImpl` so tests run without the network.
 */

export type MailboxProvider = "google" | "microsoft";
export type MailboxScope = "personal" | "firm";

export const PROVIDERS: readonly MailboxProvider[] = ["google", "microsoft"];

export function isProvider(value: string): value is MailboxProvider {
  return (PROVIDERS as readonly string[]).includes(value);
}

export type ClientCredentials = { clientId: string; clientSecret: string };

export type TokenSet = {
  accessToken: string;
  refreshToken: string;
  /** ISO timestamp. */
  expiresAt: string;
  grantedScopes: string[];
};

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "exchange-failed"
      | "no-refresh-token"
      | "missing-permission"
      | "no-email"
      | "profile-failed",
  ) {
    super(message);
  }
}

type Config = {
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Scopes that MUST come back granted, compared after normalisation. */
  required: string[];
};

const CONFIG: Record<MailboxProvider, Config> = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
    required: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.compose",
    ],
  },
  microsoft: {
    // `common` admits both work/school (Microsoft 365) and personal Outlook.com
    // accounts; small firms run on either.
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["openid", "email", "offline_access", "User.Read", "Mail.Read", "Mail.ReadWrite"],
    required: ["mail.read", "mail.readwrite"],
  },
};

export const PROVIDER_LABEL: Record<MailboxProvider, string> = {
  google: "Gmail",
  microsoft: "Outlook",
};

/** Graph echoes scopes as `https://graph.microsoft.com/Mail.Read`; compare bare and lower-case. */
function normaliseScope(provider: MailboxProvider, scope: string): string {
  if (provider === "microsoft") {
    return scope.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase();
  }
  return scope;
}

export function missingScopes(provider: MailboxProvider, granted: string[]): string[] {
  const have = new Set(granted.map((s) => normaliseScope(provider, s)));
  return CONFIG[provider].required.filter((r) => !have.has(r));
}

export function redirectUri(origin: string, provider: MailboxProvider): string {
  // Trailing slash: next.config sets trailingSlash, and the URI registered with
  // Google/Microsoft must match this string exactly.
  return `${origin}/api/mailbox/callback/${provider}/`;
}

export function authorizeUrl(args: {
  provider: MailboxProvider;
  clientId: string;
  redirectUri: string;
  nonce: string;
  verifier: string;
  loginHint?: string;
}): string {
  const cfg = CONFIG[args.provider];
  const url = new URL(cfg.authorizeUrl);
  const p = url.searchParams;
  p.set("client_id", args.clientId);
  p.set("redirect_uri", args.redirectUri);
  p.set("response_type", "code");
  p.set("scope", cfg.scopes.join(" "));
  p.set("state", args.nonce);
  p.set("code_challenge", pkceChallenge(args.verifier));
  p.set("code_challenge_method", "S256");
  if (args.provider === "google") {
    p.set("access_type", "offline");
    // Without prompt=consent Google omits the refresh token on a reconnect.
    p.set("prompt", "consent");
    p.set("include_granted_scopes", "true");
  } else {
    p.set("response_mode", "query");
    p.set("prompt", "select_account");
  }
  if (args.loginHint) p.set("login_hint", args.loginHint);
  return url.toString();
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

export async function exchangeCode(args: {
  provider: MailboxProvider;
  creds: ClientCredentials;
  code: string;
  verifier: string;
  redirectUri: string;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<TokenSet> {
  const { provider, creds, fetchImpl = fetch, now = Date.now() } = args;
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code: args.code,
    code_verifier: args.verifier,
    redirect_uri: args.redirectUri,
    grant_type: "authorization_code",
  });
  if (provider === "microsoft") body.set("scope", CONFIG.microsoft.scopes.join(" "));

  const res = await fetchImpl(CONFIG[provider].tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    // The provider's own words, never the code or our secret.
    throw new ProviderError(
      json.error_description || json.error || `Token exchange failed (${res.status}).`,
      "exchange-failed",
    );
  }
  if (!json.refresh_token) {
    throw new ProviderError(
      "The provider didn't return a refresh token, so background sync couldn't run. Try connecting again.",
      "no-refresh-token",
    );
  }
  const grantedScopes = (json.scope ?? "").split(/\s+/).filter(Boolean);
  const missing = missingScopes(provider, grantedScopes);
  if (missing.length > 0) {
    // Google lets people untick individual permissions on the consent screen.
    throw new ProviderError(
      "Some permissions were not granted. Lectual needs to read mail and create drafts; please allow both.",
      "missing-permission",
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: new Date(now + (json.expires_in ?? 3600) * 1000).toISOString(),
    grantedScopes,
  };
}

/** The address of the account that just consented. */
export async function fetchAccountEmail(args: {
  provider: MailboxProvider;
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<string> {
  const { provider, accessToken, fetchImpl = fetch } = args;
  const url =
    provider === "google"
      ? "https://openidconnect.googleapis.com/v1/userinfo"
      : "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName";
  const res = await fetchImpl(url, { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new ProviderError(`Couldn't read the account profile (${res.status}).`, "profile-failed");
  const json = (await res.json()) as {
    email?: string;
    email_verified?: boolean;
    mail?: string | null;
    userPrincipalName?: string;
  };

  const email =
    provider === "google"
      ? json.email_verified === false
        ? undefined
        : json.email
      : json.mail || json.userPrincipalName;
  if (!email || !email.includes("@")) {
    throw new ProviderError("The account has no email address we can use.", "no-email");
  }
  return email.trim().toLowerCase();
}

/**
 * Best-effort revocation on disconnect. Google supports it; Microsoft has no
 * per-token revoke endpoint (the user removes the app from their account's
 * permissions page), so there we only delete our copy.
 */
export async function revokeToken(args: {
  provider: MailboxProvider;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  if (args.provider !== "google") return false;
  const res = await (args.fetchImpl ?? fetch)("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: args.token }),
  });
  return res.ok;
}
