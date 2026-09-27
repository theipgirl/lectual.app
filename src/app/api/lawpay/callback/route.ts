import { NextResponse, type NextRequest } from "next/server";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { getSiteOrigin } from "@/lib/site-origin";
import { lawPayApiBase, lawPayRedirectUri, lawPaySetup } from "@/lib/payments/lawpay-config";
import { LawPayOAuthError, exchangeLawPayCode, fetchGatewayCredentials } from "@/lib/payments/lawpay-oauth";
import { LAWPAY_STATE_COOKIE, LAWPAY_STATE_PATH, checkLawPayState } from "@/lib/payments/lawpay-state";
import { saveLawPayConnection } from "@/lib/payments/lawpay-connection";

const LAWPAY_PAGE = "/dashboard/settings/integrations/lawpay/";

/**
 * Step two: LawPay sends the browser back with `code` and `state`. The signed
 * cookie from /connect is the only thing trusted about who started this
 * (src/lib/payments/lawpay-state.ts): state, user and firm must all match. The
 * cookie is cleared on every exit, so an attempt finishes at most once.
 *
 * The code is exchanged for the OAuth grant, the grant fetches the merchant's
 * gateway credentials, and everything secret is sealed before it is written —
 * through the caller's own scoped client, so RLS decides.
 */
export async function GET(req: NextRequest) {
  const finish = (query: string) => {
    const res = NextResponse.redirect(new URL(`${LAWPAY_PAGE}?${query}`, req.url));
    res.cookies.set(LAWPAY_STATE_COOKIE, "", { path: LAWPAY_STATE_PATH, maxAge: 0 });
    return res;
  };
  const fail = (code: string) => finish(`error=${code}`);

  const session = await resolveFirmSession({ signInNext: LAWPAY_PAGE });
  if (session.kind === "signed-out") return NextResponse.redirect(new URL(session.redirectTo, req.url));
  if (session.kind !== "ok") return new NextResponse(null, { status: 404 });

  const setup = lawPaySetup();
  if (!setup.ready) return fail("unconfigured");

  const url = req.nextUrl;
  if (url.searchParams.get("error")) return fail("denied");

  const check = checkLawPayState(setup.root, {
    cookie: req.cookies.get(LAWPAY_STATE_COOKIE)?.value,
    stateParam: url.searchParams.get("state"),
    session: { userId: session.user.id, orgId: session.org.id },
  });
  if (!check.ok) return fail(check.reason === "wrong-session" ? "wrong-session" : "expired");

  // The role may have changed since /connect; RLS would refuse the write anyway.
  if (!hasRole(session.role, "senior_admin")) return fail("forbidden");

  const code = url.searchParams.get("code");
  if (!code) return fail("failed");

  try {
    const origin = await getSiteOrigin();
    const tokens = await exchangeLawPayCode({
      creds: setup.creds,
      code,
      verifier: check.state.verifier,
      redirectUri: lawPayRedirectUri(origin),
      apiBase: lawPayApiBase(),
    });
    const gateway = await fetchGatewayCredentials({ accessToken: tokens.accessToken, apiBase: lawPayApiBase() });
    const saved = await saveLawPayConnection({ root: setup.root, orgId: check.state.orgId, userId: check.state.userId, tokens, gateway });
    if (!saved.ok) return fail("save-failed");
    return finish(`connected=1${saved.reconnected ? "&reconnected=1" : ""}${saved.unmapped.length ? `&unmapped=${saved.unmapped.join(",")}` : ""}`);
  } catch (err) {
    if (err instanceof LawPayOAuthError) {
      console.error(`[lawpay/callback] ${err.code}`);
      return fail(err.code === "no-accounts" ? "no-accounts" : "failed");
    }
    console.error("[lawpay/callback] unexpected error", err instanceof Error ? err.message : err);
    return fail("failed");
  }
}
