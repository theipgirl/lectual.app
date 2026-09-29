import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getAdminClient } from "@/lib/db/admin";
import { cronAuthorized } from "@/lib/cron-auth";
import { providerCredentials, rootKeyOrNull } from "@/lib/mailbox/config";
import { runMailboxSync } from "@/lib/mailbox/sync";

// A full pass over several firms' mailboxes can take a while; this is the
// function's ceiling, not an expected duration.
export const maxDuration = 300;

/**
 * On the vercel.json schedule (daily on Hobby; every 15 minutes once on Pro): pull new mail from every connected mailbox
 * and file what matches a client. The response carries counts only.
 */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req.headers.get("authorization"), env.CRON_SECRET)) {
    return new NextResponse(null, { status: 401 });
  }
  const root = rootKeyOrNull();
  if (!root) {
    return NextResponse.json({ ok: false, reason: "MAILBOX_TOKEN_KEY is not configured" }, { status: 503 });
  }

  const summary = await runMailboxSync({ admin: getAdminClient(), root, credentials: providerCredentials });
  return NextResponse.json({
    ok: true,
    orgs: summary.orgs,
    connections: summary.connections,
    succeeded: summary.ok,
    failed: summary.failed,
  });
}
