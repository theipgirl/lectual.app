import { NextResponse, type NextRequest } from "next/server";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { getSiteOrigin } from "@/lib/site-origin";
import { lawPayAuthorizeBase, lawPayRedirectUri, lawPaySetup } from "@/lib/payments/lawpay-config";
import { lawPayAuthorizeUrl } from "@/lib/payments/lawpay-oauth";
import { LAWPAY_STATE_COOKIE, LAWPAY_STATE_PATH, STATE_TTL_MS, encodeLawPayStateCookie, newLawPayState } from "@/lib/payments/lawpay-state";

const LAWPAY_PAGE = "/dashboard/settings/integrations/lawpay/";

/**
 * Step one of "Connect LawPay": only an owner / admin / senior_admin of the
 * firm they are standing in; remember who and which firm in a signed, httpOnly,
 * short-lived cookie; send them to LawPay's own sign-in and approval screen.
 * The firm never pastes a key.
 */
export async function GET(req: NextRequest) {
  const session = await resolveFirmSession({ signInNext: LAWPAY_PAGE });
  if (session.kind === "signed-out") return NextResponse.redirect(new URL(session.redirectTo, req.url));
  if (session.kind !== "ok") return new NextResponse(null, { status: 404 });

  const back = (code: string) => NextResponse.redirect(new URL(`${LAWPAY_PAGE}?error=${code}`, req.url));
  if (!hasRole(session.role, "senior_admin")) return back("forbidden");

  const setup = lawPaySetup();
  if (!setup.ready) return back("unconfigured");

  const origin = await getSiteOrigin();
  const state = newLawPayState({ orgId: session.org.id, userId: session.user.id });
  const res = NextResponse.redirect(
    lawPayAuthorizeUrl({
      clientId: setup.creds.clientId,
      redirectUri: lawPayRedirectUri(origin),
      nonce: state.nonce,
      verifier: state.verifier,
      authorizeUrl: lawPayAuthorizeBase(),
    }),
  );
  res.cookies.set(LAWPAY_STATE_COOKIE, encodeLawPayStateCookie(setup.root, state), {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    // Lax: LawPay's redirect back is a cross-site top-level GET.
    sameSite: "lax",
    path: LAWPAY_STATE_PATH,
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  });
  return res;
}
