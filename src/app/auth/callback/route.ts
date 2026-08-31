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
  const tokenHash = url.searchParams.get("token_hash");
  const otpType = url.searchParams.get("type");
  const nextParam = url.searchParams.get("next") ?? "/";
  // Only ever redirect within the app.
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";

  if (code || tokenHash) {
    const supabase = await getScopedClient();

    // TWO LANDING SHAPES, ON PURPOSE.
    //
    // `?code=` is the PKCE flow. It is the default and it is fine — but it
    // only completes in the SAME browser that requested the link, because the
    // one-time verifier is a cookie written on that origin at request time.
    // Request the link on a laptop and open it on a phone, or let Outlook or
    // Gmail open it inside their own in-app webview (both do, by default), and
    // the verifier is not there: "PKCE code verifier not found in storage".
    //
    // `?token_hash=&type=` is the same magic link verified server-side. It
    // carries no verifier and so works across devices and browsers — which is
    // the difference between an attorney reading a hearing date on her phone
    // and an attorney staring at an error. Supabase's own SSR guidance uses
    // this shape for exactly that reason.
    //
    // Both are single-use and both still expire; neither weakens the other.
    const { error } = tokenHash
      ? await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          // `type` comes off the URL, so treat it as untrusted input: anything
          // that is not a recognised email OTP type is refused rather than
          // passed through to GoTrue.
          type:
            otpType === "recovery" ||
            otpType === "invite" ||
            otpType === "email_change" ||
            otpType === "signup"
              ? otpType
              : "magiclink",
        })
      : await supabase.auth.exchangeCodeForSession(code as string);

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
