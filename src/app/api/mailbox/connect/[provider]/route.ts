import { NextResponse, type NextRequest } from "next/server";
import { resolveFirmSession } from "@/lib/firm/session";
import { orgHasModule } from "@/lib/org/modules";
import { getSiteOrigin } from "@/lib/site-origin";
import { canManageScope, isScope } from "@/lib/mailbox/access";
import { providerCredentials, rootKeyOrNull } from "@/lib/mailbox/config";
import { authorizeUrl, isProvider, redirectUri } from "@/lib/mailbox/providers";
import { STATE_COOKIE, STATE_TTL_MS, encodeStateCookie, newState } from "@/lib/mailbox/state";
import { MAILBOXES_PATH } from "@/lib/mailbox/outcome";

/**
 * Step one of "Connect Gmail / Outlook": check the caller may connect this
 * kind of mailbox, remember who they are in a signed cookie, and send them to
 * the provider's consent screen.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isProvider(provider)) return new NextResponse(null, { status: 404 });

  const session = await resolveFirmSession({ signInNext: MAILBOXES_PATH });
  if (session.kind === "signed-out") return NextResponse.redirect(new URL(session.redirectTo, req.url));
  if (session.kind !== "ok") return new NextResponse(null, { status: 404 });
  // Fail closed: a firm without the module has no such surface at all.
  if (!(await orgHasModule("mailbox"))) return new NextResponse(null, { status: 404 });

  const back = (code: string) => NextResponse.redirect(new URL(`${MAILBOXES_PATH}?error=${code}`, req.url));

  const scope = req.nextUrl.searchParams.get("scope") ?? "personal";
  if (!isScope(scope)) return back("failed");
  if (!canManageScope(session.role, scope)) return back("forbidden");

  const creds = providerCredentials(provider);
  const root = rootKeyOrNull();
  if (!creds || !root) return back("unconfigured");

  const origin = await getSiteOrigin();
  const state = newState({ provider, scope, orgId: session.org.id, userId: session.user.id });

  const res = NextResponse.redirect(
    authorizeUrl({
      provider,
      clientId: creds.clientId,
      redirectUri: redirectUri(origin, provider),
      nonce: state.nonce,
      verifier: state.verifier,
      // Personal: pre-fill the signed-in address. Firm: leave the chooser open,
      // since the shared mailbox is a different account.
      loginHint: scope === "personal" ? (session.user.email ?? undefined) : undefined,
    }),
  );
  res.cookies.set(STATE_COOKIE, encodeStateCookie(root, state), {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    // Lax, not Strict: the provider's redirect back is a cross-site top-level
    // GET, which Strict would strip the cookie from.
    sameSite: "lax",
    path: "/api/mailbox/callback/",
    maxAge: Math.floor(STATE_TTL_MS / 1000),
  });
  return res;
}
