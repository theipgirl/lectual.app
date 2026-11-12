import { redirectUriAllowed, redirectUrlAllowed } from "./redirects";

/**
 * The consent decision for the Claude connector, pure. The page (/oauth/consent/) and the decision
 * endpoint (/api/oauth/decision/) both gather the same facts fresh and ask this; the page is not
 * the gate. Refusals approve nothing and name no firm's settings.
 */

export const CONSENT_PATH = "/oauth/consent/";
export const DECISION_PATH = "/api/oauth/decision/";

/** Supabase's authorization ids are opaque; accept only a plain url-safe token. */
const AUTHORIZATION_ID = /^[A-Za-z0-9_-]{8,128}$/;

export function parseAuthorizationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return AUTHORIZATION_ID.test(value) ? value : null;
}

/** The in-app path to come back to after signing in. Only built from a parsed id. */
export function consentPath(authorizationId: string): string {
  return `${CONSENT_PATH}?authorization_id=${encodeURIComponent(authorizationId)}`;
}

/** The sign-in page, carrying the consent path as `next` (safeNext keeps it unchanged). */
export function consentSignInPath(authorizationId: string): string {
  return `/sign-in/?next=${encodeURIComponent(consentPath(authorizationId))}`;
}

export type ConsentSession =
  | { kind: "signed-out" }
  | { kind: "no-access" }
  | { kind: "ok"; userId: string; firmName: string; you: string };

/** What `auth.oauth.getAuthorizationDetails` said, reduced to what the rules read. */
export type ConsentDetails =
  | { kind: "error" }
  | { kind: "ask"; authorizationId: string; redirectUri: string; userId: string }
  | { kind: "consented"; redirectUrl: string };

export type ConsentRefusal = "missing" | "not-available" | "expired" | "app-not-allowed";

export type ConsentOutcome =
  | { kind: "sign-in"; to: string }
  | { kind: "refuse"; reason: ConsentRefusal }
  | { kind: "redirect"; url: string }
  | { kind: "ask"; authorizationId: string; firmName: string; you: string };

export type ConsentFacts = {
  authorizationId: string | null;
  session: ConsentSession;
  /** Whether the active firm holds `claude-connector`. Read only for a signed-in member. */
  moduleOn: boolean;
  /** Read only when everything before it passed; null = not read. */
  details: ConsentDetails | null;
  allowedRedirects: readonly string[];
};

/**
 * In order: a usable request id; signed in; a firm session; the firm has the connector switched on;
 * Supabase answered; the client's redirect is Claude's; the request is this person's. An "already
 * consented" answer is held to the same allow-list before anyone is sent to it.
 */
export function decideConsent(facts: ConsentFacts): ConsentOutcome {
  const id = facts.authorizationId;
  if (!id) return { kind: "refuse", reason: "missing" };
  if (facts.session.kind === "signed-out") return { kind: "sign-in", to: consentSignInPath(id) };
  if (facts.session.kind !== "ok") return { kind: "refuse", reason: "not-available" };
  if (!facts.moduleOn) return { kind: "refuse", reason: "not-available" };
  const details = facts.details;
  if (!details || details.kind === "error") return { kind: "refuse", reason: "expired" };
  if (details.kind === "consented") {
    if (!redirectUrlAllowed(details.redirectUrl, facts.allowedRedirects)) return { kind: "refuse", reason: "app-not-allowed" };
    return { kind: "redirect", url: details.redirectUrl };
  }
  if (!redirectUriAllowed(details.redirectUri, facts.allowedRedirects)) return { kind: "refuse", reason: "app-not-allowed" };
  if (details.userId !== facts.session.userId || details.authorizationId !== id) return { kind: "refuse", reason: "expired" };
  return { kind: "ask", authorizationId: id, firmName: facts.session.firmName, you: facts.session.you };
}

/** Should the gatherer bother asking Supabase? Only once everything before it passed. */
export function needsDetails(facts: Omit<ConsentFacts, "details">): boolean {
  return Boolean(facts.authorizationId) && facts.session.kind === "ok" && facts.moduleOn;
}

/** Reduce Supabase's answer. Anything unrecognised is an error, never a pass. */
export function readDetails(data: unknown, error: unknown): ConsentDetails {
  if (error || !data || typeof data !== "object") return { kind: "error" };
  const d = data as Record<string, unknown>;
  if ("authorization_id" in d) {
    const user = d.user as Record<string, unknown> | null | undefined;
    if (typeof d.authorization_id !== "string" || typeof d.redirect_uri !== "string" || typeof user?.id !== "string") {
      return { kind: "error" };
    }
    return { kind: "ask", authorizationId: d.authorization_id, redirectUri: d.redirect_uri, userId: user.id };
  }
  if (typeof d.redirect_url === "string") return { kind: "consented", redirectUrl: d.redirect_url };
  return { kind: "error" };
}

/**
 * A browser form POST carries Origin; it must be this site. Cookies are SameSite=Lax (no cross-site
 * POST) and this is the second line. No Origin at all is refused: every current browser sends one.
 */
export function sameOriginPost(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
