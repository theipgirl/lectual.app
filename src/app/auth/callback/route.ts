// MIRRORED FROM theipgirl/lectual:src/app/auth/callback/route.ts — keep in sync, do not edit locally
//
// Adapted only in its default destination: this app's dashboard is "/", not
// "/dashboard".
import { NextRequest, NextResponse } from "next/server";
import { getScopedClient } from "@/lib/db/scoped-client";

/**
 * Magic-link landing: exchanges the auth code for a session (cookies are
 * writable in route handlers, so getScopedClient persists it), then forwards
 * to the requested in-app path.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/";
  // Only ever redirect within the app.
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  if (code) {
    const supabase = await getScopedClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // Surface the reason on the sign-in page the user actually came from,
      // so an expired or already-used link says so instead of looping.
      //
      // This MUST land on /sign-in/, not "/" — the dashboard renders no error
      // state for a failed exchange, so an error there is silently swallowed
      // and the user just sees a sign-in prompt with no explanation.
      // /sign-in/ renders the error and a "request a fresh link" form.
      // Trailing slash is required: next.config.ts sets `trailingSlash: true`,
      // so "/sign-in" would take an extra redirect hop.
      //
      // This path is hit routinely, not rarely: corporate mail scanners
      // pre-fetch links, which burns the single-use code before the human
      // ever clicks it.
      const params = new URLSearchParams({ error: error.message });
      // Keep the intended destination so a fresh link resumes the journey.
      if (next !== "/") params.set("next", next);
      return NextResponse.redirect(new URL(`/sign-in/?${params}`, url.origin));
    }
  }
  return NextResponse.redirect(new URL(next, url.origin));
}
