import { NextResponse, type NextRequest } from "next/server";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { getSiteOrigin } from "@/lib/site-origin";
import { zoomRedirectUri, zoomSetup } from "@/lib/meetings/config";
import { exchangeZoomCode, getZoomUser } from "@/lib/meetings/zoom";
import { ZOOM_STATE_COOKIE, ZOOM_STATE_PATH, checkZoomState } from "@/lib/meetings/state";
import { saveZoomGrant } from "@/lib/meetings/connection";

const PAGE = "/dashboard/settings/integrations/meetings/";

/**
 * Step two: Zoom sends the browser back with `code` and `state`. The signed
 * cookie from /connect is the only thing trusted about who started this
 * (src/lib/meetings/state.ts): nonce, user and firm must all match. The cookie
 * is cleared on every exit, so an attempt finishes at most once. Both tokens
 * are sealed before they are written, through the caller's own scoped client,
 * so RLS decides.
 */
export async function GET(req: NextRequest) {
  const finish = (query: string) => {
    const res = NextResponse.redirect(new URL(`${PAGE}?${query}`, req.url));
    res.cookies.set(ZOOM_STATE_COOKIE, "", { path: ZOOM_STATE_PATH, maxAge: 0 });
    return res;
  };
  const fail = (code: string) => finish(`error=${code}`);

  const session = await resolveFirmSession({ signInNext: PAGE });
  if (session.kind === "signed-out") return NextResponse.redirect(new URL(session.redirectTo, req.url));
  if (session.kind !== "ok") return new NextResponse(null, { status: 404 });

  const setup = zoomSetup();
  if (!setup.ready) return fail("unconfigured");

  const url = req.nextUrl;
  if (url.searchParams.get("error")) return fail("denied");

  const check = checkZoomState(setup.root, {
    cookie: req.cookies.get(ZOOM_STATE_COOKIE)?.value,
    stateParam: url.searchParams.get("state"),
    session: { userId: session.user.id, orgId: session.org.id },
  });
  if (!check.ok) return fail(check.reason === "wrong-session" ? "wrong-session" : "expired");
  if (!hasRole(session.role, "senior_admin")) return fail("forbidden");

  const code = url.searchParams.get("code");
  if (!code) return fail("failed");

  try {
    const origin = await getSiteOrigin();
    const tokens = await exchangeZoomCode({ creds: setup.creds, code, verifier: check.state.verifier, redirectUri: zoomRedirectUri(origin) });
    const user = await getZoomUser(tokens.accessToken).catch(() => ({ id: null, email: null }));
    const saved = await saveZoomGrant({ root: setup.root, orgId: check.state.orgId, userId: check.state.userId, tokens, user });
    if (!saved.ok) return fail("save-failed");
    return finish(`connected=zoom${saved.reconnected ? "&reconnected=1" : ""}`);
  } catch (err) {
    console.error("[meetings/zoom/callback]", err instanceof Error ? err.message : "unexpected error");
    return fail("failed");
  }
}
