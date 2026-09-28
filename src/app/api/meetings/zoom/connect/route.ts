import { NextResponse, type NextRequest } from "next/server";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { getSiteOrigin } from "@/lib/site-origin";
import { zoomRedirectUri, zoomSetup } from "@/lib/meetings/config";
import { zoomAuthorizeUrl } from "@/lib/meetings/zoom";
import { STATE_TTL_MS, ZOOM_STATE_COOKIE, ZOOM_STATE_PATH, encodeZoomStateCookie, newZoomState, pkceChallenge } from "@/lib/meetings/state";

const PAGE = "/dashboard/settings/integrations/meetings/";

/**
 * Step one of "Connect Zoom": only an owner / admin / senior_admin of the firm
 * they are standing in. Remember who and which firm (and the PKCE verifier) in
 * a signed, httpOnly, short-lived cookie scoped to the callback path, then
 * send them to Zoom's own sign-in. Inert until ZOOM_OAUTH_CLIENT_ID/SECRET
 * and MAILBOX_TOKEN_KEY are set.
 */
export async function GET(req: NextRequest) {
  const session = await resolveFirmSession({ signInNext: PAGE });
  if (session.kind === "signed-out") return NextResponse.redirect(new URL(session.redirectTo, req.url));
  if (session.kind !== "ok") return new NextResponse(null, { status: 404 });

  const back = (code: string) => NextResponse.redirect(new URL(`${PAGE}?error=${code}`, req.url));
  if (!hasRole(session.role, "senior_admin")) return back("forbidden");

  const setup = zoomSetup();
  if (!setup.ready) return back("unconfigured");

  const origin = await getSiteOrigin();
  const state = newZoomState({ orgId: session.org.id, userId: session.user.id });
  const res = NextResponse.redirect(
    zoomAuthorizeUrl({
      clientId: setup.creds.clientId,
      redirectUri: zoomRedirectUri(origin),
      nonce: state.nonce,
      challenge: pkceChallenge(state.verifier),
    }),
  );
  res.cookies.set(ZOOM_STATE_COOKIE, encodeZoomStateCookie(setup.root, state), {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    // Lax: Zoom's redirect back is a cross-site top-level GET.
    sameSite: "lax",
    path: ZOOM_STATE_PATH,
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  });
  return res;
}
