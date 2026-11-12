import { CONSENT_PATH, type ConsentOutcome, consentPath, parseAuthorizationId, sameOriginPost } from "./consent-rules";
import { redirectUrlAllowed } from "./redirects";

/**
 * The consent decision (POST /api/oauth/decision/), with its dependencies passed in so it can be
 * tested without Supabase. It re-gathers every fact through `evaluate` (the same function the page
 * uses) before approving: the page is not the gate. It returns where to send the browser, nothing
 * else; a refusal goes back to the page, which says why in a fixed sentence.
 */
export type DecisionInput = {
  origin: string | null;
  host: string | null;
  authorizationId: unknown;
  decision: unknown;
};

type ConsentCall = (authorizationId: string) => Promise<{ data: { redirect_url?: unknown } | null; error: unknown }>;

export type DecisionDeps = {
  evaluate: (authorizationId: string) => Promise<ConsentOutcome>;
  approve: ConsentCall;
  deny: ConsentCall;
  allowedRedirects: readonly string[];
};

export async function runDecision(input: DecisionInput, deps: DecisionDeps): Promise<string> {
  const id = parseAuthorizationId(input.authorizationId);
  if (!id) return CONSENT_PATH;
  const back = consentPath(id);
  if (!sameOriginPost(input.origin, input.host)) return back;
  if (input.decision !== "allow" && input.decision !== "deny") return back;

  let outcome: ConsentOutcome;
  try {
    outcome = await deps.evaluate(id);
  } catch {
    return back;
  }
  if (outcome.kind === "sign-in") return outcome.to;
  if (outcome.kind === "refuse") return back;
  // Already consented: evaluate held the URL to the allow-list.
  if (outcome.kind === "redirect") return outcome.url;

  try {
    const call = input.decision === "allow" ? deps.approve : deps.deny;
    const { data, error } = await call(id);
    const url = data?.redirect_url;
    if (error || typeof url !== "string" || !redirectUrlAllowed(url, deps.allowedRedirects)) return `${back}&failed=1`;
    return url;
  } catch {
    return `${back}&failed=1`;
  }
}
