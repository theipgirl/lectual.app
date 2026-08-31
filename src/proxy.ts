// MIRRORED FROM theipgirl/lectual:src/proxy.ts — keep in sync, do not edit locally
//
// Next 16 loads this file as the request proxy (the successor to middleware.ts);
// the export name `proxy` and the exported `config.matcher` are both required.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
 *
 * Never set an explicit cookie `domain` here: this app and the main app share
 * a Supabase project and therefore a cookie name, and widening the domain would
 * make signing out of one invalidate the other's refresh-token family.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  // A magic-link code should land on /auth/callback/, but Supabase falls back
  // to the project's Site URL — "/" — whenever the requested redirect isn't
  // allowlisted. "/" is this app's home dashboard and may be prerendered, so
  // it cannot be relied on to forward the code itself. Catch it here instead:
  // the code is single-use, and a silent drop burns the link and reads to the
  // user as "nothing happened".
  const code = request.nextUrl.searchParams.get("code");
  if (code && (request.nextUrl.pathname === "/" || request.nextUrl.pathname === "")) {
    const next = request.nextUrl.searchParams.get("next");
    const safeNext =
      next && next.startsWith("/") && !next.startsWith("//") && next !== "/" ? next : "/";
    const target = new URL("/auth/callback/", request.url);
    target.searchParams.set("code", code);
    target.searchParams.set("next", safeNext);
    return NextResponse.redirect(target);
  }

  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Nothing to refresh if Supabase isn't configured — never break the request.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
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
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
