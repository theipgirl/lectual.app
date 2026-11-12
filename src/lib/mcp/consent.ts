import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { orgHasModule } from "@/lib/org/modules";
import { env } from "@/lib/env";
import {
  type ConsentOutcome,
  type ConsentRefusal,
  type ConsentSession,
  decideConsent,
  needsDetails,
  parseAuthorizationId,
  readDetails,
} from "./consent-rules";
import { parseAllowedRedirects } from "./redirects";
import {
  CONSENT_APP_NOT_ALLOWED,
  CONSENT_EXPIRED,
  CONSENT_FAILED,
  CONSENT_MISSING,
  CONSENT_NOT_AVAILABLE,
} from "@/lib/ui/words";

/** The allow-list from env; an unreadable setting is the defaults' parser on nothing (the defaults). */
export function allowedRedirects(): string[] {
  let raw: string | undefined;
  try {
    raw = env.MCP_ALLOWED_REDIRECTS;
  } catch {
    raw = undefined;
  }
  return parseAllowedRedirects(raw);
}

/**
 * Gather every fact fresh (session, the firm's switch, Supabase's view of the request) and decide.
 * Called by the page AND by the decision endpoint, so the endpoint never trusts what the page showed.
 * Any throw along the way is a refusal.
 */
export async function evaluateConsent(rawAuthorizationId: unknown): Promise<ConsentOutcome> {
  const authorizationId = parseAuthorizationId(rawAuthorizationId);
  const allowed = allowedRedirects();
  if (!authorizationId) return decideConsent({ authorizationId, session: { kind: "signed-out" }, moduleOn: false, details: null, allowedRedirects: allowed });
  try {
    const firm = await resolveFirmSession();
    const session: ConsentSession =
      firm.kind === "ok"
        ? { kind: "ok", userId: firm.user.id, firmName: firm.org.name, you: firm.displayName }
        : firm.kind === "signed-out"
          ? { kind: "signed-out" }
          : { kind: "no-access" };
    const moduleOn = session.kind === "ok" ? await orgHasModule("claude-connector") : false;
    const base = { authorizationId, session, moduleOn, allowedRedirects: allowed };
    if (!needsDetails(base)) return decideConsent({ ...base, details: null });
    const supabase = await getScopedClient();
    const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
    return decideConsent({ ...base, details: readDetails(data, error) });
  } catch {
    return { kind: "refuse", reason: "not-available" };
  }
}

export function refusalSentence(reason: ConsentRefusal | "failed"): string {
  switch (reason) {
    case "missing":
      return CONSENT_MISSING;
    case "expired":
      return CONSENT_EXPIRED;
    case "app-not-allowed":
      return CONSENT_APP_NOT_ALLOWED;
    case "failed":
      return CONSENT_FAILED;
    default:
      return CONSENT_NOT_AVAILABLE;
  }
}
