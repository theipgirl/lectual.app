import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { frameAncestors, frameTarget } from "@/lib/intake-forms/frame-policy";
import { safeNext } from "@/lib/auth/safe-next";
import { RETURN_PATH_HEADER, dashboardReturnPath } from "@/lib/auth/return-path";
import { readFrameDomains } from "@/lib/intake-forms/frame-lookup";
import { VIEW_AS_COOKIE, proxyRefuses } from "@/lib/views/view-as-rules";
import { VIEW_AS_READ_ONLY } from "@/lib/ui/words";

/**
 * Session refresh — the piece scoped-client.ts has always assumed existed.
 *
 * In a Server Component `cookies().set` throws, so getScopedClient() swallows
 * the write. That is the documented @supabase/ssr pattern, but it is only safe
 * when something else persists rotated tokens: Supabase rotates the refresh
 * token on every refresh, and a rotation that is never written back means the
 * next request replays a consumed token and the session dies (~1h after login).
 *
 * A proxy runs before rendering and CAN write cookies, so refreshing here is
 * what makes the swallow in RSC harmless.
 *
 * This does NOT gate access. Route protection stays in the layouts and server
 * actions, where it is enforced against the DB under RLS — a proxy matcher is
 * the wrong place to hold an authorization decision (see the Next.js Data
 * Security guide: Server Functions can fall outside a matcher).
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  // A magic-link code should land on /auth/callback/, but Supabase falls back
  // to the project's Site URL — "/" — whenever the requested redirect isn't
  // allowlisted. "/" is the marketing homepage and is statically prerendered,
  // so it cannot read searchParams to forward the code itself. Catch it here
  // instead: the code is single-use, and a silent drop burns the link and
  // reads to the user as "nothing happened".
  const code = request.nextUrl.searchParams.get("code");
  if (code && (request.nextUrl.pathname === "/" || request.nextUrl.pathname === "")) {
    const safeNextPath = safeNext(request.nextUrl.searchParams.get("next"));
    const target = new URL("/auth/callback/", request.url);
    target.searchParams.set("code", code);
    target.searchParams.set("next", safeNextPath);
    return NextResponse.redirect(target);
  }

  // View as, Layer c: a QUICK refusal only. While the hint cookie is present, a non-GET on a signed-in path (and the OAuth
  // connect / callback GETs) gets 409 here, before any work. It reads no preview state and decides nothing: the guarantee
  // is previewSafe() on every action and the database net in getScopedClient() (the matcher skips some paths, and server
  // functions can fall outside it). Enter, Exit and sign-out are let through by path.
  if (request.cookies.get(VIEW_AS_COOKIE)?.value && proxyRefuses(request.method, request.nextUrl.pathname)) {
    return new NextResponse(VIEW_AS_READ_ONLY, { status: 409, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  }

  const response = await refreshSession(request);
  await applyFramePolicy(request, response);
  return response;
}

/**
 * Who may frame the public intake pages. A response header, so it can only be
 * set here (or in a route handler) — a page cannot set its own headers.
 *
 *  /i/<slug>   the form's allowed domains (frame-policy.ts): none listed means
 *              any site may embed it; a failed lookup means 'self' only.
 *  /r/<token>  never framed: the token in its URL is a credential.
 *
 * Like the session refresh, this never blocks the request: on any error the
 * page still renders (with the fail-closed 'self' policy).
 */
async function applyFramePolicy(request: NextRequest, response: NextResponse): Promise<void> {
  const target = frameTarget(request.nextUrl.pathname);
  if (target.kind === "request") {
    response.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
    return;
  }
  if (target.kind !== "intake") return;
  let policy: string | null = "frame-ancestors 'self'";
  if (target.slug) {
    try {
      policy = frameAncestors(await readFrameDomains(target.slug));
    } catch {
      // keep the fail-closed default
    }
  }
  if (policy) response.headers.set("Content-Security-Policy", policy);
}

/**
 * Pass the request on, with the dashboard page's own path + query in RETURN_PATH_HEADER (a layout cannot read its
 * URL, and the sign-in redirect needs it). A value sent by the browser is always dropped first. Built at the moment
 * of the call so the refreshed session cookies Supabase just wrote onto the request are carried too.
 */
function passOn(request: NextRequest): NextResponse {
  const headers = new Headers(request.headers);
  headers.delete(RETURN_PATH_HEADER);
  const back = dashboardReturnPath(request.nextUrl.pathname, request.nextUrl.search);
  if (back) headers.set(RETURN_PATH_HEADER, back);
  return NextResponse.next({ request: { headers } });
}

async function refreshSession(request: NextRequest): Promise<NextResponse> {
  let response = passOn(request);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Nothing to refresh if Supabase isn't configured — never break the request.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = passOn(request);
        toSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  try {
    // getUser() (not getSession()) — it validates the JWT with the auth server
    // and is what triggers the refresh whose rotated cookies we persist above.
    await supabase.auth.getUser();
  } catch {
    // An unreachable auth server must not 500 the whole app; the page's own
    // getUser() call will decide what the user sees.
  }

  return response;
}

export const config = {
  // Skip static assets and image optimization — without this the refresh runs
  // on every CSS/JS/font request, and auth logic can block them from loading.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|design/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
