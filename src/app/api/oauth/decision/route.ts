import { NextResponse, type NextRequest } from "next/server";
import { getScopedClient } from "@/lib/db/scoped-client";
import { allowedRedirects, evaluateConsent } from "@/lib/mcp/consent";
import { runDecision } from "@/lib/mcp/decision";

export const dynamic = "force-dynamic";

/**
 * Allow / Deny from the consent page. Everything is checked again here (session, the firm's
 * `claude-connector` switch, a fresh getAuthorizationDetails and its redirect allow-list) before
 * Supabase is asked to approve. Always answers a 303, so the browser follows with a GET.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let form: FormData | null = null;
  try {
    form = await req.formData();
  } catch {
    form = null;
  }
  const consent = async () => (await getScopedClient()).auth.oauth;
  const location = await runDecision(
    {
      origin: req.headers.get("origin"),
      host: (req.headers.get("x-forwarded-host") ?? req.headers.get("host"))?.split(",")[0].trim() ?? null,
      authorizationId: form?.get("authorization_id") ?? null,
      decision: form?.get("decision") ?? null,
    },
    {
      evaluate: evaluateConsent,
      approve: async (id) => (await consent()).approveAuthorization(id, { skipBrowserRedirect: true }),
      deny: async (id) => (await consent()).denyAuthorization(id, { skipBrowserRedirect: true }),
      allowedRedirects: allowedRedirects(),
    },
  );
  const res = NextResponse.redirect(new URL(location, req.url), 303);
  res.headers.set("Cache-Control", "no-store");
  return res;
}
