import { NextResponse, type NextRequest } from "next/server";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getSiteOrigin } from "@/lib/site-origin";
import { adobeRedirectUri, adobeSignSetup, type AdobeSetup } from "./adobe-config";
import {
  ADOBE_SCOPES,
  ADOBE_STATE_COOKIE,
  ADOBE_STATE_PATH,
  ADOBE_STATE_TTL_MS,
  AdobeOAuthError,
  adobeAuthorizeUrl,
  checkAdobeState,
  encodeAdobeStateCookie,
  exchangeAdobeCode,
  newAdobeState,
  readAdobeAccountEmail,
} from "./adobe-oauth";
import { saveAdobeConnection } from "./adobe-connection";
import type { AdobeFetch } from "./adobe-client";
import type { EsignDb } from "./db";

/**
 * The two OAuth routes for "Connect Adobe Acrobat Sign" (`/api/esign/connect/`, `/api/esign/callback/`; D2), as handlers with
 * their dependencies injectable so a test can drive them with the page bypassed. Both enforce the ADMIN TIER themselves
 * (owner / admin / senior_admin): a route handler is its own entry point. Nothing here logs Adobe's text or a token.
 */

export const INTEGRATIONS_PAGE = "/dashboard/settings/integrations/";

type Session = Awaited<ReturnType<typeof resolveFirmSession>>;

export type RouteDeps = {
  session: () => Promise<Session>;
  setup: () => AdobeSetup;
  origin: () => Promise<string>;
  db: () => Promise<EsignDb>;
  fetchImpl?: AdobeFetch;
};

const defaults: RouteDeps = {
  session: () => resolveFirmSession({ signInNext: INTEGRATIONS_PAGE }),
  setup: adobeSignSetup,
  origin: getSiteOrigin,
  db: async () => (await getScopedClient()) as unknown as EsignDb,
};

export async function handleConnect(req: NextRequest, over: Partial<RouteDeps> = {}): Promise<NextResponse> {
  const deps = { ...defaults, ...over };
  const session = await deps.session();
  if (session.kind === "signed-out") return NextResponse.redirect(new URL(session.redirectTo, req.url));
  if (session.kind !== "ok") return new NextResponse(null, { status: 404 });
  const back = (code: string) => NextResponse.redirect(new URL(`${INTEGRATIONS_PAGE}?esign_error=${code}`, req.url));
  if (!hasRole(session.role, "senior_admin")) return back("forbidden");
  const setup = deps.setup();
  if (!setup.ready) return back("unconfigured");

  const origin = await deps.origin();
  const state = newAdobeState({ orgId: session.org.id, userId: session.user.id });
  const res = NextResponse.redirect(
    adobeAuthorizeUrl({ clientId: setup.creds.clientId, redirectUri: adobeRedirectUri(origin), nonce: state.nonce, authorizeUrl: setup.authorizeUrl }),
  );
  res.cookies.set(ADOBE_STATE_COOKIE, encodeAdobeStateCookie(setup.root, state), {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    // Lax: Adobe's redirect back is a cross-site top-level GET.
    sameSite: "lax",
    path: ADOBE_STATE_PATH,
    maxAge: Math.floor(ADOBE_STATE_TTL_MS / 1000),
  });
  return res;
}

export async function handleCallback(req: NextRequest, over: Partial<RouteDeps> = {}): Promise<NextResponse> {
  const deps = { ...defaults, ...over };
  const finish = (query: string) => {
    const res = NextResponse.redirect(new URL(`${INTEGRATIONS_PAGE}?${query}`, req.url));
    res.cookies.set(ADOBE_STATE_COOKIE, "", { path: ADOBE_STATE_PATH, maxAge: 0 });
    return res;
  };
  const fail = (code: string) => finish(`esign_error=${code}`);

  const session = await deps.session();
  if (session.kind === "signed-out") return NextResponse.redirect(new URL(session.redirectTo, req.url));
  if (session.kind !== "ok") return new NextResponse(null, { status: 404 });
  // The admin tier, here as well as on the page and in /connect (the role may have changed since).
  if (!hasRole(session.role, "senior_admin")) return fail("forbidden");

  const setup = deps.setup();
  if (!setup.ready) return fail("unconfigured");
  const url = req.nextUrl;
  if (url.searchParams.get("error")) return fail("denied");

  const check = checkAdobeState(setup.root, {
    cookie: req.cookies.get(ADOBE_STATE_COOKIE)?.value,
    stateParam: url.searchParams.get("state"),
    session: { userId: session.user.id, orgId: session.org.id },
  });
  if (!check.ok) return fail(check.reason === "wrong-session" ? "wrong-session" : "expired");

  const code = url.searchParams.get("code");
  if (!code) return fail("failed");

  try {
    const origin = await deps.origin();
    // The host rule on `api_access_point` runs inside, BEFORE the token POST that carries the client secret.
    const tokens = await exchangeAdobeCode({
      creds: setup.creds,
      code,
      redirectUri: adobeRedirectUri(origin),
      accessPoint: url.searchParams.get("api_access_point"),
      fetchImpl: deps.fetchImpl,
    });
    const accountEmail = await readAdobeAccountEmail({ accessPoint: tokens.apiAccessPoint, accessToken: tokens.accessToken, fetchImpl: deps.fetchImpl });
    const saved = await saveAdobeConnection(await deps.db(), { root: setup.root, orgId: check.state.orgId, tokens, accountEmail, scopes: ADOBE_SCOPES });
    if (!saved.ok) return fail(saved.reason === "not-set-up" ? "unconfigured" : "save-failed");
    return finish(`esign=connected${saved.reconnected ? "&reconnected=1" : ""}`);
  } catch (err) {
    return fail(err instanceof AdobeOAuthError && err.code === "host-refused" ? "host" : "failed");
  }
}
