import { NextResponse, type NextRequest } from "next/server";
import { resolveFirmSession } from "@/lib/firm/session";
import { orgHasModule } from "@/lib/org/modules";
import { getSiteOrigin } from "@/lib/site-origin";
import { canManageScope } from "@/lib/mailbox/access";
import { providerCredentials, rootKeyOrNull } from "@/lib/mailbox/config";
import { saveConnection } from "@/lib/mailbox/connections";
import {
  ProviderError,
  exchangeCode,
  fetchAccountEmail,
  isProvider,
  redirectUri,
} from "@/lib/mailbox/providers";
import { STATE_COOKIE, checkState } from "@/lib/mailbox/state";
import { MAILBOXES_PATH, type OutcomeCode } from "@/lib/mailbox/outcome";

/**
 * Step two: the provider sends the browser back here with `code` and `state`.
 * The signed cookie set by /connect is the only thing trusted about who
 * started this; see src/lib/mailbox/state.ts for everything that is checked.
 * The cookie is cleared on every exit so an attempt can only be finished once.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isProvider(provider)) return new NextResponse(null, { status: 404 });

  const finish = (query: string) => {
    const res = NextResponse.redirect(new URL(`${MAILBOXES_PATH}?${query}`, req.url));
    res.cookies.set(STATE_COOKIE, "", { path: "/api/mailbox/callback/", maxAge: 0 });
    return res;
  };
  const fail = (code: OutcomeCode) => finish(`error=${code}`);

  const session = await resolveFirmSession({ signInNext: MAILBOXES_PATH });
  if (session.kind === "signed-out") return NextResponse.redirect(new URL(session.redirectTo, req.url));
  if (session.kind !== "ok") return new NextResponse(null, { status: 404 });
  if (!(await orgHasModule("mailbox"))) return new NextResponse(null, { status: 404 });

  const root = rootKeyOrNull();
  const creds = providerCredentials(provider);
  if (!root || !creds) return fail("unconfigured");

  const url = req.nextUrl;
  // The person clicked "Cancel" / "Deny" on the consent screen.
  if (url.searchParams.get("error")) return fail("denied");

  const check = checkState(root, {
    cookie: req.cookies.get(STATE_COOKIE)?.value,
    stateParam: url.searchParams.get("state"),
    provider,
    session: { userId: session.user.id, orgId: session.org.id },
  });
  if (!check.ok) return fail(check.reason === "wrong-session" ? "wrong-session" : "expired");
  const { state } = check;

  // Role could have changed since /connect; the DB would refuse anyway, but
  // don't spend a token exchange on a write that cannot land.
  if (!canManageScope(session.role, state.scope)) return fail("forbidden");

  const code = url.searchParams.get("code");
  if (!code) return fail("failed");

  try {
    const origin = await getSiteOrigin();
    const tokens = await exchangeCode({
      provider,
      creds,
      code,
      verifier: state.verifier,
      redirectUri: redirectUri(origin, provider),
    });
    const email = await fetchAccountEmail({ provider, accessToken: tokens.accessToken });

    const saved = await saveConnection({
      root,
      orgId: state.orgId,
      userId: state.userId,
      scope: state.scope,
      provider,
      email,
      tokens,
    });
    if (!saved.ok) {
      return fail(saved.code === "db-error" ? "failed" : saved.code);
    }
    return finish(`connected=${provider}${saved.reconnected ? "&reconnected=1" : ""}`);
  } catch (err) {
    if (err instanceof ProviderError) {
      if (err.code === "missing-permission" || err.code === "no-refresh-token") return fail(err.code);
      console.error(`[mailbox/callback] ${provider}: ${err.code}: ${err.message}`);
      return fail("failed");
    }
    console.error(`[mailbox/callback] ${provider}: unexpected error`, err);
    return fail("failed");
  }
}
